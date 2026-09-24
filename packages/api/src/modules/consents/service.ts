import type { Db } from "@nmbm/db";
import { consents, episodes, users } from "@nmbm/db";
import { eq, and, desc } from "drizzle-orm";
import type { ConsentCreate, ConsentType } from "@nmbm/shared";
import { CONSENT_VALID_DAYS } from "@nmbm/shared";
import { notFound, conflict, badRequest } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

export type ConsentRow = {
  id: string;
  type: ConsentType;
  formName: string;
  signedDate: string;
  expiresDate: string;
  revokedAt: Date | null;
  revokedReason: string | null;
  recordedByName: string | null;
  documentUrl: string | null;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Whether a consent authorises anything right now. Derived rather than
// read off the stored status: a row that says "active" with a date in
// the past is exactly the bug that lets an expired consent authorise a
// disclosure, and nothing here runs a job to keep the two in step.
export function effectiveStatus(row: {
  revokedAt: Date | null;
  expiresDate: string;
}): "active" | "expired" | "revoked" {
  if (row.revokedAt) return "revoked";
  return row.expiresDate < today() ? "expired" : "active";
}

export function isUsable(row: { revokedAt: Date | null; expiresDate: string }) {
  return effectiveStatus(row) === "active";
}

export async function listForParticipant(db: Db, participantId: string) {
  const rows = await db
    .select({
      id: consents.id,
      type: consents.type,
      formName: consents.formName,
      signedDate: consents.signedDate,
      expiresDate: consents.expiresDate,
      revokedAt: consents.revokedAt,
      revokedReason: consents.revokedReason,
      documentUrl: consents.documentUrl,
      recordedByName: users.displayName,
    })
    .from(consents)
    .leftJoin(users, eq(users.id, consents.recordedById))
    .where(eq(consents.participantId, participantId))
    .orderBy(desc(consents.signedDate));

  return rows.map((row) => ({ ...row, status: effectiveStatus(row) }));
}

// M16: "our consents can expire at a year after the client is enrolled"
// — the anchor is the enrolment date, not the signature. Computed here
// rather than accepted from the caller so it can't be set to something
// convenient, and the episode it was counted from is recorded.
export async function recordConsent(db: Db, input: ConsentCreate, recordedById: string) {
  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.participantId, input.participantId), eq(episodes.status, "open")));

  if (!episode) {
    throw conflict("No open episode — a consent is scoped to an enrolment");
  }
  if (input.signedDate > today()) {
    throw badRequest("A consent can't be signed in the future");
  }

  const expires = new Date(episode.startDate);
  expires.setDate(expires.getDate() + CONSENT_VALID_DAYS);

  const [row] = await db
    .insert(consents)
    .values({
      participantId: input.participantId,
      episodeId: episode.id,
      type: input.type,
      formName: input.formName,
      signedDate: input.signedDate,
      expiresDate: expires.toISOString().slice(0, 10),
      recordedById,
    })
    .returning();

  await writeAudit(db, {
    actorUserId: recordedById,
    action: "consent.recorded",
    entityType: "consent",
    entityId: row.id,
    detail: `${input.type} — ${input.formName}`,
  });
  return { ...row, status: effectiveStatus(row) };
}

// Revoked, never deleted (hard rule 1). A revoked release stops
// authorising new disclosures; referrals already sent keep pointing at
// it, because what was authorised at the time is a fact about the past.
export async function revokeConsent(db: Db, id: string, reason: string, actorId: string) {
  const [row] = await db.select().from(consents).where(eq(consents.id, id));
  if (!row) throw notFound("Consent not found");
  if (row.revokedAt) throw conflict("Already revoked");

  const [updated] = await db
    .update(consents)
    .set({ revokedAt: new Date(), revokedReason: reason, status: "revoked" })
    .where(eq(consents.id, id))
    .returning();

  await writeAudit(db, {
    actorUserId: actorId,
    action: "consent.revoked",
    entityType: "consent",
    entityId: id,
    detail: reason,
  });
  return { ...updated, status: effectiveStatus(updated) };
}

// The release that authorises sharing with a partner agency. Returns
// the usable one if there is one, so the referral gate can explain
// precisely what's missing rather than just refusing.
export async function findUsableRelease(db: Db, participantId: string) {
  const rows = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.participantId, participantId),
        eq(consents.type, "release_of_information"),
      ),
    )
    .orderBy(desc(consents.signedDate));

  const usable = rows.find(isUsable);
  return { usable: usable ?? null, all: rows };
}

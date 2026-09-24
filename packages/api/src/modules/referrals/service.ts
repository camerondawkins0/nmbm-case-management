import type { Db } from "@nmbm/db";
import { referrals, participants, episodes, users, consents } from "@nmbm/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { ReferralCreate, ReferralOutcome } from "@nmbm/shared";
import { REFERRAL_FOLLOW_UP_DAYS } from "@nmbm/shared";
import { notFound, conflict, unprocessable, badRequest } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import { effectiveStatus, findUsableRelease } from "../consents/service.js";

// Still needs chasing. "accepted" is deliberately here: the partner
// agreeing to take someone is not the same as the person having been
// seen, and M17 asks what happened to the client, not to the paperwork.
// Whether NMBM wants an accepted referral to keep nagging is flagged in
// docs/DISCOVERY_FOLLOWUP.md.
const OPEN_STATUSES = ["sent", "accepted"] as const;

export async function listForParticipant(db: Db, participantId: string) {
  return db
    .select({
      id: referrals.id,
      partnerName: referrals.partnerName,
      serviceType: referrals.serviceType,
      reason: referrals.reason,
      status: referrals.status,
      referredAt: referrals.referredAt,
      outcomeNote: referrals.outcomeNote,
      outcomeRecordedAt: referrals.outcomeRecordedAt,
      referredByName: users.displayName,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.referredById))
    .where(eq(referrals.participantId, participantId))
    .orderBy(desc(referrals.referredAt));
}

// M17: "we would need to know what happened with the client and the
// referral." A referral sent and never followed up is the failure this
// is meant to prevent, so it surfaces rather than sitting in a list.
export async function listAwaitingOutcome(db: Db, participantIds: string[] | null) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - REFERRAL_FOLLOW_UP_DAYS);

  // Status alone decides. Filtering on "no outcome recorded" as well
  // would drop an accepted-but-unfinished referral off the list the
  // moment someone noted the partner had replied.
  const scope =
    participantIds === null
      ? inArray(referrals.status, [...OPEN_STATUSES])
      : and(
          inArray(referrals.status, [...OPEN_STATUSES]),
          inArray(referrals.participantId, participantIds),
        );

  if (participantIds !== null && participantIds.length === 0) return [];

  const rows = await db
    .select({
      id: referrals.id,
      partnerName: referrals.partnerName,
      serviceType: referrals.serviceType,
      status: referrals.status,
      referredAt: referrals.referredAt,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
    })
    .from(referrals)
    .innerJoin(participants, eq(participants.id, referrals.participantId))
    .where(scope)
    .orderBy(referrals.referredAt);

  return rows.map((row) => ({
    ...row,
    overdue: row.referredAt < cutoff,
    daysWaiting: Math.floor((Date.now() - row.referredAt.getTime()) / 86_400_000),
  }));
}

// M15 asked whether a signature "unlocks something else, like a
// referral". This is the answer, and it blocks rather than warns.
//
// The open half of M16 — whether a *missing* form should stop work in
// general — is still unanswered, and this deliberately doesn't settle
// it. Sending a participant's information to an outside agency is the
// one case where the answer isn't NMBM's preference to make: without a
// signed release there is nothing authorising the disclosure. Every
// other consent-gated action stays a warning until they decide.
export async function createReferral(db: Db, input: ReferralCreate, referredById: string) {
  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.participantId, input.participantId), eq(episodes.status, "open")));
  if (!episode) throw conflict("No open episode — can't refer out of a closed case");

  const { usable, all } = await findUsableRelease(db, input.participantId);

  if (!usable) {
    // Say which of the three situations it is, because "add a release
    // of information" and "the one on file expired last week" lead to
    // different next actions.
    const previous = all.map((row) => effectiveStatus(row));
    const detail = previous.includes("expired")
      ? "the release of information on file has expired"
      : previous.includes("revoked")
        ? "the release of information was revoked"
        : "there is no release of information on file";
    throw unprocessable(
      `Can't refer to an outside agency — ${detail}. Record a signed release first.`,
    );
  }

  const [row] = await db
    .insert(referrals)
    .values({
      participantId: input.participantId,
      episodeId: episode.id,
      partnerName: input.partnerName,
      serviceType: input.serviceType,
      reason: input.reason ?? null,
      consentId: usable.id,
      referredById,
    })
    .returning();

  await writeAudit(db, {
    actorUserId: referredById,
    action: "referral.sent",
    entityType: "referral",
    entityId: row.id,
    detail: `${input.serviceType} → ${input.partnerName}, authorised by consent ${usable.id}`,
  });
  return row;
}

export async function recordOutcome(
  db: Db,
  id: string,
  input: ReferralOutcome,
  actorId: string,
) {
  const [row] = await db.select().from(referrals).where(eq(referrals.id, id));
  if (!row) throw notFound("Referral not found");
  if (input.status === "sent") {
    throw badRequest("Recording an outcome means saying what happened, not 'sent'");
  }

  const [updated] = await db
    .update(referrals)
    .set({
      status: input.status,
      outcomeNote: input.outcomeNote ?? null,
      outcomeRecordedById: actorId,
      outcomeRecordedAt: new Date(),
    })
    .where(eq(referrals.id, id))
    .returning();

  await writeAudit(db, {
    actorUserId: actorId,
    action: "referral.outcome_recorded",
    entityType: "referral",
    entityId: id,
    detail: input.status,
  });
  return updated;
}

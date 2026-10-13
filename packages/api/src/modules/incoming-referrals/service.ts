import type { Db } from "@nmbm/db";
import { episodes, incomingReferralNotes, incomingReferrals, users } from "@nmbm/db";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import {
  NO_OUTCOME_OWED_REASONS,
  type IncomingReferralCloseReason,
  type IncomingReferralCreate,
} from "@nmbm/shared";
import { conflict, notFound } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

const OPEN = ["new", "contacting"] as const;

const recordedBy = users;

function summary() {
  return {
    id: incomingReferrals.id,
    receivedDate: incomingReferrals.receivedDate,
    sourceType: incomingReferrals.sourceType,
    sourceName: incomingReferrals.sourceName,
    firstName: incomingReferrals.firstName,
    lastName: incomingReferrals.lastName,
    dateOfBirth: incomingReferrals.dateOfBirth,
    reason: incomingReferrals.reason,
    status: incomingReferrals.status,
    closeReason: incomingReferrals.closeReason,
    participantId: incomingReferrals.participantId,
    outcomeReportedAt: incomingReferrals.outcomeReportedAt,
    recordedByName: recordedBy.displayName,
  };
}

// Whether the referrer is still owed word of what happened: the
// referral reached an end, somebody other than the person themselves
// sent it, it was a real referral, and nobody has told them yet.
const outcomeOwed = and(
  inArray(incomingReferrals.status, ["admitted", "closed"]),
  ne(incomingReferrals.sourceType, "self"),
  isNull(incomingReferrals.outcomeReportedAt),
  or(
    isNull(incomingReferrals.closeReason),
    notInArray(incomingReferrals.closeReason, [...NO_OUTCOME_OWED_REASONS]),
  ),
);

export async function list(db: Db, view: "open" | "outcome_owed" | "all") {
  const where =
    view === "open"
      ? inArray(incomingReferrals.status, [...OPEN])
      : view === "outcome_owed"
        ? outcomeOwed
        : undefined;
  const rows = await db
    .select({
      ...summary(),
      lastActivity: sql<string | null>`(select max(n.created_at) from ${incomingReferralNotes} n where n.referral_id = "incoming_referrals"."id")`,
      attempts: sql<number>`(select count(*)::int from ${incomingReferralNotes} n where n.referral_id = "incoming_referrals"."id")`,
    })
    .from(incomingReferrals)
    .innerJoin(recordedBy, eq(recordedBy.id, incomingReferrals.recordedById))
    .where(where)
    .orderBy(view === "all" ? desc(incomingReferrals.receivedDate) : asc(incomingReferrals.receivedDate));
  return rows.map((r) => ({
    ...r,
    daysWaiting: Math.floor((Date.now() - Date.parse(r.receivedDate)) / 86_400_000),
  }));
}

export async function counts(db: Db) {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${inArray(incomingReferrals.status, [...OPEN])})::int`,
      outcomeOwed: sql<number>`count(*) filter (where ${outcomeOwed})::int`,
    })
    .from(incomingReferrals);
  return row;
}

export async function find(db: Db, id: string) {
  const [row] = await db.select().from(incomingReferrals).where(eq(incomingReferrals.id, id));
  if (!row) throw notFound("Referral not found");
  return row;
}

export async function get(db: Db, id: string) {
  const row = await find(db, id);
  const notes = await db
    .select({
      id: incomingReferralNotes.id,
      body: incomingReferralNotes.body,
      createdAt: incomingReferralNotes.createdAt,
      createdByName: users.displayName,
    })
    .from(incomingReferralNotes)
    .innerJoin(users, eq(users.id, incomingReferralNotes.createdById))
    .where(eq(incomingReferralNotes.referralId, id))
    .orderBy(asc(incomingReferralNotes.createdAt));
  const name = async (userId: string | null) => {
    if (!userId) return null;
    const [u] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, userId));
    return u?.n ?? null;
  };
  return {
    ...row,
    recordedByName: await name(row.recordedById),
    admittedByName: await name(row.admittedById),
    closedByName: await name(row.closedById),
    outcomeReportedByName: await name(row.outcomeReportedById),
    outcomeOwed:
      (row.status === "admitted" || row.status === "closed") &&
      row.sourceType !== "self" &&
      !row.outcomeReportedAt &&
      !(row.closeReason && NO_OUTCOME_OWED_REASONS.has(row.closeReason)),
    notes,
  };
}

export async function create(db: Db, input: IncomingReferralCreate, actorId: string) {
  const [row] = await db
    .insert(incomingReferrals)
    .values({
      receivedDate: input.receivedDate,
      sourceType: input.sourceType,
      sourceName: input.sourceName ?? null,
      sourceContact: input.sourceContact ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth ?? null,
      phone: input.phone ?? null,
      payer: input.payer ?? null,
      reason: input.reason,
      recordedById: actorId,
    })
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "incoming_referral.recorded",
    entityType: "incoming_referral",
    entityId: row.id,
    detail: `from ${input.sourceName || input.sourceType}`,
  });
  return row;
}

// Only an open referral takes notes, closes, or gets someone admitted
// from it: once it has ended, what happened next lives on the record.
function requireOpen(row: { status: string }) {
  if (row.status !== "new" && row.status !== "contacting") {
    throw conflict("This referral has already been dealt with");
  }
}

export async function addNote(db: Db, id: string, body: string, actorId: string) {
  requireOpen(await find(db, id));
  return db.transaction(async (tx) => {
    const [note] = await tx.insert(incomingReferralNotes).values({ referralId: id, body, createdById: actorId }).returning();
    // Somebody is working on it now.
    await tx
      .update(incomingReferrals)
      .set({ status: "contacting" })
      .where(and(eq(incomingReferrals.id, id), eq(incomingReferrals.status, "new")));
    return note;
  });
}

export async function close(
  db: Db,
  id: string,
  input: { reason: IncomingReferralCloseReason; note?: string | null },
  actorId: string,
) {
  const [row] = await db
    .update(incomingReferrals)
    .set({
      status: "closed",
      closeReason: input.reason,
      closeNote: input.note ?? null,
      closedById: actorId,
      closedAt: new Date(),
    })
    .where(and(eq(incomingReferrals.id, id), inArray(incomingReferrals.status, [...OPEN])))
    .returning();
  if (!row) {
    await find(db, id);
    throw conflict("This referral has already been dealt with");
  }
  await writeAudit(db, {
    actorUserId: actorId,
    action: "incoming_referral.closed",
    entityType: "incoming_referral",
    entityId: id,
    detail: input.reason,
  });
  return row;
}

// Marks a referral admitted and points it at the record and episode.
// Called inside intake's own transaction for a new person, and from
// linkToParticipant for somebody who already has a record.
export async function markAdmitted(
  db: Db,
  id: string,
  target: { participantId: string; episodeId: string },
  actorId: string,
) {
  const [row] = await db
    .update(incomingReferrals)
    .set({ status: "admitted", ...target, admittedById: actorId, admittedAt: new Date() })
    .where(and(eq(incomingReferrals.id, id), inArray(incomingReferrals.status, [...OPEN])))
    .returning();
  if (!row) throw conflict("That referral isn't open any more — it may already have been dealt with");
  await writeAudit(db, {
    actorUserId: actorId,
    action: "incoming_referral.admitted",
    entityType: "participant",
    entityId: target.participantId,
    detail: `referral ${id}`,
  });
  return row;
}

// Somebody already active with NMBM who has been referred again: the
// referral joins their current stay. A returning client whose record is
// closed is readmitted with the referral instead (POST /api/episodes),
// which settles it in the same act.
export async function linkToParticipant(db: Db, id: string, participantId: string, actorId: string) {
  requireOpen(await find(db, id));
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), eq(episodes.status, "open")));
  if (!episode) throw conflict("That record is closed — readmit them from this referral instead");
  return markAdmitted(db, id, { participantId, episodeId: episode.id }, actorId);
}

// Closing the loop: the referrer was told what happened. Recorded once,
// by whoever did it, and only when there is an outcome to tell.
export async function reportOutcome(db: Db, id: string, actorId: string) {
  const row = await get(db, id);
  if (!row.outcomeOwed) {
    throw conflict(
      row.outcomeReportedAt
        ? "The referrer has already been told"
        : "There's no outcome to report yet, or nobody to report it to",
    );
  }
  const [updated] = await db
    .update(incomingReferrals)
    .set({ outcomeReportedAt: new Date(), outcomeReportedById: actorId })
    .where(and(eq(incomingReferrals.id, id), isNull(incomingReferrals.outcomeReportedAt)))
    .returning();
  if (!updated) throw conflict("The referrer has already been told");
  await writeAudit(db, {
    actorUserId: actorId,
    action: "incoming_referral.outcome_reported",
    entityType: "incoming_referral",
    entityId: id,
  });
  return updated;
}

// On a participant's record: who sent them, when and why. Readable by
// anyone who can open the record — it's part of their history.
export async function listForParticipant(db: Db, participantId: string) {
  return db
    .select({
      id: incomingReferrals.id,
      receivedDate: incomingReferrals.receivedDate,
      sourceType: incomingReferrals.sourceType,
      sourceName: incomingReferrals.sourceName,
      reason: incomingReferrals.reason,
      episodeId: incomingReferrals.episodeId,
      outcomeReportedAt: incomingReferrals.outcomeReportedAt,
    })
    .from(incomingReferrals)
    .where(eq(incomingReferrals.participantId, participantId))
    .orderBy(desc(incomingReferrals.receivedDate));
}


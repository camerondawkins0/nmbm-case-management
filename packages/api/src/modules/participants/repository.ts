import type { Db } from "@nmbm/db";
import {
  participants,
  assignments,
  episodes,
  carePlans,
  notes,
  users,
  vNoContactCounts,
} from "@nmbm/db";
import { eq, and, isNull, inArray, desc, sql } from "drizzle-orm";
import type { ParticipantCreate } from "@nmbm/shared";

// One row per participant with everything the caseload screen shows, so
// a list of 40 doesn't turn into 120 follow-up queries.
const listSelection = {
  id: participants.id,
  firstName: participants.firstName,
  lastName: participants.lastName,
  dateOfBirth: participants.dateOfBirth,
  payer: participants.payer,
  workerId: assignments.workerId,
  workerName: users.displayName,
  episodeId: episodes.id,
  episodeStatus: episodes.status,
  startDate: episodes.startDate,
  carePlanDueDate: episodes.carePlanDueDate,
  disenrollmentLetterSentAt: episodes.disenrollmentLetterSentAt,
  carePlanId: carePlans.id,
  carePlanStatus: carePlans.status,
  carePlanReviewDue: carePlans.nextReviewDue,
  consecutiveNoContacts: vNoContactCounts.consecutiveNoContacts,
};

function baseListQuery(db: Db) {
  return db
    .select(listSelection)
    .from(participants)
    .leftJoin(
      assignments,
      and(eq(assignments.participantId, participants.id), isNull(assignments.endedAt)),
    )
    .leftJoin(users, eq(users.id, assignments.workerId))
    .leftJoin(
      episodes,
      and(eq(episodes.participantId, participants.id), eq(episodes.status, "open")),
    )
    .leftJoin(carePlans, eq(carePlans.episodeId, episodes.id))
    .leftJoin(vNoContactCounts, eq(vNoContactCounts.participantId, participants.id));
}

export async function listAll(db: Db) {
  return baseListQuery(db).orderBy(participants.lastName);
}

export async function listForParticipantIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return baseListQuery(db).where(inArray(participants.id, ids)).orderBy(participants.lastName);
}

export async function findById(db: Db, id: string) {
  const [row] = await baseListQuery(db).where(eq(participants.id, id));
  return row;
}

export async function listNotes(db: Db, participantId: string) {
  return db
    .select({
      id: notes.id,
      contactResult: notes.contactResult,
      body: notes.body,
      createdAt: notes.createdAt,
      authorName: users.displayName,
      approvedAt: notes.approvedAt,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.participantId, participantId))
    .orderBy(desc(notes.createdAt));
}

export async function insert(db: Db, input: ParticipantCreate) {
  const [row] = await db
    .insert(participants)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      payer: input.payer,
    })
    .returning();
  return row;
}

// Counts for the worker's home screen, scoped the same way the list is.
export async function countsForIds(db: Db, ids: string[] | null) {
  const scope = ids === null ? sql`true` : inArray(participants.id, ids ?? []);
  if (ids !== null && ids.length === 0) {
    return { total: 0 };
  }
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(participants)
    .where(scope);
  return row;
}

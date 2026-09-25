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
import { eq, and, or, isNull, isNotNull, inArray, desc, sql, type SQL } from "drizzle-orm";
import type { ParticipantCreate, ParticipantSearch } from "@nmbm/shared";

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
  carePlanGoals: carePlans.goals,
  carePlanReviewNote: carePlans.reviewNote,
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
    .leftJoin(vNoContactCounts, eq(vNoContactCounts.episodeId, episodes.id));
}

// R10: "active" is having an open episode, and it is decided here in
// the query — not by a nightly job, and not by the page hiding rows.
const isActive = isNotNull(episodes.id);

export async function listAll(db: Db) {
  return baseListQuery(db).where(isActive).orderBy(participants.lastName);
}

export async function listForParticipantIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return baseListQuery(db)
    .where(and(isActive, inArray(participants.id, ids)))
    .orderBy(participants.lastName);
}

// R10's other half: the record stays retrievable, for a returning
// participant or a contractor/grantor request. Anyone with no open
// episode who has had at least one, with the most recent closure —
// that's what a person looking for them will recognise.
export async function listClosed(db: Db) {
  const latest = db
    .selectDistinctOn([episodes.participantId], {
      participantId: episodes.participantId,
      episodeId: episodes.id,
      startDate: episodes.startDate,
      endDate: episodes.endDate,
      closureReason: episodes.closureReason,
    })
    .from(episodes)
    .where(eq(episodes.status, "closed"))
    .orderBy(episodes.participantId, desc(episodes.endDate), desc(episodes.createdAt))
    .as("latest");

  return db
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
      payer: participants.payer,
      lastEpisodeId: latest.episodeId,
      startDate: latest.startDate,
      endDate: latest.endDate,
      closureReason: latest.closureReason,
    })
    .from(participants)
    .innerJoin(latest, eq(latest.participantId, participants.id))
    .where(
      sql`not exists (select 1 from ${episodes} e where e.participant_id = ${participants.id} and e.status = 'open')`,
    )
    .orderBy(desc(latest.endDate), participants.lastName);
}

// Every episode, newest first. A readmitted participant's record shows
// both stays rather than the second overwriting the first (M2).
export async function listEpisodes(db: Db, participantId: string) {
  return db
    .select({
      id: episodes.id,
      status: episodes.status,
      startDate: episodes.startDate,
      endDate: episodes.endDate,
      closureReason: episodes.closureReason,
      closureNote: episodes.closureNote,
      readmittedFromEpisodeId: episodes.readmittedFromEpisodeId,
    })
    .from(episodes)
    .where(eq(episodes.participantId, participantId))
    .orderBy(desc(episodes.startDate), desc(episodes.createdAt));
}

// Not scoped to active: this is the direct lookup R10 says must still
// reach a closed record. Who may make it is decided by canSeeParticipant.
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
      authorId: notes.authorId,
      episodeId: notes.episodeId,
      status: notes.status,
      reviewNote: notes.reviewNote,
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

function likePrefix(term: string) {
  return `${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Readmission search (R10). Every word has to start a first or last
// name, so "ire wal" finds Irene Walsh and "walsh" finds every Walsh.
// Callers filter the result by what the person searching may open —
// this returns candidates, not an answer.
export async function search(db: Db, input: ParticipantSearch, limit = 25) {
  const conditions: SQL[] = [];
  if (input.dob) conditions.push(eq(participants.dateOfBirth, input.dob));
  for (const word of (input.q ?? "").split(/\s+/).filter(Boolean)) {
    const pattern = likePrefix(word);
    conditions.push(
      or(
        sql`lower(${participants.firstName}) like ${pattern}`,
        sql`lower(${participants.lastName}) like ${pattern}`,
      )!,
    );
  }
  // Outer references are qualified by hand: in a single-table query
  // Drizzle renders ${participants.id} as a bare "id", which is ambiguous
  // (or worse, silently rebinds) inside these subqueries.
  return db
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
      active: sql<boolean>`exists (select 1 from "episodes" e where e.participant_id = "participants"."id" and e.status = 'open')`,
      lastEndDate: sql<string | null>`(select max(e.end_date)::text from "episodes" e where e.participant_id = "participants"."id" and e.status = 'closed')`,
      workerName: sql<string | null>`(select u.display_name from "assignments" a join "users" u on u.id = a.worker_id where a.participant_id = "participants"."id" and a.ended_at is null limit 1)`,
    })
    .from(participants)
    .where(and(...conditions))
    .orderBy(participants.lastName, participants.firstName)
    .limit(limit);
}

// The duplicate check at intake: same date of birth and the same first
// or last name. Loose on purpose — a married name or a nickname shouldn't
// be enough to slip a second record past the front desk.
export async function possibleDuplicates(db: Db, first: string, last: string, dob: string) {
  return db
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.dateOfBirth, dob),
        or(
          sql`lower(${participants.firstName}) = ${first.trim().toLowerCase()}`,
          sql`lower(${participants.lastName}) = ${last.trim().toLowerCase()}`,
        ),
      ),
    );
}

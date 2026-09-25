import type { Db } from "@nmbm/db";
import { followUpCalls, episodes, participants, users } from "@nmbm/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { FOLLOW_UP_FINAL_LAPSE_MONTHS, type FollowUpCall } from "@nmbm/shared";
import { followUpSchedule, addMonths, type CallRecord, type Milestone } from "../../lib/follow-ups.js";
import { conflict, notFound, unprocessable } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// A closed episode is followed up only while it's the participant's most
// recent one. Once they're readmitted they're receiving services again,
// and the old schedule stops — the new episode gets its own when it ends.
//
// The outer columns are written out qualified on purpose. Drizzle renders
// ${episodes.id} as a bare "id" when a query reads one table, and inside
// this subquery a bare "id" silently means later.id — every episode would
// look like its own successor.
const isLatestClosedEpisode = sql`"episodes"."status" = 'closed' and not exists (
  select 1 from "episodes" later
   where later.participant_id = "episodes"."participant_id"
     and later.id <> "episodes"."id"
     and (later.status = 'open' or later.start_date >= "episodes"."start_date")
)`;

async function callsFor(db: Db, episodeIds: string[]) {
  if (episodeIds.length === 0) return new Map<string, CallRecord[]>();
  const rows = await db
    .select({
      id: followUpCalls.id,
      episodeId: followUpCalls.episodeId,
      milestoneMonths: followUpCalls.milestoneMonths,
      outcome: followUpCalls.outcome,
      note: followUpCalls.note,
      servicesFeedback: followUpCalls.servicesFeedback,
      calledAt: followUpCalls.calledAt,
      calledByName: users.displayName,
    })
    .from(followUpCalls)
    .innerJoin(users, eq(users.id, followUpCalls.calledById))
    .where(inArray(followUpCalls.episodeId, episodeIds));
  const byEpisode = new Map<string, CallRecord[]>();
  for (const { episodeId, ...call } of rows) {
    byEpisode.set(episodeId, [...(byEpisode.get(episodeId) ?? []), call]);
  }
  return byEpisode;
}

// QA's working list: every call that's due or overdue, and the next
// month's worth coming up, soonest first.
export async function listQueue(db: Db) {
  const today = todayIso();
  // Nothing closed longer ago than the last milestone's lapse can still
  // have a call owed.
  const earliest = addMonths(today, -FOLLOW_UP_FINAL_LAPSE_MONTHS);
  const closed = await db
    .select({
      episodeId: episodes.id,
      endDate: episodes.endDate,
      closureReason: episodes.closureReason,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
    })
    .from(episodes)
    .innerJoin(participants, eq(participants.id, episodes.participantId))
    .where(and(isLatestClosedEpisode, sql`${episodes.endDate} >= ${earliest}`));

  const calls = await callsFor(db, closed.map((c) => c.episodeId));
  const horizon = addMonths(today, 1);
  const items = closed.flatMap((episode) =>
    followUpSchedule(episode.endDate!, calls.get(episode.episodeId) ?? [], today)
      .filter((m) => m.state === "due" || m.state === "overdue" || (m.state === "upcoming" && m.dueDate <= horizon))
      .map((m) => ({ ...episode, ...summarise(m) })),
  );
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    overdue: items.filter((i) => i.state === "overdue"),
    due: items.filter((i) => i.state === "due"),
    upcoming: items.filter((i) => i.state === "upcoming"),
  };
}

function summarise(m: Milestone) {
  const last = m.attempts.at(-1);
  return {
    months: m.months,
    dueDate: m.dueDate,
    lapsesOn: m.lapsesOn,
    state: m.state,
    attempts: m.attempts.length,
    lastAttemptAt: last?.calledAt ?? null,
  };
}

// The schedule shown on a closed record: every milestone, with each
// attempt and who made it. Null when there's nothing to follow up — an
// active participant, or one who has never had an episode.
export async function scheduleForParticipant(db: Db, participantId: string) {
  const [episode] = await db
    .select({ id: episodes.id, endDate: episodes.endDate })
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), isLatestClosedEpisode));
  if (!episode?.endDate) return null;
  const calls = await callsFor(db, [episode.id]);
  return {
    episodeId: episode.id,
    endDate: episode.endDate,
    milestones: followUpSchedule(episode.endDate, calls.get(episode.id) ?? []),
  };
}

export async function recordCall(db: Db, input: FollowUpCall, actorId: string) {
  const [episode] = await db
    .select({ id: episodes.id, participantId: episodes.participantId, endDate: episodes.endDate })
    .from(episodes)
    .where(eq(episodes.id, input.episodeId));
  if (!episode) throw notFound("Episode not found");

  const [latest] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, input.episodeId), isLatestClosedEpisode));
  if (!latest || !episode.endDate) {
    throw conflict("Follow-up calls are for a closed case that hasn't been readmitted since");
  }

  const calls = await callsFor(db, [episode.id]);
  const milestone = followUpSchedule(episode.endDate, calls.get(episode.id) ?? []).find(
    (m) => m.months === input.milestoneMonths,
  )!;
  if (milestone.state === "completed") {
    throw conflict(`The ${milestone.months}-month call already has a result`);
  }
  if (milestone.state === "upcoming") {
    throw unprocessable(
      `The ${milestone.months}-month call isn't due until ${milestone.dueDate} (it can be made from ${milestone.opensOn})`,
    );
  }

  const [row] = await db
    .insert(followUpCalls)
    .values({
      participantId: episode.participantId,
      episodeId: episode.id,
      milestoneMonths: input.milestoneMonths,
      outcome: input.outcome,
      note: input.note ?? null,
      servicesFeedback: input.servicesFeedback ?? null,
      calledById: actorId,
    })
    .returning();

  await writeAudit(db, {
    actorUserId: actorId,
    action: "follow_up.recorded",
    entityType: "participant",
    entityId: episode.participantId,
    detail: `${input.milestoneMonths}-month call: ${input.outcome}`,
  });
  return row;
}

// M12: "This may lead to re-enrollment." Everyone who asked to come back
// and hasn't been readmitted since — which is derived, so readmitting
// them is what takes them off this list; nobody has to tick it off.
export async function listReEnrollmentRequests(db: Db) {
  return db
    .select({
      callId: followUpCalls.id,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
      milestoneMonths: followUpCalls.milestoneMonths,
      note: followUpCalls.note,
      calledAt: followUpCalls.calledAt,
      calledByName: users.displayName,
    })
    .from(followUpCalls)
    .innerJoin(participants, eq(participants.id, followUpCalls.participantId))
    .innerJoin(users, eq(users.id, followUpCalls.calledById))
    .where(
      and(
        eq(followUpCalls.outcome, "reached_wants_services"),
        sql`not exists (
          select 1 from ${episodes} e
           where e.participant_id = ${followUpCalls.participantId}
             and (e.status = 'open' or e.start_date >= ${followUpCalls.calledAt}::date)
        )`,
      ),
    )
    .orderBy(desc(followUpCalls.calledAt));
}

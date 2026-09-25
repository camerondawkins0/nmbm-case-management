import type { Db } from "@nmbm/db";
import { assignments, episodes } from "@nmbm/db";
import { eq, and, isNull, isNotNull, gte, desc, sql } from "drizzle-orm";
import { getPermissions } from "../plugins/authorize.js";
import { getSetting } from "./settings.js";

export type CallerScope = {
  id: string;
  // U5: "own assignments" for a front-line worker. Anyone without
  // participants.read.all only ever sees their own caseload, and that's
  // enforced in the query rather than in the UI.
  canReadAll: boolean;
  // R10: may find and open any closed record — intake, for readmission.
  // Implied by read.all. Grants nothing on active cases.
  canReadClosed: boolean;
};

export async function resolveScope(db: Db, userId: string): Promise<CallerScope> {
  const permissions = await getPermissions(db, userId);
  const canReadAll = permissions.has("participants.read.all");
  return {
    id: userId,
    canReadAll,
    canReadClosed: canReadAll || permissions.has("participants.read.closed"),
  };
}

export async function caseloadParticipantIds(db: Db, workerId: string): Promise<string[]> {
  const rows = await db
    .select({ participantId: assignments.participantId })
    .from(assignments)
    .where(and(eq(assignments.workerId, workerId), isNull(assignments.endedAt)));
  return rows.map((r) => r.participantId);
}

const hasOpenEpisode = (participantId: unknown) =>
  sql`exists (select 1 from ${episodes} e where e.participant_id = ${participantId} and e.status = 'open')`;

// R10, NMBM's answer: the worker "should still see them, especially if
// they are the last assigned case manager". So: only the *last*
// assignment counts — a worker who handed the case on months before it
// closed gets nothing — and only for the configured window after it
// ended. Read access only; a closed record takes no notes.
export async function formerCaseload(
  db: Db,
  workerId: string,
): Promise<{ participantId: string; accessUntil: Date }[]> {
  const days = await getSetting(db, "former_worker_access_days");
  if (days <= 0) return [];
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const latest = db
    .selectDistinctOn([assignments.participantId], {
      participantId: assignments.participantId,
      workerId: assignments.workerId,
      endedAt: assignments.endedAt,
    })
    .from(assignments)
    .orderBy(assignments.participantId, desc(assignments.startedAt))
    .as("latest");

  const rows = await db
    .select({ participantId: latest.participantId, endedAt: latest.endedAt })
    .from(latest)
    .where(
      and(
        eq(latest.workerId, workerId),
        isNotNull(latest.endedAt),
        gte(latest.endedAt, cutoff),
        sql`not ${hasOpenEpisode(latest.participantId)}`,
      ),
    );

  return rows.map((r) => ({
    participantId: r.participantId,
    accessUntil: new Date(r.endedAt!.getTime() + days * 86_400_000),
  }));
}

async function isClosedRecord(db: Db, participantId: string) {
  // Closed means has had an episode and has none open — a record that
  // never had one isn't a former participant.
  const [row] = await db
    .select({
      any: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${episodes.status} = 'open')::int`,
    })
    .from(episodes)
    .where(eq(episodes.participantId, participantId));
  return (row?.any ?? 0) > 0 && (row?.open ?? 0) === 0;
}

// Guessing another worker's participant id must not be a way around
// caseload scoping, so every by-id read goes through this.
export async function canSeeParticipant(
  db: Db,
  caller: CallerScope,
  participantId: string,
): Promise<boolean> {
  if (caller.canReadAll) return true;
  if ((await caseloadParticipantIds(db, caller.id)).includes(participantId)) return true;
  if (caller.canReadClosed && (await isClosedRecord(db, participantId))) return true;
  return (await formerCaseload(db, caller.id)).some((f) => f.participantId === participantId);
}

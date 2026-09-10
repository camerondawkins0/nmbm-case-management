import type { Db } from "@nmbm/db";
import { assignments } from "@nmbm/db";
import { eq, and, isNull } from "drizzle-orm";
import { getPermissions } from "../plugins/authorize.js";

export type CallerScope = {
  id: string;
  // U5: "own assignments" for a front-line worker. Anyone without
  // participants.read.all only ever sees their own caseload, and that's
  // enforced in the query rather than in the UI.
  canReadAll: boolean;
};

export async function resolveScope(db: Db, userId: string): Promise<CallerScope> {
  const permissions = await getPermissions(db, userId);
  return { id: userId, canReadAll: permissions.has("participants.read.all") };
}

export async function caseloadParticipantIds(db: Db, workerId: string): Promise<string[]> {
  const rows = await db
    .select({ participantId: assignments.participantId })
    .from(assignments)
    .where(and(eq(assignments.workerId, workerId), isNull(assignments.endedAt)));
  return rows.map((r) => r.participantId);
}

// Guessing another worker's participant id must not be a way around
// caseload scoping, so every by-id read goes through this.
export async function canSeeParticipant(
  db: Db,
  caller: CallerScope,
  participantId: string,
): Promise<boolean> {
  if (caller.canReadAll) return true;
  const ids = await caseloadParticipantIds(db, caller.id);
  return ids.includes(participantId);
}

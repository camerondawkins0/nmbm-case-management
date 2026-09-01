import type { Db } from "@nmbm/db";
import { participants, assignments } from "@nmbm/db";
import { eq, and, isNull } from "drizzle-orm";
import type { ParticipantCreate } from "@nmbm/shared";

// U5: "own assignments" is enforced here, server-side — never trust a
// client-side filter. Callers with participants.read.all skip the join.
export async function listForWorker(db: Db, workerId: string) {
  return db
    .select({ participant: participants })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.participantId))
    .where(and(eq(assignments.workerId, workerId), isNull(assignments.endedAt)));
}

export async function listAll(db: Db) {
  return db.select().from(participants);
}

export async function insert(db: Db, input: ParticipantCreate) {
  const [row] = await db
    .insert(participants)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
    })
    .returning();
  return row;
}

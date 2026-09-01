import type { Db } from "@nmbm/db";
import { assignments } from "@nmbm/db";
import type { ParticipantCreate } from "@nmbm/shared";
import * as repository from "./repository.js";

export async function createParticipant(
  db: Db,
  input: ParticipantCreate,
  createdById: string,
) {
  const participant = await repository.insert(db, input);
  // M4: every participant is assigned to a named worker at intake.
  if (input.assignedWorkerId) {
    await db.insert(assignments).values({
      participantId: participant.id,
      workerId: input.assignedWorkerId,
      assignedById: createdById,
    });
  }
  return participant;
}

export async function listVisibleParticipants(
  db: Db,
  caller: { id: string; canReadAll: boolean },
) {
  if (caller.canReadAll) {
    return repository.listAll(db);
  }
  const rows = await repository.listForWorker(db, caller.id);
  return rows.map((r) => r.participant);
}

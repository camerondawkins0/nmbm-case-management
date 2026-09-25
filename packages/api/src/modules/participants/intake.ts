import type { Db } from "@nmbm/db";
import { participants, assignments, episodes, users } from "@nmbm/db";
import { eq, and, isNull } from "drizzle-orm";
import type { Intake } from "@nmbm/shared";
import { CARE_PLAN_COMPLETION_DAYS } from "@nmbm/shared";
import { AppError, conflict, notFound } from "../../plugins/errors.js";
import { possibleDuplicates } from "./repository.js";
import { writeAudit } from "../../plugins/audit.js";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Intake is one act, not three screens: the record, the episode that
// starts the M9 clock, and the named worker (M4) all land together, so
// a participant can never exist in the half-state of being enrolled
// with nobody responsible for them.
export async function admitParticipant(db: Db, input: Intake, actorId: string) {
  const [worker] = await db.select().from(users).where(eq(users.id, input.assignedWorkerId));
  if (!worker) throw notFound("Assigned worker not found");
  if (!worker.active) throw conflict("That worker's account is deactivated");

  // R10's returning participant belongs on their existing record, with
  // their history, not on a second one. The refusal doesn't say whose
  // record matched: the person at the desk may not be allowed to open it,
  // and search shows them the ones they can.
  const duplicates = await possibleDuplicates(db, input.firstName, input.lastName, input.dateOfBirth);
  if (duplicates.length > 0 && !input.confirmNotDuplicate) {
    throw new AppError(
      409,
      "possible_duplicate",
      "A record with this date of birth and a matching name already exists. If this is a returning client, find them and readmit them instead. If it's a different person, confirm that and admit again.",
    );
  }

  const carePlanDue = new Date(input.startDate);
  carePlanDue.setDate(carePlanDue.getDate() + CARE_PLAN_COMPLETION_DAYS);

  return db.transaction(async (tx) => {
    const [participant] = await tx
      .insert(participants)
      .values({
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        payer: input.payer,
      })
      .returning();

    const [episode] = await tx
      .insert(episodes)
      .values({
        participantId: participant.id,
        startDate: input.startDate,
        carePlanDueDate: isoDate(carePlanDue),
      })
      .returning();

    await tx.insert(assignments).values({
      participantId: participant.id,
      workerId: input.assignedWorkerId,
      assignedById: actorId,
    });

    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: "participant.admitted",
      entityType: "participant",
      entityId: participant.id,
      detail:
        `episode ${episode.id} opened, assigned to ${worker.displayName}` +
        (duplicates.length > 0
          ? `; admitted as a different person despite ${duplicates.length} record(s) with the same date of birth and a matching name`
          : ""),
    });

    return { participant, episode };
  });
}

// U9: "caseloads would be reassigned". The prior row is closed rather
// than overwritten, so who held the case in March is still answerable
// in October.
export async function reassign(db: Db, participantId: string, workerId: string, actorId: string) {
  const [worker] = await db.select().from(users).where(eq(users.id, workerId));
  if (!worker) throw notFound("Worker not found");
  if (!worker.active) throw conflict("That worker's account is deactivated");

  // R10: an assignment is responsibility for an active case. Handing a
  // closed record to somebody would put it back on a caseload with no
  // episode behind it — readmission is the way back, and it opens both.
  const [openEpisode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.participantId, participantId), eq(episodes.status, "open")));
  if (!openEpisode) throw conflict("This record is closed — readmit the participant to assign them");

  const [current] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.participantId, participantId), isNull(assignments.endedAt)));

  if (current?.workerId === workerId) {
    throw conflict("Already assigned to that worker");
  }

  return db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(assignments)
        .set({ endedAt: new Date() })
        .where(eq(assignments.id, current.id));
    }
    const [row] = await tx
      .insert(assignments)
      .values({ participantId, workerId, assignedById: actorId })
      .returning();

    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: "participant.reassigned",
      entityType: "participant",
      entityId: participantId,
      detail: `assigned to ${worker.displayName}`,
    });

    return row;
  });
}

// Who a supervisor can hand a case to. Deactivated accounts are
// excluded so a departing worker can't be assigned new work (U9).
export async function listAssignableWorkers(db: Db) {
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(users.displayName);
}

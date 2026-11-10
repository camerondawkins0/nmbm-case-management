import type { Db } from "@nmbm/db";
import { participants, assignments, episodes, users } from "@nmbm/db";
import { eq, and, isNull } from "drizzle-orm";
import type { Intake } from "@nmbm/shared";
import { CARE_PLAN_COMPLETION_DAYS, PARTICIPANT_DETAIL_FIELDS } from "@nmbm/shared";
import { AppError, conflict } from "../../plugins/errors.js";
import { possibleDuplicates } from "./repository.js";
import { CIN_IN_USE, isCinConflict } from "./service.js";
import { writeAudit } from "../../plugins/audit.js";
import { markAdmitted } from "../incoming-referrals/service.js";
import { assertCaseloadWorker } from "../../lib/caseload.js";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Intake is one act, not three screens: the record, the episode that
// starts the M9 clock, and the named worker (M4) all land together, so
// a participant can never exist in the half-state of being enrolled
// with nobody responsible for them.
export async function admitParticipant(db: Db, input: Intake, actorId: string) {
  const worker = await assertCaseloadWorker(db, input.assignedWorkerId);

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

  const details = Object.fromEntries(PARTICIPANT_DETAIL_FIELDS.map((k) => [k, input[k] ?? null]));
  try {
    return await db.transaction(async (tx) => {
      const [participant] = await tx
        .insert(participants)
        .values({
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth,
          payer: input.payer,
          ...details,
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

      // Admitted from a referral: the referral closes in the same act, so
      // there's never a person on the caseload whose referral still sits
      // in intake's queue as unanswered.
      if (input.incomingReferralId) {
        await markAdmitted(
          tx as unknown as Db,
          input.incomingReferralId,
          { participantId: participant.id, episodeId: episode.id },
          actorId,
        );
      }

      return { participant, episode };
    });
  } catch (e) {
    // Stronger than a name match, and not something confirmNotDuplicate
    // waves through: the same CIN is the same person, or a mistyped
    // number. The unique index decides.
    if (isCinConflict(e)) throw new AppError(409, "cin_in_use", CIN_IN_USE);
    throw e;
  }
}

// U9: "caseloads would be reassigned". The prior row is closed rather
// than overwritten, so who held the case in March is still answerable
// in October.
export async function reassign(db: Db, participantId: string, workerId: string, actorId: string) {
  const worker = await assertCaseloadWorker(db, workerId);

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

// Everyone active, for choosing a class facilitator: running a class
// isn't holding a caseload.
export async function listActiveStaff(db: Db) {
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(users.displayName);
}

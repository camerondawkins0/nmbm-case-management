import type { Db } from "@nmbm/db";
import { episodes, assignments, users } from "@nmbm/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import type { EpisodeCreate, EpisodeClose } from "@nmbm/shared";
import { NO_CONTACT_DISENROLLMENT_THRESHOLD } from "@nmbm/shared";
import { notFound, unprocessable, conflict } from "../../plugins/errors.js";
import { noContactState } from "../../lib/rules.js";
import * as repository from "./repository.js";
import * as notesRepository from "../notes/repository.js";
import { writeAudit } from "../../plugins/audit.js";

// Readmission (M2): a new episode, linked to the one it follows, with a
// named worker — the same one act as intake, for somebody already on
// file. The new episode starts its own M6 run and M9 clock; nothing
// from the previous stay carries over except the history.
export async function openEpisode(db: Db, input: EpisodeCreate, actorId: string) {
  const [worker] = await db.select().from(users).where(eq(users.id, input.assignedWorkerId));
  if (!worker) throw notFound("Assigned worker not found");
  if (!worker.active) throw conflict("That worker's account is deactivated");

  const history = await db
    .select()
    .from(episodes)
    .where(eq(episodes.participantId, input.participantId))
    .orderBy(desc(episodes.startDate), desc(episodes.createdAt));
  if (history.some((e) => e.status === "open")) {
    throw conflict("This participant already has an open episode");
  }
  const previous = history[0];
  if (previous?.endDate && input.startDate < previous.endDate) {
    throw unprocessable(`A readmission can't start before the last episode ended (${previous.endDate})`);
  }

  return db.transaction(async (tx) => {
    const episode = await repository.insert(tx as unknown as Db, {
      participantId: input.participantId,
      startDate: input.startDate,
      readmittedFromEpisodeId: previous?.id ?? null,
    });
    await tx.insert(assignments).values({
      participantId: input.participantId,
      workerId: input.assignedWorkerId,
      assignedById: actorId,
    });
    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: previous ? "participant.readmitted" : "episode.opened",
      entityType: "participant",
      entityId: input.participantId,
      detail: `episode ${episode.id} opened, assigned to ${worker.displayName}`,
    });
    return episode;
  });
}

async function loadOpenEpisode(db: Db, episodeId: string) {
  const episode = await repository.findById(db, episodeId);
  if (!episode) throw notFound("Episode not found");
  if (episode.status === "closed") throw conflict("Episode is already closed");
  return episode;
}

// M6: the ladder is a gate, not a suggestion. Disenrolling for no
// contact needs five failed attempts, and for a Molina participant the
// warning letter has to have gone out first. Every other closure reason
// is an ordinary exit and isn't blocked.
export async function closeEpisode(
  db: Db,
  episodeId: string,
  input: EpisodeClose,
  actorId: string,
) {
  const episode = await loadOpenEpisode(db, episodeId);

  if (input.closureReason === "no_contact") {
    const [count, payer] = await Promise.all([
      notesRepository.consecutiveNoContacts(db, episodeId),
      notesRepository.participantPayer(db, episode.participantId),
    ]);
    const state = noContactState({
      episodeId,
      payer,
      consecutiveNoContacts: count,
      carePlanId: null,
      carePlanStatus: null,
      carePlanDueDate: null,
      carePlanReviewDue: null,
      disenrollmentLetterSentAt: episode.disenrollmentLetterSentAt,
    });

    if (!state.disenrollmentEligible) {
      throw unprocessable(
        `Needs ${NO_CONTACT_DISENROLLMENT_THRESHOLD} failed contact attempts before disenrolment; ` +
          `there are ${state.count}. ${state.attemptsUntilDisenrollment} more required.`,
      );
    }
    if (state.molinaLetterRequired) {
      throw unprocessable(
        "Molina requires the disenrolment warning letter to be sent before closing. " +
          "Record it on the episode first.",
      );
    }
  }

  // R10: leaving the active caseload is part of closing, not a later
  // sweep. The assignment is ended rather than removed, so who held the
  // case is still answerable; the worker's list, their dashboard and
  // U9's "reassign before deactivating" check all stop counting this
  // person the moment the transaction commits.
  return db.transaction(async (tx) => {
    const closed = await repository.close(tx as unknown as Db, episodeId, input);
    const ended = await tx
      .update(assignments)
      .set({ endedAt: new Date() })
      .where(and(eq(assignments.participantId, episode.participantId), isNull(assignments.endedAt)))
      .returning({ workerId: assignments.workerId });
    await writeAudit(tx as unknown as Db, {
      actorUserId: actorId,
      action: "episode.closed",
      entityType: "episode",
      entityId: episodeId,
      detail: `${input.closureReason}; ${ended.length} assignment(s) ended`,
    });
    return closed;
  });
}

export async function recordDisenrollmentLetter(db: Db, episodeId: string, actorId: string) {
  const episode = await loadOpenEpisode(db, episodeId);
  if (episode.disenrollmentLetterSentAt) {
    throw conflict("Letter already recorded for this episode");
  }
  const [row] = await db
    .update(episodes)
    .set({ disenrollmentLetterSentAt: new Date() })
    .where(eq(episodes.id, episodeId))
    .returning();
  await writeAudit(db, {
    actorUserId: actorId,
    action: "episode.disenrollment_letter_recorded",
    entityType: "episode",
    entityId: episodeId,
  });
  return row;
}

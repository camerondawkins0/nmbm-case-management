import type { Db } from "@nmbm/db";
import { episodes } from "@nmbm/db";
import { eq } from "drizzle-orm";
import type { EpisodeCreate, EpisodeClose } from "@nmbm/shared";
import { NO_CONTACT_DISENROLLMENT_THRESHOLD } from "@nmbm/shared";
import { notFound, unprocessable, conflict } from "../../plugins/errors.js";
import { noContactState } from "../../lib/rules.js";
import * as repository from "./repository.js";
import * as notesRepository from "../notes/repository.js";

export async function openEpisode(db: Db, input: EpisodeCreate) {
  return repository.insert(db, input);
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
export async function closeEpisode(db: Db, episodeId: string, input: EpisodeClose) {
  const episode = await loadOpenEpisode(db, episodeId);

  if (input.closureReason === "no_contact") {
    const [count, payer] = await Promise.all([
      notesRepository.consecutiveNoContacts(db, episode.participantId),
      notesRepository.participantPayer(db, episode.participantId),
    ]);
    const state = noContactState({
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

  return repository.close(db, episodeId, input);
}

export async function recordDisenrollmentLetter(db: Db, episodeId: string) {
  const episode = await loadOpenEpisode(db, episodeId);
  if (episode.disenrollmentLetterSentAt) {
    throw conflict("Letter already recorded for this episode");
  }
  const [row] = await db
    .update(episodes)
    .set({ disenrollmentLetterSentAt: new Date() })
    .where(eq(episodes.id, episodeId))
    .returning();
  return row;
}

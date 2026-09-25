import type { Db } from "@nmbm/db";
import type { NoteCreate } from "@nmbm/shared";
import { noContactState } from "../../lib/rules.js";
import * as repository from "./repository.js";
import { conflict } from "../../plugins/errors.js";

// M6: logging an attempt is what advances the ladder, so the response
// tells the worker where they now stand rather than making them go
// looking. The prompt is a consequence of the note, not a separate
// screen they have to remember to check.
export async function recordNote(
  db: Db,
  input: NoteCreate,
  authorId: string,
  // U6 describes a supervisor reviewing a CHW's or intern's work. A
  // reviewer's own note has nobody above it in the chain, so queueing
  // it for review would just park it forever.
  authorIsReviewer: boolean,
) {
  // The M6 run is counted per episode, so a note filed against a closed
  // episode — or somebody else's — would silently fall out of the count
  // the disenrolment gate relies on. Only the open one takes notes.
  const episode = await repository.openEpisodeFor(db, input.participantId);
  if (!episode) throw conflict("This participant has no open episode — readmit them first");
  if (episode.id !== input.episodeId) throw conflict("Notes can only be added to the open episode");

  const note = await repository.insert(db, input, authorId, authorIsReviewer);

  const [count, payer] = await Promise.all([
    repository.consecutiveNoContacts(db, episode.id),
    repository.participantPayer(db, input.participantId),
  ]);

  const state = noContactState({
    episodeId: episode.id,
    payer,
    consecutiveNoContacts: count,
    carePlanId: null,
    carePlanStatus: null,
    carePlanDueDate: null,
    carePlanReviewDue: null,
    disenrollmentLetterSentAt: episode.disenrollmentLetterSentAt,
  });

  return { note, noContact: state };
}

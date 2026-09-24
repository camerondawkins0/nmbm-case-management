import type { Db } from "@nmbm/db";
import type { NoteCreate } from "@nmbm/shared";
import { noContactState } from "../../lib/rules.js";
import * as repository from "./repository.js";

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
  const note = await repository.insert(db, input, authorId, authorIsReviewer);

  const [count, payer, episode] = await Promise.all([
    repository.consecutiveNoContacts(db, input.participantId),
    repository.participantPayer(db, input.participantId),
    repository.openEpisodeFor(db, input.participantId),
  ]);

  const state = noContactState({
    payer,
    consecutiveNoContacts: count,
    carePlanId: null,
    carePlanStatus: null,
    carePlanDueDate: null,
    carePlanReviewDue: null,
    disenrollmentLetterSentAt: episode?.disenrollmentLetterSentAt ?? null,
  });

  return { note, noContact: state };
}

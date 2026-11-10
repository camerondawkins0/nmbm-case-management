import type { Db } from "@nmbm/db";
import { todayInOrg, type NoteCreate, type Permission } from "@nmbm/shared";
import { noContactState } from "../../lib/rules.js";
import * as repository from "./repository.js";
import { conflict, unprocessable } from "../../plugins/errors.js";

// A contact can be written up after the day it happened, but it can't
// have happened tomorrow, or before this stay began — M6 counts the
// attempts in this order, within the stay.
export function assertServiceDate(serviceDate: string, episodeStartDate: string) {
  const today = todayInOrg();
  if (serviceDate > today) throw unprocessable("The date of service can't be in the future");
  if (serviceDate < episodeStartDate) {
    throw unprocessable(`The date of service can't be before this stay began (${episodeStartDate})`);
  }
}

// M6: logging an attempt is what advances the ladder, so the response
// tells the worker where they now stand rather than making them go
// looking. The prompt is a consequence of the note, not a separate
// screen they have to remember to check.
export async function recordNote(
  db: Db,
  input: NoteCreate,
  authorId: string,
  held: Set<Permission>,
) {
  // Which chain the note joins (U6), fixed now so later changes to the
  // author's roles don't move it between queues.
  const clinicalReview = held.has("notes.reviewed_clinically");
  // Somebody who could sign this kind of note off has nobody above them
  // in its chain, so queueing their own would just park it forever.
  const selfApproved = held.has(clinicalReview ? "notes.approve.clinical" : "notes.approve");
  // The M6 run is counted per episode, so a note filed against a closed
  // episode — or somebody else's — would silently fall out of the count
  // the disenrollment gate relies on. Only the open one takes notes.
  const episode = await repository.openEpisodeFor(db, input.participantId);
  if (!episode) throw conflict("This participant has no open episode — readmit them first");
  if (episode.id !== input.episodeId) throw conflict("Notes can only be added to the open episode");

  const serviceDate = input.serviceDate ?? todayInOrg();
  assertServiceDate(serviceDate, episode.startDate);

  const note = await repository.insert(db, { ...input, serviceDate }, authorId, { clinicalReview, selfApproved });

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

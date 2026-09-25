import type { Db } from "@nmbm/db";
import { assignments } from "@nmbm/db";
import type { ParticipantCreate, ParticipantListQuery } from "@nmbm/shared";
import { notFound, forbidden } from "../../plugins/errors.js";
import { caseloadParticipantIds, canSeeParticipant, type CallerScope } from "../../lib/caseload.js";
import { participantFlags, needsAttention } from "../../lib/rules.js";
import * as repository from "./repository.js";
import * as consentService from "../consents/service.js";
import * as referralService from "../referrals/service.js";
import * as programService from "../programs/service.js";

function decorate(row: Awaited<ReturnType<typeof repository.findById>>) {
  const flags = participantFlags(row);
  return { ...row, flags, needsAttention: needsAttention(flags) };
}

export async function listVisibleParticipants(db: Db, caller: CallerScope) {
  // Active only (R10) — the repository decides that, not this layer.
  const rows = caller.canReadAll
    ? await repository.listAll(db)
    : await repository.listForParticipantIds(db, await caseloadParticipantIds(db, caller.id));
  return rows.map(decorate);
}

// R10: closed records are reached by asking for them. A front-line
// worker's caseload is their open assignments, and closing an episode
// ends the assignment, so there is nothing closed on it to list —
// finding a former participant is a supervisor's or intake's lookup.
export async function listClosedParticipants(db: Db, caller: CallerScope) {
  if (!caller.canReadAll) return [];
  return repository.listClosed(db);
}

export async function listParticipants(db: Db, caller: CallerScope, query: ParticipantListQuery) {
  return query.status === "closed"
    ? listClosedParticipants(db, caller)
    : listVisibleParticipants(db, caller);
}

export async function getParticipant(db: Db, caller: CallerScope, id: string) {
  if (!(await canSeeParticipant(db, caller, id))) {
    // Deliberately the same shape as a genuine miss: confirming that an
    // id exists but belongs to someone else's caseload is itself a leak.
    throw notFound("Participant not found");
  }
  const row = await repository.findById(db, id);
  if (!row) throw notFound("Participant not found");
  const [episodes, notes, consents, referrals, programs] = await Promise.all([
    repository.listEpisodes(db, id),
    repository.listNotes(db, id),
    consentService.listForParticipant(db, id),
    referralService.listForParticipant(db, id),
    programService.listEnrollmentsForParticipant(db, id),
  ]);
  return { ...decorate(row), episodes, notes, consents, referrals, programs };
}

export async function createParticipant(
  db: Db,
  input: ParticipantCreate,
  createdById: string,
) {
  const participant = await repository.insert(db, input);
  // M4: every participant belongs to a named worker.
  if (input.assignedWorkerId) {
    await db.insert(assignments).values({
      participantId: participant.id,
      workerId: input.assignedWorkerId,
      assignedById: createdById,
    });
  }
  return participant;
}

export async function assertCanSee(db: Db, caller: CallerScope, participantId: string) {
  if (!(await canSeeParticipant(db, caller, participantId))) {
    throw forbidden("Not on your caseload");
  }
}

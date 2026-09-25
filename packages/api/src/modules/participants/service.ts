import type { Db } from "@nmbm/db";
import { assignments } from "@nmbm/db";
import type { ParticipantCreate, ParticipantListQuery, ParticipantSearch } from "@nmbm/shared";
import { notFound, forbidden } from "../../plugins/errors.js";
import {
  caseloadParticipantIds,
  canSeeParticipant,
  formerCaseload,
  type CallerScope,
} from "../../lib/caseload.js";
import { participantFlags, needsAttention } from "../../lib/rules.js";
import * as repository from "./repository.js";
import * as consentService from "../consents/service.js";
import * as referralService from "../referrals/service.js";
import * as programService from "../programs/service.js";
import * as followUpService from "../follow-ups/service.js";

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

// R10: closed records are reached by asking for them. Intake (and
// anyone who reads all) sees every closed record, to find a returning
// participant. A front-line worker sees only the ones they were the
// last worker on, for the configured window — with the date that
// access ends, so it doesn't just vanish.
export async function listClosedParticipants(db: Db, caller: CallerScope) {
  const rows = await repository.listClosed(db);
  if (caller.canReadClosed) return rows.map((r) => ({ ...r, accessUntil: null }));
  const former = await formerCaseload(db, caller.id);
  const until = new Map(former.map((f) => [f.participantId, f.accessUntil]));
  return rows
    .filter((r) => until.has(r.id))
    .map((r) => ({ ...r, accessUntil: until.get(r.id)!.toISOString().slice(0, 10) }));
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
  const [episodes, notes, consents, referrals, programs, followUps] = await Promise.all([
    repository.listEpisodes(db, id),
    repository.listNotes(db, id),
    consentService.listForParticipant(db, id),
    referralService.listForParticipant(db, id),
    programService.listEnrollmentsForParticipant(db, id),
    followUpService.scheduleForParticipant(db, id),
  ]);
  return { ...decorate(row), episodes, notes, consents, referrals, programs, followUps };
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

// Readmission search. Only returns what the person searching could open
// anyway — the same three rules as the record itself (U5 caseload, R10
// closed records for intake, the last worker's window) — so a search
// can't be used to learn that someone is on another worker's caseload.
export async function searchParticipants(db: Db, caller: CallerScope, input: ParticipantSearch) {
  const candidates = await repository.search(db, input);
  if (caller.canReadAll) return candidates;
  const [caseload, former] = await Promise.all([
    caseloadParticipantIds(db, caller.id),
    formerCaseload(db, caller.id),
  ]);
  const visible = new Set([...caseload, ...former.map((f) => f.participantId)]);
  return candidates
    .filter((c) => visible.has(c.id) || (caller.canReadClosed && !c.active && c.lastEndDate !== null))
    .map((c) => (visible.has(c.id) ? c : { ...c, workerName: null }));
}

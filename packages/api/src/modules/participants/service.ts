import type { Db } from "@nmbm/db";
import { assignments } from "@nmbm/db";
import {
  PARTICIPANT_DETAIL_LABELS,
  type ParticipantCreate,
  type ParticipantDetails,
  type ParticipantListQuery,
  type ParticipantSearch,
} from "@nmbm/shared";
import { notFound, forbidden, conflict } from "../../plugins/errors.js";
import { writeAudit } from "../../plugins/audit.js";
import {
  caseloadParticipantIds,
  canSeeParticipant,
  canWriteParticipant,
  formerCaseload,
  type CallerScope,
} from "../../lib/caseload.js";
import { participantFlags, needsAttention } from "../../lib/rules.js";
import * as repository from "./repository.js";
import * as consentService from "../consents/service.js";
import * as referralService from "../referrals/service.js";
import * as programService from "../programs/service.js";
import * as followUpService from "../follow-ups/service.js";
import * as incomingReferralService from "../incoming-referrals/service.js";

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
  const [canWrite, details, episodes, notes, consents, referrals, programs, followUps, referralsIn] = await Promise.all([
    canWriteParticipant(db, caller, id),
    repository.findDetails(db, id),
    repository.listEpisodes(db, id),
    repository.listNotes(db, id),
    consentService.listForParticipant(db, id),
    referralService.listForParticipant(db, id),
    programService.listEnrollmentsForParticipant(db, id),
    followUpService.scheduleForParticipant(db, id),
    incomingReferralService.listForParticipant(db, id),
  ]);
  // canWrite tells the page which buttons to show; the server checks
  // again on every write, so it's a convenience, not the control.
  return { ...decorate(row), canWrite, details, episodes, notes, consents, referrals, programs, followUps, referralsIn };
}

export const CIN_IN_USE =
  "A record with this Medi-Cal CIN already exists. If this is a returning client, find them and readmit them; otherwise check the number.";

// A CIN names one person, so a second record with it is refused. The
// unique index decides; this turns its refusal into something to act on.
export function isCinConflict(e: unknown) {
  return (e as { code?: string; constraint_name?: string }).code === "23505" &&
    (e as { constraint_name?: string }).constraint_name === "participants_medi_cal_cin";
}

// Phones change and people move. Only what's sent changes, and the
// audit line names the fields, never their values: those are PHI.
export async function updateDetails(db: Db, id: string, input: Partial<ParticipantDetails>, actorId: string) {
  const current = await repository.findDetails(db, id);
  if (!current) throw notFound("Participant not found");
  const changed = (Object.keys(input) as (keyof ParticipantDetails)[]).filter(
    (k) => (input[k] ?? null) !== (current[k] ?? null),
  );
  if (changed.length === 0) return current;
  const values = Object.fromEntries(changed.map((k) => [k, input[k] ?? null])) as Partial<ParticipantDetails>;
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    let row;
    try {
      row = await repository.updateDetails(tx, id, values);
    } catch (e) {
      if (isCinConflict(e)) throw conflict(CIN_IN_USE);
      throw e;
    }
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "participant.details_updated",
      entityType: "participant",
      entityId: id,
      detail: `Changed: ${changed.map((k) => PARTICIPANT_DETAIL_LABELS[k]).join(", ")}`,
    });
    return row;
  });
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

// Every write to a record goes through this rather than assertCanSee:
// seeing a closed record (the former worker's window, intake) doesn't
// make it yours to change. See canWriteParticipant.
export async function assertCanWrite(db: Db, caller: CallerScope, participantId: string) {
  if (!(await canWriteParticipant(db, caller, participantId))) {
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

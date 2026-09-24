import type { Db } from "@nmbm/db";
import type { CarePlanCreate, CarePlanReview } from "@nmbm/shared";
import { notFound, conflict, badRequest } from "../../plugins/errors.js";
import * as repository from "./repository.js";
import { writeAudit } from "../../plugins/audit.js";

export async function createCarePlan(db: Db, input: CarePlanCreate) {
  return repository.insert(db, input);
}

async function load(db: Db, id: string) {
  const plan = await repository.findById(db, id);
  if (!plan) throw notFound("Care plan not found");
  return plan;
}

export async function updateGoals(db: Db, id: string, goals: string) {
  const plan = await load(db, id);
  if (plan.status === "pending_review") {
    throw conflict("Plan is with the Clinical Director for review — it can't be edited now");
  }
  return repository.updateGoals(db, id, goals);
}

// U6: a CHW submits, they don't self-approve. Sending it back to the
// author is a state change, not a delete-and-redo, so the review note
// survives for them to read.
export async function submitForReview(db: Db, id: string) {
  const plan = await load(db, id);
  if (plan.status === "pending_review") throw conflict("Already submitted");
  if (plan.status === "approved") throw conflict("Already approved");
  return repository.setStatus(db, id, "pending_review", {});
}

export async function approve(db: Db, id: string, approverId: string) {
  const plan = await load(db, id);
  if (plan.status !== "pending_review") {
    throw conflict("Only a plan submitted for review can be approved");
  }
  const row = await repository.setStatus(db, id, "approved", {
    approvedById: approverId,
    resetReviewClock: true,
  });
  await writeAudit(db, {
    actorUserId: approverId,
    action: "care_plan.approved",
    entityType: "care_plan",
    entityId: id,
  });
  return row;
}

export async function returnForRevision(
  db: Db,
  id: string,
  input: CarePlanReview,
  reviewerId: string,
) {
  const plan = await load(db, id);
  if (plan.status !== "pending_review") {
    throw conflict("Only a plan submitted for review can be returned");
  }
  if (!input.reviewNote) {
    // Returning without saying why just costs the author a round trip.
    throw badRequest("Say why the plan is being returned");
  }
  const row = await repository.setStatus(db, id, "needs_revision", {
    reviewNote: input.reviewNote,
  });
  await writeAudit(db, {
    actorUserId: reviewerId,
    action: "care_plan.returned",
    entityType: "care_plan",
    entityId: id,
    detail: input.reviewNote,
  });
  return row;
}

export async function listAwaitingReview(db: Db) {
  return repository.listAwaitingReview(db);
}

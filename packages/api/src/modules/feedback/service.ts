import type { Db } from "@nmbm/db";
import type { FeedbackCreate, FeedbackStatusUpdate } from "@nmbm/shared";
import * as repository from "./repository.js";

export async function submitFeedback(db: Db, input: FeedbackCreate, submittedById: string) {
  return repository.insert(db, input, submittedById);
}

export async function listAllFeedback(db: Db) {
  return repository.listAll(db);
}

export async function listMyFeedback(db: Db, submittedById: string) {
  return repository.listBySubmitter(db, submittedById);
}

export async function updateFeedbackStatus(
  db: Db,
  id: string,
  input: FeedbackStatusUpdate,
  resolvedById: string,
) {
  return repository.updateStatus(db, id, input.status, input.resolutionNote, resolvedById);
}

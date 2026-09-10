import type { Db } from "@nmbm/db";
import { carePlans, participants, episodes, users } from "@nmbm/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import type { CarePlanCreate, CarePlanStatus } from "@nmbm/shared";
import { CARE_PLAN_REVIEW_INTERVAL_DAYS } from "@nmbm/shared";

export function nextReviewDate(from = new Date()): string {
  const due = new Date(from);
  due.setDate(due.getDate() + CARE_PLAN_REVIEW_INTERVAL_DAYS);
  return due.toISOString().slice(0, 10);
}

export async function insert(db: Db, input: CarePlanCreate) {
  const [row] = await db
    .insert(carePlans)
    .values({
      participantId: input.participantId,
      episodeId: input.episodeId,
      goals: input.goals,
      status: "draft",
      nextReviewDue: nextReviewDate(),
    })
    .returning();
  return row;
}

export async function findById(db: Db, id: string) {
  const [row] = await db.select().from(carePlans).where(eq(carePlans.id, id));
  return row;
}

export async function setStatus(
  db: Db,
  id: string,
  status: CarePlanStatus,
  fields: { reviewNote?: string | null; approvedById?: string | null; resetReviewClock?: boolean },
) {
  const [row] = await db
    .update(carePlans)
    .set({
      status,
      reviewNote: fields.reviewNote ?? null,
      approvedById: fields.approvedById ?? null,
      approvedAt: fields.approvedById ? new Date() : null,
      // M9: approving is what restarts the two-week review clock.
      ...(fields.resetReviewClock ? { nextReviewDue: nextReviewDate() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(carePlans.id, id))
    .returning();
  return row;
}

export async function updateGoals(db: Db, id: string, goals: string) {
  const [row] = await db
    .update(carePlans)
    .set({ goals, updatedAt: new Date() })
    .where(eq(carePlans.id, id))
    .returning();
  return row;
}

// U6: the Clinical Director's queue — plans submitted and waiting.
export async function listAwaitingReview(db: Db) {
  return db
    .select({
      id: carePlans.id,
      goals: carePlans.goals,
      status: carePlans.status,
      updatedAt: carePlans.updatedAt,
      participantId: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
    })
    .from(carePlans)
    .innerJoin(participants, eq(participants.id, carePlans.participantId))
    .where(eq(carePlans.status, "pending_review"))
    .orderBy(desc(carePlans.updatedAt));
}

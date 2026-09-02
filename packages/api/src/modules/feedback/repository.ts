import type { Db } from "@nmbm/db";
import { feedbackItems } from "@nmbm/db";
import { eq, desc } from "drizzle-orm";
import type { FeedbackCreate, FeedbackStatus } from "@nmbm/shared";

export async function insert(db: Db, input: FeedbackCreate, submittedById: string) {
  const [row] = await db
    .insert(feedbackItems)
    .values({ ...input, submittedById })
    .returning();
  return row;
}

export async function listAll(db: Db) {
  return db.select().from(feedbackItems).orderBy(desc(feedbackItems.createdAt));
}

export async function listBySubmitter(db: Db, submittedById: string) {
  return db
    .select()
    .from(feedbackItems)
    .where(eq(feedbackItems.submittedById, submittedById))
    .orderBy(desc(feedbackItems.createdAt));
}

export async function updateStatus(
  db: Db,
  id: string,
  status: FeedbackStatus,
  resolutionNote: string | undefined,
  resolvedById: string,
) {
  const isTerminal = status === "resolved" || status === "wont_fix";
  const [row] = await db
    .update(feedbackItems)
    .set({
      status,
      resolutionNote: resolutionNote ?? null,
      resolvedById: isTerminal ? resolvedById : null,
      resolvedAt: isTerminal ? new Date() : null,
    })
    .where(eq(feedbackItems.id, id))
    .returning();
  return row;
}

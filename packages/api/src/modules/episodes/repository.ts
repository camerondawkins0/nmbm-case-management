import type { Db } from "@nmbm/db";
import { episodes } from "@nmbm/db";
import { eq } from "drizzle-orm";
import type { EpisodeCreate, EpisodeClose } from "@nmbm/shared";
import { CARE_PLAN_COMPLETION_DAYS } from "@nmbm/shared";

export async function insert(db: Db, input: EpisodeCreate) {
  // M9: the 30-day care-plan completion countdown starts at enrolment,
  // so it's stamped here rather than computed at read time — the
  // deadline shouldn't move if the rule changes later.
  const carePlanDueDate = new Date(input.startDate);
  carePlanDueDate.setDate(carePlanDueDate.getDate() + CARE_PLAN_COMPLETION_DAYS);

  const [row] = await db
    .insert(episodes)
    .values({
      participantId: input.participantId,
      startDate: input.startDate,
      status: input.status,
      carePlanDueDate: carePlanDueDate.toISOString().slice(0, 10),
    })
    .returning();
  return row;
}

export async function findById(db: Db, id: string) {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id));
  return row;
}

export async function close(db: Db, id: string, input: EpisodeClose) {
  const [row] = await db
    .update(episodes)
    .set({
      status: "closed",
      endDate: new Date().toISOString().slice(0, 10),
      closureReason: input.closureReason,
      closureNote: input.closureNote ?? null,
    })
    .where(eq(episodes.id, id))
    .returning();
  return row;
}

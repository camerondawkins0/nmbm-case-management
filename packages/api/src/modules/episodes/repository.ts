import type { Db } from "@nmbm/db";
import { episodes } from "@nmbm/db";
import type { EpisodeCreate } from "@nmbm/shared";

export async function insert(db: Db, input: EpisodeCreate) {
  // M9: 30-day care-plan completion countdown starts at enrollment.
  const carePlanDueDate = new Date(input.startDate);
  carePlanDueDate.setDate(carePlanDueDate.getDate() + 30);

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

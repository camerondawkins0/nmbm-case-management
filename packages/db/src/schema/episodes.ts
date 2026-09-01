import { pgTable, uuid, date, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodeStatusEnum } from "./enums.js";

// M2: one record per participant, plus an episode with a start and an
// end. The end date is what answers "how many did we serve last
// quarter" without guessing. `readmittedFromEpisodeId` links a fresh
// episode back to the one it follows, for the readmission-after-release
// case NMBM described (M2) without merging the two into one record.
export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  status: episodeStatusEnum("status").notNull().default("open"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  readmittedFromEpisodeId: uuid("readmitted_from_episode_id"),
  // M9: 30-day completion deadline from enrollment — see
  // docs/agent/invariants.md, "Care plan has two independent clocks".
  carePlanDueDate: date("care_plan_due_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

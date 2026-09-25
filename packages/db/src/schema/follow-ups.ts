import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import { followUpOutcomeEnum } from "./enums.js";

// M12: one row per QA call attempt after disenrolment. The schedule
// itself isn't stored — due dates come from the episode's end date — so
// see docs/agent/invariants.md before adding a "due" column here.
export const followUpCalls = pgTable("follow_up_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  milestoneMonths: integer("milestone_months").notNull(),
  outcome: followUpOutcomeEnum("outcome").notNull(),
  note: text("note"),
  servicesFeedback: text("services_feedback"),
  calledById: uuid("called_by_id").notNull().references(() => users.id),
  calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
});

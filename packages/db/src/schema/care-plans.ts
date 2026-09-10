import { pgTable, uuid, text, timestamp, date } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import { carePlanStatusEnum } from "./enums.js";

// M9/M10: goals with a review clock. `nextReviewDue` advances every 2
// weeks while status is not "closed" — the service layer owns computing
// that, not a stored generated column, since the cadence rule (M9) may
// still change per docs/DISCOVERY_FOLLOWUP.md.
export const carePlans = pgTable("care_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  status: carePlanStatusEnum("status").notNull().default("draft"),
  goals: text("goals").notNull(),
  nextReviewDue: date("next_review_due"),
  // Why a plan was sent back, so the author can see it.
  reviewNote: text("review_note"),
  // U10: Clinical Director and Supervisor sign off.
  approvedById: uuid("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

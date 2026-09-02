import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { feedbackCategoryEnum, feedbackStatusEnum } from "./enums.js";

// NMBM has no dedicated IT/dev staff to triage this on their own
// (discovery M31) — every logged-in user can submit, triage happens
// externally. Status only ever moves forward; nothing here is deleted,
// per CLAUDE.md hard rule 1. See docs/SUPPORT.md for the review
// workflow this feeds.
export const feedbackItems = pgTable("feedback_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  submittedById: uuid("submitted_by_id").notNull().references(() => users.id),
  category: feedbackCategoryEnum("category").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: feedbackStatusEnum("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedById: uuid("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

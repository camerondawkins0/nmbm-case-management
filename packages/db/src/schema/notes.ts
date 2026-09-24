import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import { contactResultEnum, noteStatusEnum } from "./enums.js";

// M5/M6: contact_result is structured so consecutive no-contacts can be
// counted without parsing free text. The 3rd consecutive no_contact
// triggers the exit-documentation prompt and, for Molina participants,
// a required disenrollment-warning letter — see
// docs/agent/invariants.md.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  contactResult: contactResultEnum("contact_result").notNull(),
  body: text("body").notNull(),
  // U6: CHW supervisor / Program Manager approval, or Clinical Director
  // for APCC/ACSW intern notes.
  status: noteStatusEnum("status").notNull().default("pending_review"),
  reviewNote: text("review_note"),
  approvedById: uuid("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

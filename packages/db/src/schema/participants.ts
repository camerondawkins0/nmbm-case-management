import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// M1: internal name stays `participants` regardless of whether NMBM
// settles on "Client" or "Case" for the UI label — see
// @nmbm/shared/labels.ts.
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// U5/M4: the currently-active named worker. History of prior assignments
// stays in this table too (rows aren't deleted on reassignment, just
// superseded — endedAt gets set).
export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  workerId: uuid("worker_id").notNull().references(() => users.id),
  assignedById: uuid("assigned_by_id").notNull().references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

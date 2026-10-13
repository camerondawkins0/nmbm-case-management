import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import {
  incomingReferralCloseReasonEnum,
  incomingReferralSourceEnum,
  incomingReferralStatusEnum,
  payerEnum,
} from "./enums.js";

// People referred to NMBM. See migration 0013.
export const incomingReferrals = pgTable("incoming_referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivedDate: date("received_date").notNull(),
  sourceType: incomingReferralSourceEnum("source_type").notNull(),
  sourceName: text("source_name"),
  sourceContact: text("source_contact"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  phone: text("phone"),
  payer: payerEnum("payer"),
  reason: text("reason").notNull(),
  status: incomingReferralStatusEnum("status").notNull().default("new"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  participantId: uuid("participant_id").references(() => participants.id),
  episodeId: uuid("episode_id").references(() => episodes.id),
  admittedById: uuid("admitted_by_id").references(() => users.id),
  admittedAt: timestamp("admitted_at", { withTimezone: true }),
  closeReason: incomingReferralCloseReasonEnum("close_reason"),
  closeNote: text("close_note"),
  closedById: uuid("closed_by_id").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  outcomeReportedById: uuid("outcome_reported_by_id").references(() => users.id),
  outcomeReportedAt: timestamp("outcome_reported_at", { withTimezone: true }),
});

export const incomingReferralNotes = pgTable("incoming_referral_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  referralId: uuid("referral_id").notNull().references(() => incomingReferrals.id),
  body: text("body").notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { consents } from "./consents.js";
import { users } from "./users.js";
import { referralStatusEnum } from "./enums.js";

// M17: "Yes we do refer people out for services and we would need to
// know what happened with the client and the referral." The outcome
// fields are the point — a referral with none recorded is unfinished
// work, and the home screen treats it that way.
export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  partnerName: text("partner_name").notNull(),
  serviceType: text("service_type").notNull(),
  reason: text("reason"),
  // Not nullable on purpose: nothing goes to a partner agency without
  // the release that authorised it, and the row records which one.
  consentId: uuid("consent_id").notNull().references(() => consents.id),
  referredById: uuid("referred_by_id").notNull().references(() => users.id),
  referredAt: timestamp("referred_at", { withTimezone: true }).notNull().defaultNow(),
  status: referralStatusEnum("status").notNull().default("sent"),
  outcomeNote: text("outcome_note"),
  outcomeRecordedById: uuid("outcome_recorded_by_id").references(() => users.id),
  outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

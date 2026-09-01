import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import { payerEnum } from "./enums.js";

// M20/M21: NMBM currently has one operational grant (CITED) and no
// spending restrictions yet ("we have no grants to answer to right
// now"). Scaffolded so `services` has somewhere to point once more
// grants exist, per M8 ("most services should be attached to the
// grant or contract").
export const fundingSources = pgTable("funding_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  payer: payerEnum("payer"),
});

// M7: category, date, how long it took, which grant pays for it.
// Billing (M22/M23) is explicitly not built beyond this — see
// docs/ARCHITECTURE.md, "explicitly not started". No eligibility check,
// no code lookup, no batch export here yet.
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id),
  category: text("category").notNull(),
  serviceDate: timestamp("service_date", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

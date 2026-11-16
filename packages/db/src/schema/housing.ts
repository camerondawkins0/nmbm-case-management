import { pgTable, uuid, text, integer, timestamp, date, numeric } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import {
  csServiceEnum,
  csAuthorizationStatusEnum,
  csUnitTypeEnum,
  housingSituationEnum,
  housingActivityEnum,
  serviceContactMethodEnum,
  depositPurposeEnum,
  depositStatusEnum,
  subsidyTypeEnum,
  payerEnum,
} from "./enums.js";

// Housing Community Supports (M24). Migration 0019 holds the checks.
// Every table here is voided, never deleted: voided_at, who and why.
const voided = {
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedById: uuid("voided_by_id").references(() => users.id),
  voidReason: text("void_reason"),
};

// What the plan authorized a client to receive, asked for and decided.
export const csAuthorizations = pgTable("cs_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  service: csServiceEnum("service").notNull(),
  status: csAuthorizationStatusEnum("status").notNull().default("requested"),
  plan: payerEnum("plan"),
  authorizationNumber: text("authorization_number"),
  requestedDate: date("requested_date").notNull(),
  decisionDate: date("decision_date"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  unitType: csUnitTypeEnum("unit_type"),
  unitsAuthorized: integer("units_authorized"),
  amountAuthorized: numeric("amount_authorized", { precision: 10, scale: 2 }),
  endedDate: date("ended_date"),
  endedReason: text("ended_reason"),
  note: text("note"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  decidedById: uuid("decided_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ...voided,
});

// Where somebody is living, as of a date. The latest by date is current.
export const housingStatuses = pgTable("housing_statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  situation: housingSituationEnum("situation").notNull(),
  effectiveDate: date("effective_date").notNull(),
  note: text("note"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ...voided,
});

// Time spent delivering an authorized service: what's reported and,
// once the payer formats are known (M23), billed.
export const housingServices = pgTable("housing_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  authorizationId: uuid("authorization_id").notNull().references(() => csAuthorizations.id),
  serviceDate: date("service_date").notNull(),
  minutes: integer("minutes").notNull(),
  activity: housingActivityEnum("activity").notNull(),
  contactMethod: serviceContactMethodEnum("contact_method").notNull(),
  note: text("note").notNull(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ...voided,
});

export const tenancies = pgTable("tenancies", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  moveInDate: date("move_in_date").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  landlordName: text("landlord_name"),
  landlordPhone: text("landlord_phone"),
  subsidy: subsidyTypeEnum("subsidy").notNull(),
  monthlyRent: numeric("monthly_rent", { precision: 10, scale: 2 }),
  tenantPortion: numeric("tenant_portion", { precision: 10, scale: 2 }),
  leaseStart: date("lease_start"),
  leaseEnd: date("lease_end"),
  moveOutDate: date("move_out_date"),
  moveOutReason: text("move_out_reason"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ...voided,
});

// Money paid out under a Housing Deposits authorization. Asked for by
// whoever works the case, decided by somebody else, then recorded paid.
export const housingDeposits = pgTable("housing_deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  authorizationId: uuid("authorization_id").notNull().references(() => csAuthorizations.id),
  purpose: depositPurposeEnum("purpose").notNull(),
  payee: text("payee").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: depositStatusEnum("status").notNull().default("requested"),
  note: text("note"),
  requestedById: uuid("requested_by_id").notNull().references(() => users.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  paidDate: date("paid_date"),
  paymentReference: text("payment_reference"),
  paidRecordedById: uuid("paid_recorded_by_id").references(() => users.id),
  ...voided,
});

import { z } from "zod";
import { PAYERS } from "./enums.js";

// Housing (M24, and NMBM's go-live note: "we also need the housing
// aspect as we are maintaining our Community Supports for Independent
// Living Systems"). NMBM deliver CalAIM Community Supports through the
// Independent Living Systems network: the plan (via ILS) authorizes a
// service for a client, NMBM deliver it and log it, and the log is what
// gets reported and billed. Which of the services below NMBM are
// contracted for, and exactly what ILS wants recorded, are still to be
// confirmed — see docs/DISCOVERY_FOLLOWUP.md.

// The three housing Community Supports DHCS defines. Fixed by the state,
// not by NMBM, so it's a list in code rather than something to edit.
export const CS_SERVICES = [
  "housing_transition_navigation",
  "housing_deposits",
  "housing_tenancy_sustaining",
] as const;
export type CsService = (typeof CS_SERVICES)[number];

export const CS_SERVICE_LABELS: Record<CsService, string> = {
  housing_transition_navigation: "Housing Transition Navigation",
  housing_deposits: "Housing Deposits",
  housing_tenancy_sustaining: "Housing Tenancy and Sustaining",
};

// The services whose work is logged in minutes. Housing Deposits is
// money, recorded as deposits against its authorization instead.
export const CS_TIME_SERVICES: CsService[] = ["housing_transition_navigation", "housing_tenancy_sustaining"];

// An authorization is asked for, then decided. "Ended" is an approved one
// stopped before its end date; "void" (on every table here) is a row
// entered in error. Nothing is deleted.
export const CS_AUTHORIZATION_STATUSES = ["requested", "approved", "denied"] as const;
export type CsAuthorizationStatus = (typeof CS_AUTHORIZATION_STATUSES)[number];

// What an authorization's units count. Plans authorize these services in
// different units; NMBM record whichever theirs says.
export const CS_UNIT_TYPES = ["fifteen_minutes", "hour", "visit", "day", "month"] as const;
export type CsUnitType = (typeof CS_UNIT_TYPES)[number];
export const CS_UNIT_LABELS: Record<CsUnitType, string> = {
  fifteen_minutes: "15-minute units",
  hour: "hours",
  visit: "visits",
  day: "days",
  month: "months",
};

// Where somebody is living, as of a date. Close to the categories HUD
// and the plans use, kept short enough to pick from in a visit.
export const HOUSING_SITUATIONS = [
  "unsheltered",
  "emergency_shelter",
  "transitional_housing",
  "temporarily_with_others",
  "institution",
  "permanent_rental",
  "permanent_subsidized",
  "permanent_supportive_housing",
  "owns_home",
  "unknown",
] as const;
export type HousingSituation = (typeof HOUSING_SITUATIONS)[number];
export const HOUSING_SITUATION_LABELS: Record<HousingSituation, string> = {
  unsheltered: "Unsheltered (street, vehicle, encampment)",
  emergency_shelter: "Emergency shelter",
  transitional_housing: "Transitional or interim housing",
  temporarily_with_others: "Staying with family or friends temporarily",
  institution: "Hospital, treatment or jail",
  permanent_rental: "Renting, no subsidy",
  permanent_subsidized: "Renting with a subsidy (e.g. voucher)",
  permanent_supportive_housing: "Permanent supportive housing",
  owns_home: "Owns their home",
  unknown: "Unknown",
};
// Housed, for the overview's count of who moved in.
export const HOUSED_SITUATIONS: HousingSituation[] = [
  "permanent_rental",
  "permanent_subsidized",
  "permanent_supportive_housing",
  "owns_home",
];

export const HOUSING_ACTIVITIES = [
  "housing_assessment",
  "housing_support_plan",
  "housing_search",
  "application_assistance",
  "document_gathering",
  "landlord_engagement",
  "move_in_coordination",
  "tenancy_education",
  "eviction_prevention",
  "crisis_intervention",
  "benefits_linkage",
  "other",
] as const;
export type HousingActivity = (typeof HOUSING_ACTIVITIES)[number];
export const HOUSING_ACTIVITY_LABELS: Record<HousingActivity, string> = {
  housing_assessment: "Housing assessment",
  housing_support_plan: "Housing support plan",
  housing_search: "Housing search",
  application_assistance: "Application assistance",
  document_gathering: "Gathering documents",
  landlord_engagement: "Landlord engagement",
  move_in_coordination: "Move-in coordination",
  tenancy_education: "Tenancy education",
  eviction_prevention: "Eviction prevention",
  crisis_intervention: "Crisis intervention",
  benefits_linkage: "Benefits linkage",
  other: "Other",
};

export const SERVICE_CONTACT_METHODS = ["in_person", "phone", "video", "collateral"] as const;
export type ServiceContactMethod = (typeof SERVICE_CONTACT_METHODS)[number];
export const SERVICE_CONTACT_METHOD_LABELS: Record<ServiceContactMethod, string> = {
  in_person: "In person",
  phone: "Phone",
  video: "Video",
  collateral: "On their behalf (landlord, agency)",
};

export const DEPOSIT_PURPOSES = [
  "security_deposit",
  "utility_deposit_or_setup",
  "first_month_utilities",
  "furnishings_household_goods",
  "moving_costs",
  "cleaning_or_pest",
  "accessibility_modifications",
  "other",
] as const;
export type DepositPurpose = (typeof DEPOSIT_PURPOSES)[number];
export const DEPOSIT_PURPOSE_LABELS: Record<DepositPurpose, string> = {
  security_deposit: "Security deposit",
  utility_deposit_or_setup: "Utility deposit or set-up",
  first_month_utilities: "First month's utilities",
  furnishings_household_goods: "Furnishings and household goods",
  moving_costs: "Moving costs",
  cleaning_or_pest: "Cleaning or pest treatment",
  accessibility_modifications: "Accessibility modifications",
  other: "Other",
};

export const DEPOSIT_STATUSES = ["requested", "approved", "declined", "paid"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const SUBSIDY_TYPES = ["none", "housing_choice_voucher", "permanent_supportive", "rapid_rehousing", "other"] as const;
export type SubsidyType = (typeof SUBSIDY_TYPES)[number];
export const SUBSIDY_LABELS: Record<SubsidyType, string> = {
  none: "No subsidy",
  housing_choice_voucher: "Housing Choice Voucher (Section 8)",
  permanent_supportive: "Permanent supportive housing",
  rapid_rehousing: "Rapid rehousing",
  other: "Other",
};

// Money is a string end to end (hard rule 5): dollars and cents, never a
// float.
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "An amount in dollars, like 1250 or 1250.50");

const date = z.string().date();
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullish());

export const housingStatusCreateSchema = z.object({
  situation: z.enum(HOUSING_SITUATIONS),
  effectiveDate: date,
  note: optionalText(1000),
});

export const csAuthorizationCreateSchema = z.object({
  service: z.enum(CS_SERVICES),
  // The member's plan, which authorizes through ILS.
  plan: z.enum(PAYERS).nullish(),
  requestedDate: date,
  authorizationNumber: optionalText(60),
  note: optionalText(1000),
});

// Approving records what the plan gave: the dates, and either units (time
// services) or an amount (deposits).
export const csAuthorizationDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    decisionDate: date,
    authorizationNumber: z.string().trim().min(1).max(60),
    startDate: date,
    endDate: date,
    unitType: z.enum(CS_UNIT_TYPES).nullish(),
    unitsAuthorized: z.number().int().positive().max(100000).nullish(),
    amountAuthorized: moneySchema.nullish(),
    note: optionalText(1000),
  }),
  z.object({
    decision: z.literal("denied"),
    decisionDate: date,
    note: z.string().trim().min(1).max(1000),
  }),
]);

// Ending early: the last day it covers. Work after that can't be logged
// against it.
export const csAuthorizationEndSchema = z.object({
  endedDate: date,
  reason: z.string().trim().min(1).max(500),
});

export const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const housingServiceCreateSchema = z.object({
  authorizationId: z.string().uuid(),
  serviceDate: date,
  minutes: z.number().int().min(1).max(720),
  activity: z.enum(HOUSING_ACTIVITIES),
  contactMethod: z.enum(SERVICE_CONTACT_METHODS),
  note: z.string().trim().min(1).max(4000),
});

export const tenancyCreateSchema = z.object({
  moveInDate: date,
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter state code, like CA"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "A ZIP code is 5 digits, or 5 and 4"),
  landlordName: optionalText(200),
  landlordPhone: optionalText(40),
  subsidy: z.enum(SUBSIDY_TYPES),
  monthlyRent: moneySchema.nullish(),
  tenantPortion: moneySchema.nullish(),
  leaseStart: date.nullish(),
  leaseEnd: date.nullish(),
});

export const tenancyMoveOutSchema = z.object({
  moveOutDate: date,
  reason: z.string().trim().min(1).max(500),
});

export const depositCreateSchema = z.object({
  authorizationId: z.string().uuid(),
  purpose: z.enum(DEPOSIT_PURPOSES),
  payee: z.string().trim().min(1).max(200),
  amount: moneySchema.refine((v) => Number(v) > 0, "More than zero"),
  note: optionalText(1000),
});

export const depositDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"]),
  note: optionalText(1000),
});

export const depositPaidSchema = z.object({
  paidDate: date,
  paymentReference: z.string().trim().min(1).max(100),
});

export const housingExportQuerySchema = z
  .object({ from: date, to: date })
  .refine((v) => v.from <= v.to, { message: "The start comes before the end" });

// An authorization's state today, derived rather than stored: a status
// that says "approved" with an end date in the past is the bug that lets
// work be logged against an authorization that's run out.
export type CsAuthorizationState = "requested" | "denied" | "upcoming" | "active" | "expiring" | "expired" | "ended";

export function authorizationState(
  a: { status: CsAuthorizationStatus; startDate: string | null; endDate: string | null; endedDate: string | null },
  today: string,
  warningDays: number,
): CsAuthorizationState {
  if (a.status !== "approved") return a.status;
  if (a.endedDate && a.endedDate < today) return "ended";
  if (!a.startDate || !a.endDate) return "requested";
  if (today < a.startDate) return "upcoming";
  if (today > a.endDate) return "expired";
  const warnFrom = new Date(`${a.endDate}T00:00:00Z`);
  warnFrom.setUTCDate(warnFrom.getUTCDate() - warningDays);
  return today >= warnFrom.toISOString().slice(0, 10) ? "expiring" : "active";
}

// The last day an approved authorization covers: its end date, or the
// day it was ended early, which is the last day it covers.
export function lastCoveredDay(a: { endDate: string | null; endedDate: string | null }) {
  if (!a.endDate) return null;
  return a.endedDate && a.endedDate < a.endDate ? a.endedDate : a.endDate;
}

// How many of an authorization's units the logged work uses. 15-minute
// units round each visit up, which is how they're billed.
export function unitsUsed(unitType: CsUnitType, entries: { serviceDate: string; minutes: number }[]) {
  switch (unitType) {
    case "fifteen_minutes":
      return entries.reduce((n, e) => n + Math.ceil(e.minutes / 15), 0);
    case "hour":
      return Math.round((entries.reduce((n, e) => n + e.minutes, 0) / 60) * 100) / 100;
    case "visit":
      return entries.length;
    case "day":
      return new Set(entries.map((e) => e.serviceDate)).size;
    case "month":
      return new Set(entries.map((e) => e.serviceDate.slice(0, 7))).size;
  }
}

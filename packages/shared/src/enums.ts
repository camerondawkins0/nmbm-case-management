// Enums declared once here, wrapped in pgEnum in @nmbm/db/schema/enums.ts,
// and used as the Zod literal union everywhere else — same convention as
// the WSL system this was adapted from (see docs/agent/map.md).

export const EPISODE_STATUSES = ["open", "closed"] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

// M6: contact attempts are logged individually so consecutive no-contacts
// can be counted; "contacted" resets the count.
export const CONTACT_RESULTS = ["contacted", "no_contact"] as const;
export type ContactResult = (typeof CONTACT_RESULTS)[number];

// M9: two independent clocks share one status field on the plan itself.
export const CARE_PLAN_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "needs_revision",
  "closed",
] as const;
export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number];

// M22: payers named in discovery. Molina gets a distinct disenrollment
// letter requirement at the 3rd no-contact (see docs/agent/invariants.md)
// — this list exists so that branch can be conditioned on payer, not
// hardcoded to a string comparison scattered through the codebase.
//
// Full Circle Health Net is NOT a payer — it's a billing intermediary
// NMBM's follow-up reply named for Kaiser Medi-Cal, Molina, Blue Shield,
// and LA Health Net (Molina reportedly still self-bills despite that).
// Kaiser Independent Living Services is billed separately, under a
// direct MCP contract, distinct from Kaiser-via-FCHN. Don't model payer
// and billing channel as the same field once the billing module is
// scoped (blocked on M23) — see docs/ARCHITECTURE.md.
export const PAYERS = [
  "medicare",
  "medi_cal",
  "molina",
  "kaiser",
  "blue_shield",
  "la_health_net",
  "self_pay",
] as const;
export type Payer = (typeof PAYERS)[number];

export const CONSENT_STATUSES = ["active", "expired", "revoked"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

// NMBM has no dedicated IT/dev staff (discovery M31) — every logged-in
// user can submit a ticket, and it's triaged externally. See
// docs/SUPPORT.md for who's expected to look at these and how.
export const FEEDBACK_CATEGORIES = [
  "bug",
  "feature_request",
  "question",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

// Status only ever moves forward through triage — never deleted, per
// CLAUDE.md hard rule 1.
export const FEEDBACK_STATUSES = [
  "open",
  "in_review",
  "resolved",
  "wont_fix",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

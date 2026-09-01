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
export const PAYERS = [
  "medicare",
  "medi_cal",
  "molina",
  "full_circle_health_net",
  "kaiser",
  "blue_shield",
  "self_pay",
] as const;
export type Payer = (typeof PAYERS)[number];

export const CONSENT_STATUSES = ["active", "expired", "revoked"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

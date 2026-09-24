// Enums declared once here, wrapped in pgEnum in @nmbm/db/schema/enums.ts,
// and used as the Zod literal union everywhere else — same convention as
// the WSL system this was adapted from (see docs/agent/map.md).

export const EPISODE_STATUSES = ["open", "closed"] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

// M6: closing for "no_contact" is the one reason the disenrollment gate
// applies to — the others are ordinary exits and aren't blocked.
export const EPISODE_CLOSURE_REASONS = [
  "completed",
  "no_contact",
  "participant_declined",
  "moved",
  "other",
] as const;
export type EpisodeClosureReason = (typeof EPISODE_CLOSURE_REASONS)[number];

// M6: 3 consecutive failed attempts triggers exit-documentation prep
// (and, for Molina, a required warning letter); 2 more after that
// before disenrollment is allowed at all.
export const NO_CONTACT_WARNING_THRESHOLD = 3;
export const NO_CONTACT_DISENROLLMENT_THRESHOLD = 5;

// M9: the care plan has to exist within 30 days of enrollment, and gets
// re-reviewed every 2 weeks while services are ongoing.
export const CARE_PLAN_COMPLETION_DAYS = 30;
export const CARE_PLAN_REVIEW_INTERVAL_DAYS = 14;

// M6: contact attempts are logged individually so consecutive no-contacts
// can be counted; "contacted" resets the count.
export const CONTACT_RESULTS = ["contacted", "no_contact"] as const;
export type ContactResult = (typeof CONTACT_RESULTS)[number];

// U6: a supervisor approves a CHW's note or sends it back. Same three
// states as a care plan, for the same reason — "returned" has to be a
// state the author can see, not a deletion.
export const NOTE_STATUSES = ["pending_review", "approved", "needs_revision"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

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

// M15: NMBM said "we have consent forms" without listing them — the
// blank intake packet is still outstanding. This is the smallest set
// the referral gate needs, not a guess at their filing cabinet.
export const CONSENT_TYPES = [
  "general_services",
  "release_of_information",
  "photo_media",
  "other",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

// M16: "our consents can expire at a year after the client is enrolled"
// — note the anchor is enrolment, not the signature date. Still marked
// "are we in agreement" in discovery, so it stays a named constant.
export const CONSENT_VALID_DAYS = 365;

// M17: outbound referrals. "Do referrals come in, and who sends them?"
// was never really answered, so inbound isn't modelled.
export const REFERRAL_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "completed",
  "no_response",
  "withdrawn",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

// A referral with no outcome after this long is unfinished work, and
// says so on the home screen. Not from discovery — a starting value to
// react to, flagged in docs/DISCOVERY_FOLLOWUP.md.
export const REFERRAL_FOLLOW_UP_DAYS = 14;

// M14: NMBM run Anger Management now; Domestic Violence classes wait on
// LA County approval. A cohort is one run of a programme, so the same
// programme twice a year doesn't mix its rosters.
export const COHORT_STATUSES = ["planned", "running", "completed", "cancelled"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

export const COHORT_ENROLLMENT_STATUSES = ["enrolled", "completed", "withdrawn"] as const;
export type CohortEnrollmentStatus = (typeof COHORT_ENROLLMENT_STATUSES)[number];

// "excused" is kept apart from "absent" because the probation officer
// reading the record cares which it was.
export const ATTENDANCE_STATUSES = ["present", "late", "excused", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// M14: "the PO's or whomever will need proof the person participated."
// Present and late both count as having attended; excused and absent
// don't, though excused is reported separately rather than hidden.
export const ATTENDED_STATUSES: AttendanceStatus[] = ["present", "late"];

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

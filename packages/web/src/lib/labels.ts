import type {
  AssessmentMode,
  EpisodeClosureReason,
  IncomingReferralCloseReason,
  IncomingReferralSource,
  Payer,
  QuestionType,
  RecordExportPurpose,
} from "@nmbm/shared";

// Shared so the close form, the closed list and the episode history
// can't describe the same exit three different ways.
export const CLOSURE_REASON_LABELS: Record<EpisodeClosureReason, string> = {
  completed: "Completed services",
  no_contact: "Unable to contact",
  participant_declined: "Declined services",
  moved: "Moved out of area",
  other: "Other",
};

export const PAYER_LABELS: Record<string, string> = {
  medicare: "Medicare",
  medi_cal: "Medi-Cal",
  molina: "Molina",
  kaiser: "Kaiser",
  blue_shield: "Blue Shield",
  la_health_net: "LA Health Net",
  self_pay: "Self-pay",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  single_choice: "Pick one",
  multi_choice: "Pick any",
  yes_no: "Yes / no",
  date: "Date",
  number: "Number",
};

export const ASSESSMENT_MODE_LABELS: Record<AssessmentMode, string> = {
  with_staff: "With staff",
  from_paper: "From a paper copy",
  self: "Filled in by the participant",
};

export const PAYER_OPTIONS: { value: Payer; label: string }[] = [
  { value: "medi_cal", label: "Medi-Cal" },
  { value: "medicare", label: "Medicare" },
  { value: "molina", label: "Molina" },
  { value: "kaiser", label: "Kaiser" },
  { value: "blue_shield", label: "Blue Shield" },
  { value: "la_health_net", label: "LA Health Net" },
  { value: "self_pay", label: "Self-pay" },
];

export const REFERRAL_SOURCE_LABELS: Record<IncomingReferralSource, string> = {
  health_plan: "Health plan",
  hospital: "Hospital",
  clinic: "Clinic",
  court_probation: "Court or probation",
  community_org: "Community organisation",
  self: "Self-referral",
  other: "Other",
};

export const REFERRAL_CLOSE_LABELS: Record<IncomingReferralCloseReason, string> = {
  declined: "Declined services",
  unable_to_reach: "Couldn't reach them",
  not_eligible: "Not eligible",
  referred_elsewhere: "Referred elsewhere",
  duplicate: "Duplicate of another referral",
  entered_in_error: "Entered in error",
};

export const EXPORT_PURPOSE_LABELS: Record<RecordExportPurpose, string> = {
  participant_request: "The participant asked for their record",
  legal_request: "Court order, subpoena or other legal request",
  transfer_of_care: "Transfer of care to another provider",
  funder_audit: "Funder or contract audit",
  other: "Other",
};

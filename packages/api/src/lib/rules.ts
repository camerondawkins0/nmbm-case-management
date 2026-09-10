import {
  NO_CONTACT_WARNING_THRESHOLD,
  NO_CONTACT_DISENROLLMENT_THRESHOLD,
  type Payer,
  type CarePlanStatus,
} from "@nmbm/shared";

// The rules NMBM described in discovery, derived in one place so the
// caseload list, the participant record and the home screen can't
// disagree about whether someone is at three strikes.
//
// Derived on the server and sent down as flags: the client renders
// them, it doesn't decide them.

export type ParticipantRuleInput = {
  payer: Payer | null;
  consecutiveNoContacts: number | null;
  carePlanId: string | null;
  carePlanStatus: CarePlanStatus | null;
  carePlanDueDate: string | null;
  carePlanReviewDue: string | null;
  disenrollmentLetterSentAt: Date | null;
};

export type NoContactState = {
  count: number;
  // M6: at 3, prepare exit documentation and tell the CHW two more
  // attempts are needed before disenrollment is possible.
  warning: boolean;
  attemptsUntilDisenrollment: number;
  disenrollmentEligible: boolean;
  // M6: Molina participants get a warning letter at the 3rd attempt.
  // Outstanding until it's recorded on the episode.
  molinaLetterRequired: boolean;
};

export type CarePlanState = {
  status: CarePlanStatus | null;
  missing: boolean;
  // M9 clock 1: 30 days from enrollment to have a plan at all.
  completionDueDate: string | null;
  completionOverdue: boolean;
  daysUntilCompletionDue: number | null;
  // M9 clock 2: every two weeks while services are ongoing. Runs
  // independently — a plan can be overdue on both at once.
  reviewDueDate: string | null;
  reviewOverdue: boolean;
  awaitingApproval: boolean;
  needsRevision: boolean;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function noContactState(input: ParticipantRuleInput): NoContactState {
  const count = input.consecutiveNoContacts ?? 0;
  const warning = count >= NO_CONTACT_WARNING_THRESHOLD;
  return {
    count,
    warning,
    attemptsUntilDisenrollment: Math.max(NO_CONTACT_DISENROLLMENT_THRESHOLD - count, 0),
    disenrollmentEligible: count >= NO_CONTACT_DISENROLLMENT_THRESHOLD,
    molinaLetterRequired: input.payer === "molina" && warning && !input.disenrollmentLetterSentAt,
  };
}

export function carePlanState(input: ParticipantRuleInput): CarePlanState {
  const now = today();
  const missing = input.carePlanId === null;
  const completionDueDate = input.carePlanDueDate;
  const reviewDueDate = input.carePlanReviewDue;

  return {
    status: input.carePlanStatus,
    missing,
    completionDueDate,
    // Only a missing plan can miss the completion deadline — once one
    // exists, the two-week review clock is what governs.
    completionOverdue: missing && completionDueDate !== null && completionDueDate < now,
    daysUntilCompletionDue:
      missing && completionDueDate !== null ? daysBetween(now, completionDueDate) : null,
    reviewDueDate,
    reviewOverdue: !missing && reviewDueDate !== null && reviewDueDate <= now,
    awaitingApproval: input.carePlanStatus === "pending_review",
    needsRevision: input.carePlanStatus === "needs_revision",
  };
}

export function participantFlags(input: ParticipantRuleInput) {
  return { noContact: noContactState(input), carePlan: carePlanState(input) };
}

// True when something on this record wants a human to do something.
export function needsAttention(flags: ReturnType<typeof participantFlags>): boolean {
  return (
    flags.noContact.warning ||
    flags.carePlan.missing ||
    flags.carePlan.reviewOverdue ||
    flags.carePlan.needsRevision
  );
}

import type {
  Payer,
  CarePlanStatus,
  ContactResult,
  Permission,
} from "@nmbm/shared";

// Mirrors what the API sends. The flags are derived server-side — the
// client renders them, it never decides them (see lib/rules.ts in the
// API).
export type NoContactFlags = {
  count: number;
  warning: boolean;
  attemptsUntilDisenrollment: number;
  disenrollmentEligible: boolean;
  molinaLetterRequired: boolean;
};

export type CarePlanFlags = {
  status: CarePlanStatus | null;
  missing: boolean;
  completionDueDate: string | null;
  completionOverdue: boolean;
  daysUntilCompletionDue: number | null;
  reviewDueDate: string | null;
  reviewOverdue: boolean;
  awaitingApproval: boolean;
  needsRevision: boolean;
};

export type ParticipantRow = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  payer: Payer | null;
  workerName: string | null;
  episodeId: string | null;
  episodeStatus: string | null;
  startDate: string | null;
  carePlanId: string | null;
  flags: { noContact: NoContactFlags; carePlan: CarePlanFlags };
  needsAttention: boolean;
};

export type ParticipantNote = {
  id: string;
  contactResult: ContactResult;
  body: string;
  createdAt: string;
  authorName: string;
  approvedAt: string | null;
};

export type ParticipantDetail = ParticipantRow & { notes: ParticipantNote[] };

export type Me = {
  id: string;
  email: string;
  displayName: string;
  roles: { code: string; label: string }[];
  permissions: Permission[];
};

export type Dashboard = {
  caseloadSize: number;
  needsAttention: number;
  noContactWarnings: ParticipantRow[];
  carePlansMissing: ParticipantRow[];
  carePlanReviewsDue: ParticipantRow[];
  carePlansReturned: ParticipantRow[];
  awaitingReview: {
    id: string;
    firstName: string;
    lastName: string;
    status: CarePlanStatus;
  }[];
};

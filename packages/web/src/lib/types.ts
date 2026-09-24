import type {
  Payer,
  CarePlanStatus,
  ContactResult,
  NoteStatus,
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
  carePlanGoals: string | null;
  carePlanReviewNote: string | null;
  flags: { noContact: NoContactFlags; carePlan: CarePlanFlags };
  needsAttention: boolean;
};

export type ParticipantNote = {
  id: string;
  contactResult: ContactResult;
  body: string;
  createdAt: string;
  authorName: string;
  authorId: string;
  status: NoteStatus;
  reviewNote: string | null;
  approvedAt: string | null;
};

export type AssignableWorker = { id: string; displayName: string; email: string };

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  deactivatedAt: string | null;
  roles: { code: string; label: string }[];
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string | null;
  createdAt: string;
  actorName: string;
  actorEmail: string;
};

export type PendingNote = {
  id: string;
  body: string;
  contactResult: ContactResult;
  createdAt: string;
  authorName: string;
  participantId: string;
  firstName: string;
  lastName: string;
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

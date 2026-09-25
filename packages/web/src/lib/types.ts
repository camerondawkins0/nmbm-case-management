import type {
  Payer,
  CarePlanStatus,
  ContactResult,
  NoteStatus,
  ConsentType,
  ReferralStatus,
  AttendanceStatus,
  CohortStatus,
  CohortEnrollmentStatus,
  Permission,
  EpisodeClosureReason,
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
  episodeId: string;
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

export type ParticipantConsent = {
  id: string;
  type: ConsentType;
  formName: string;
  signedDate: string;
  expiresDate: string;
  // Derived server-side from the expiry date, not read off a stored
  // column that could disagree with it.
  status: "active" | "expired" | "revoked";
  revokedReason: string | null;
  recordedByName: string | null;
  documentUrl: string | null;
};

export type ParticipantReferral = {
  id: string;
  partnerName: string;
  serviceType: string;
  reason: string | null;
  status: ReferralStatus;
  referredAt: string;
  outcomeNote: string | null;
  outcomeRecordedAt: string | null;
  referredByName: string;
};

export type ReferralAwaitingOutcome = {
  id: string;
  partnerName: string;
  serviceType: string;
  status: ReferralStatus;
  referredAt: string;
  participantId: string;
  firstName: string;
  lastName: string;
  overdue: boolean;
  daysWaiting: number;
};

export type ProgramSummary = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  cohorts: {
    id: string;
    name: string;
    status: CohortStatus;
    startDate: string;
    endDate: string | null;
    requiredSessions: number | null;
    facilitatorName: string | null;
  }[];
};

export type CohortDetail = {
  cohort: {
    id: string;
    name: string;
    programName: string;
    startDate: string;
    endDate: string | null;
    status: CohortStatus;
    requiredSessions: number | null;
  };
  sessions: { id: string; sessionDate: string; topic: string | null }[];
  roster: {
    enrollmentId: string;
    participantId: string;
    firstName: string;
    lastName: string;
    // R10: services with NMBM have ended; the class may carry on.
    servicesEndedOn: string | null;
    status: CohortEnrollmentStatus;
    withdrawnReason: string | null;
    attended: number;
    excused: number;
    absent: number;
  }[];
  marks: {
    sessionId: string;
    enrollmentId: string;
    status: AttendanceStatus;
    note: string | null;
    recordedAt: string;
    recordedByName: string;
  }[];
};

export type ParticipationRecord = {
  enrollment: {
    id: string;
    status: CohortEnrollmentStatus;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    participantId: string;
    cohortName: string;
    programName: string;
    requiredSessions: number | null;
  };
  sessions: {
    sessionDate: string;
    topic: string | null;
    status: AttendanceStatus;
    recordedAt: string;
    recordedByName: string;
  }[];
  attended: number;
  excused: number;
  absent: number;
  sessionsHeld: number;
  outcome: "no_requirement" | "met" | "in_progress" | "short";
};

export type ParticipantProgram = {
  enrollmentId: string;
  status: CohortEnrollmentStatus;
  cohortId: string;
  cohortName: string;
  programName: string;
  startDate: string;
};

// R10: a closed record is reached only by asking for it, and is shown
// by how it ended — that is what somebody looking for a former
// participant will recognise.
export type ClosedParticipantRow = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  payer: Payer | null;
  lastEpisodeId: string;
  startDate: string;
  endDate: string | null;
  closureReason: EpisodeClosureReason | null;
  // Set only for a former worker's view: the last day they can open it.
  accessUntil: string | null;
};

export type AppSetting = {
  key: string;
  label: string;
  description: string;
  default: number;
  min: number;
  max: number;
  value: number;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type EpisodeSummary = {
  id: string;
  status: "open" | "closed";
  startDate: string;
  endDate: string | null;
  closureReason: EpisodeClosureReason | null;
  closureNote: string | null;
  readmittedFromEpisodeId: string | null;
};

export type ParticipantDetail = ParticipantRow & {
  episodes: EpisodeSummary[];
  notes: ParticipantNote[];
  consents: ParticipantConsent[];
  referrals: ParticipantReferral[];
  programs: ParticipantProgram[];
};

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
  referralsAwaitingOutcome: ReferralAwaitingOutcome[];
  awaitingReview: {
    id: string;
    firstName: string;
    lastName: string;
    status: CarePlanStatus;
  }[];
};

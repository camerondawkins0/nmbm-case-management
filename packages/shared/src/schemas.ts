import { z } from "zod";
import {
  ATTENDANCE_STATUSES,
  CONSENT_TYPES,
  REFERRAL_STATUSES,
  EPISODE_STATUSES,
  EPISODE_CLOSURE_REASONS,
  CONTACT_RESULTS,
  CARE_PLAN_STATUSES,
  PAYERS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
} from "./enums.js";

export const participantCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().date(),
  payer: z.enum(PAYERS).optional(),
  assignedWorkerId: z.string().uuid().optional(),
});
export type ParticipantCreate = z.infer<typeof participantCreateSchema>;

// Intake creates the record, opens the episode and names the worker in
// one act, because that is how it happens in the room — M3 (what a
// funder additionally requires at intake) is still unanswered, so this
// is the minimum the discovery answers already support.
export const intakeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().date(),
  payer: z.enum(PAYERS).optional(),
  assignedWorkerId: z.string().uuid(),
  startDate: z.string().date(),
});
export type Intake = z.infer<typeof intakeSchema>;

export const assignmentSchema = z.object({
  workerId: z.string().uuid(),
});
export type AssignmentChange = z.infer<typeof assignmentSchema>;

// M6: closing an episode carries the reason, because "no_contact" is
// the one the disenrollment gate applies to.
export const episodeCloseSchema = z.object({
  closureReason: z.enum(EPISODE_CLOSURE_REASONS),
  closureNote: z.string().min(1).optional(),
});
export type EpisodeClose = z.infer<typeof episodeCloseSchema>;

export const carePlanCreateSchema = z.object({
  participantId: z.string().uuid(),
  episodeId: z.string().uuid(),
  goals: z.string().min(1),
});
export type CarePlanCreate = z.infer<typeof carePlanCreateSchema>;

export const carePlanReviewSchema = z.object({
  reviewNote: z.string().min(1).optional(),
});
export type CarePlanReview = z.infer<typeof carePlanReviewSchema>;

export const episodeCreateSchema = z.object({
  participantId: z.string().uuid(),
  startDate: z.string().date(),
  status: z.enum(EPISODE_STATUSES).default("open"),
});
export type EpisodeCreate = z.infer<typeof episodeCreateSchema>;

// M5: basic contact info, ECM Comp Needs Assessment info, health
// insurance, care plan — free-text body plus a structured contact result
// so the no-contact counter (M6) can be derived without parsing text.
export const noteCreateSchema = z.object({
  participantId: z.string().uuid(),
  episodeId: z.string().uuid(),
  contactResult: z.enum(CONTACT_RESULTS),
  body: z.string().min(1),
});
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const carePlanUpdateSchema = z.object({
  status: z.enum(CARE_PLAN_STATUSES),
  goals: z.string().min(1),
});
export type CarePlanUpdate = z.infer<typeof carePlanUpdateSchema>;

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
});
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;

export const feedbackStatusUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  resolutionNote: z.string().min(1).optional(),
});
export type FeedbackStatusUpdate = z.infer<typeof feedbackStatusUpdateSchema>;

// M15: recording that a form was signed. The expiry is computed from
// the episode's enrolment date rather than supplied, so it can't be
// quietly set to something convenient.
export const consentCreateSchema = z.object({
  participantId: z.string().uuid(),
  type: z.enum(CONSENT_TYPES),
  formName: z.string().min(1).max(200),
  signedDate: z.string().date(),
});
export type ConsentCreate = z.infer<typeof consentCreateSchema>;

export const consentRevokeSchema = z.object({
  reason: z.string().min(1),
});
export type ConsentRevoke = z.infer<typeof consentRevokeSchema>;

// M17. No consentId: the service picks the release that authorises the
// disclosure, so a caller can't nominate an unrelated or expired one.
export const referralCreateSchema = z.object({
  participantId: z.string().uuid(),
  partnerName: z.string().min(1).max(200),
  serviceType: z.string().min(1).max(200),
  reason: z.string().min(1).optional(),
});
export type ReferralCreate = z.infer<typeof referralCreateSchema>;

export const referralOutcomeSchema = z.object({
  status: z.enum(REFERRAL_STATUSES),
  outcomeNote: z.string().min(1).optional(),
});
export type ReferralOutcome = z.infer<typeof referralOutcomeSchema>;

// M14: a programme, and one run of it.
export const programCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).optional(),
});
export type ProgramCreate = z.infer<typeof programCreateSchema>;

export const cohortCreateSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(1).max(160),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  facilitatorId: z.string().uuid().optional(),
  // How many sessions completion takes. Optional because NMBM hasn't
  // said — see docs/DISCOVERY_FOLLOWUP.md.
  requiredSessions: z.number().int().positive().optional(),
});
export type CohortCreate = z.infer<typeof cohortCreateSchema>;

export const sessionCreateSchema = z.object({
  sessionDate: z.string().date(),
  topic: z.string().min(1).max(200).optional(),
});
export type SessionCreate = z.infer<typeof sessionCreateSchema>;

export const cohortEnrollSchema = z.object({
  participantId: z.string().uuid(),
});
export type CohortEnroll = z.infer<typeof cohortEnrollSchema>;

export const cohortWithdrawSchema = z.object({
  reason: z.string().min(1),
});
export type CohortWithdraw = z.infer<typeof cohortWithdrawSchema>;

// The whole roster in one pass, which is how attendance is actually
// taken — a class of twelve shouldn't be twelve requests.
export const attendanceMarkSchema = z.object({
  marks: z
    .array(
      z.object({
        enrollmentId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        note: z.string().min(1).optional(),
      }),
    )
    .min(1),
});
export type AttendanceMark = z.infer<typeof attendanceMarkSchema>;

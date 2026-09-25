import { pgEnum } from "drizzle-orm/pg-core";
import {
  FOLLOW_UP_OUTCOMES,
  ROLES,
  EPISODE_STATUSES,
  EPISODE_CLOSURE_REASONS,
  CONTACT_RESULTS,
  NOTE_STATUSES,
  CARE_PLAN_STATUSES,
  PAYERS,
  CONSENT_STATUSES,
  CONSENT_TYPES,
  REFERRAL_STATUSES,
  COHORT_STATUSES,
  COHORT_ENROLLMENT_STATUSES,
  ATTENDANCE_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
} from "@nmbm/shared";

// Each enum is declared once in @nmbm/shared and wrapped here — never a
// bare pgEnum literal list, so schema and application code can't drift.
export const roleEnum = pgEnum("role", ROLES);
export const episodeStatusEnum = pgEnum("episode_status", EPISODE_STATUSES);
export const episodeClosureReasonEnum = pgEnum("episode_closure_reason", EPISODE_CLOSURE_REASONS);
export const contactResultEnum = pgEnum("contact_result", CONTACT_RESULTS);
export const noteStatusEnum = pgEnum("note_status", NOTE_STATUSES);
export const carePlanStatusEnum = pgEnum("care_plan_status", CARE_PLAN_STATUSES);
export const payerEnum = pgEnum("payer", PAYERS);
export const consentStatusEnum = pgEnum("consent_status", CONSENT_STATUSES);
export const consentTypeEnum = pgEnum("consent_type", CONSENT_TYPES);
export const referralStatusEnum = pgEnum("referral_status", REFERRAL_STATUSES);
export const cohortStatusEnum = pgEnum("cohort_status", COHORT_STATUSES);
export const cohortEnrollmentStatusEnum = pgEnum("cohort_enrollment_status", COHORT_ENROLLMENT_STATUSES);
export const attendanceStatusEnum = pgEnum("attendance_status", ATTENDANCE_STATUSES);
export const feedbackCategoryEnum = pgEnum("feedback_category", FEEDBACK_CATEGORIES);
export const feedbackStatusEnum = pgEnum("feedback_status", FEEDBACK_STATUSES);

// M12: what a QA follow-up call came to.
export const followUpOutcomeEnum = pgEnum("follow_up_outcome", FOLLOW_UP_OUTCOMES);

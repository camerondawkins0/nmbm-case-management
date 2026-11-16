import { pgEnum } from "drizzle-orm/pg-core";
import {
  INCOMING_REFERRAL_SOURCES,
  INCOMING_REFERRAL_STATUSES,
  INCOMING_REFERRAL_CLOSE_REASONS,
  ASSESSMENT_MODES,
  ASSESSMENT_STATUSES,
  FORM_VERSION_STATUSES,
  QUESTION_TYPES,
  DOCUMENT_STATUSES,
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
  CS_SERVICES,
  CS_AUTHORIZATION_STATUSES,
  CS_UNIT_TYPES,
  HOUSING_SITUATIONS,
  HOUSING_ACTIVITIES,
  SERVICE_CONTACT_METHODS,
  DEPOSIT_PURPOSES,
  DEPOSIT_STATUSES,
  SUBSIDY_TYPES,
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

// Uploaded documents: pending until the file is confirmed in storage.
export const documentStatusEnum = pgEnum("document_status", DOCUMENT_STATUSES);

// Forms and assessments (M11/M13).
export const formVersionStatusEnum = pgEnum("form_version_status", FORM_VERSION_STATUSES);
export const questionTypeEnum = pgEnum("question_type", QUESTION_TYPES);
export const assessmentStatusEnum = pgEnum("assessment_status", ASSESSMENT_STATUSES);
export const assessmentModeEnum = pgEnum("assessment_mode", ASSESSMENT_MODES);

// People referred to NMBM (M17, inbound).
export const incomingReferralSourceEnum = pgEnum("incoming_referral_source", INCOMING_REFERRAL_SOURCES);
export const incomingReferralStatusEnum = pgEnum("incoming_referral_status", INCOMING_REFERRAL_STATUSES);
export const incomingReferralCloseReasonEnum = pgEnum("incoming_referral_close_reason", INCOMING_REFERRAL_CLOSE_REASONS);

// Housing Community Supports (M24, migration 0019).
export const csServiceEnum = pgEnum("cs_service", CS_SERVICES);
export const csAuthorizationStatusEnum = pgEnum("cs_authorization_status", CS_AUTHORIZATION_STATUSES);
export const csUnitTypeEnum = pgEnum("cs_unit_type", CS_UNIT_TYPES);
export const housingSituationEnum = pgEnum("housing_situation", HOUSING_SITUATIONS);
export const housingActivityEnum = pgEnum("housing_activity", HOUSING_ACTIVITIES);
export const serviceContactMethodEnum = pgEnum("service_contact_method", SERVICE_CONTACT_METHODS);
export const depositPurposeEnum = pgEnum("deposit_purpose", DEPOSIT_PURPOSES);
export const depositStatusEnum = pgEnum("deposit_status", DEPOSIT_STATUSES);
export const subsidyTypeEnum = pgEnum("subsidy_type", SUBSIDY_TYPES);

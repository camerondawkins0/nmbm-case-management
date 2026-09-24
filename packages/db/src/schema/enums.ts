import { pgEnum } from "drizzle-orm/pg-core";
import {
  ROLES,
  EPISODE_STATUSES,
  EPISODE_CLOSURE_REASONS,
  CONTACT_RESULTS,
  NOTE_STATUSES,
  CARE_PLAN_STATUSES,
  PAYERS,
  CONSENT_STATUSES,
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
export const feedbackCategoryEnum = pgEnum("feedback_category", FEEDBACK_CATEGORIES);
export const feedbackStatusEnum = pgEnum("feedback_status", FEEDBACK_STATUSES);

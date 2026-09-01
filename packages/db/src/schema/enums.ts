import { pgEnum } from "drizzle-orm/pg-core";
import {
  ROLES,
  EPISODE_STATUSES,
  CONTACT_RESULTS,
  CARE_PLAN_STATUSES,
  PAYERS,
  CONSENT_STATUSES,
} from "@nmbm/shared";

// Each enum is declared once in @nmbm/shared and wrapped here — never a
// bare pgEnum literal list, so schema and application code can't drift.
export const roleEnum = pgEnum("role", ROLES);
export const episodeStatusEnum = pgEnum("episode_status", EPISODE_STATUSES);
export const contactResultEnum = pgEnum("contact_result", CONTACT_RESULTS);
export const carePlanStatusEnum = pgEnum("care_plan_status", CARE_PLAN_STATUSES);
export const payerEnum = pgEnum("payer", PAYERS);
export const consentStatusEnum = pgEnum("consent_status", CONSENT_STATUSES);

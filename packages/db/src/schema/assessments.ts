import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { Answers, QuestionOption } from "@nmbm/shared";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import {
  assessmentModeEnum,
  assessmentStatusEnum,
  formVersionStatusEnum,
  questionTypeEnum,
} from "./enums.js";

// NMBM's own forms (M11/M13). A form is the thing staff pick; its
// versions are what was actually asked. See migration 0011.
export const assessmentForms = pgTable("assessment_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assessmentFormVersions = pgTable("assessment_form_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  formId: uuid("form_id").notNull().references(() => assessmentForms.id),
  versionNumber: integer("version_number").notNull(),
  status: formVersionStatusEnum("status").notNull().default("draft"),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedById: uuid("published_by_id").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const assessmentQuestions = pgTable("assessment_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("version_id").notNull().references(() => assessmentFormVersions.id),
  stableId: uuid("stable_id").notNull(),
  sortOrder: integer("sort_order").notNull(),
  type: questionTypeEnum("type").notNull(),
  prompt: text("prompt").notNull(),
  helpText: text("help_text"),
  section: text("section"),
  required: boolean("required").notNull().default(false),
  options: jsonb("options").$type<QuestionOption[]>().notNull().default([]),
  showIf: jsonb("show_if"),
});

export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id),
  versionId: uuid("version_id").notNull().references(() => assessmentFormVersions.id),
  mode: assessmentModeEnum("mode").notNull(),
  status: assessmentStatusEnum("status").notNull().default("in_progress"),
  answers: jsonb("answers").$type<Answers>().notNull().default({}),
  startedById: uuid("started_by_id").references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedById: uuid("completed_by_id").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  voidedById: uuid("voided_by_id").references(() => users.id),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
});

export const assessmentLinks = pgTable("assessment_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
  tokenHash: text("token_hash").notNull().unique(),
  passcodeHash: text("passcode_hash").notNull(),
  passcodeSalt: text("passcode_salt").notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedById: uuid("revoked_by_id").references(() => users.id),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  accessHash: text("access_hash"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

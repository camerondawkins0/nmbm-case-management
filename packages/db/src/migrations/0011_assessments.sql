-- NMBM's own forms — the registration form and the comprehensive needs
-- assessment (M11/M13) — and the filled-in copies on participants'
-- records. No scoring: NMBM use no licensed instruments.
--
-- A form's versions are what was actually asked. A published version
-- never changes; editing one makes a new draft. Every assessment points
-- at the version it was filled in against, so an old answer is always
-- read next to the question as it was worded at the time.
CREATE TYPE "form_version_status" AS ENUM ('draft', 'published');
CREATE TYPE "question_type" AS ENUM (
  'short_text', 'long_text', 'single_choice', 'multi_choice', 'yes_no', 'date', 'number'
);
CREATE TYPE "assessment_status" AS ENUM ('in_progress', 'completed', 'voided');
CREATE TYPE "assessment_mode" AS ENUM ('with_staff', 'from_paper', 'self');

CREATE TABLE "assessment_forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  -- Retired forms can't be started; their past assessments stay.
  "active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "assessment_form_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "form_id" uuid NOT NULL REFERENCES "assessment_forms"("id"),
  "version_number" integer NOT NULL,
  "status" "form_version_status" NOT NULL DEFAULT 'draft',
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_by_id" uuid REFERENCES "users"("id"),
  "published_at" timestamptz,
  UNIQUE ("form_id", "version_number")
);

-- One draft at a time. Two would mean two people editing the "next"
-- version, and whichever published second would silently discard the
-- other's changes.
CREATE UNIQUE INDEX "assessment_form_versions_one_draft"
  ON "assessment_form_versions" ("form_id") WHERE "status" = 'draft';

CREATE TABLE "assessment_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "assessment_form_versions"("id"),
  -- The same question across versions. Answers and show-if rules key on
  -- this, so rewording a question doesn't orphan either.
  "stable_id" uuid NOT NULL,
  "sort_order" integer NOT NULL,
  "type" "question_type" NOT NULL,
  "prompt" text NOT NULL,
  "help_text" text,
  "section" text,
  "required" boolean NOT NULL DEFAULT false,
  -- [{ "value": ..., "label": ... }] for choice questions.
  "options" jsonb NOT NULL DEFAULT '[]',
  "show_if" jsonb,
  UNIQUE ("version_id", "stable_id")
);

CREATE INDEX "assessment_questions_version" ON "assessment_questions" ("version_id", "sort_order");

-- One filled-in form. Answers are a map from stable question id to the
-- value given; a needs assessment is read and printed as a whole, not
-- queried answer by answer, and the map survives rewording for the same
-- reason the stable id does.
CREATE TABLE "assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "version_id" uuid NOT NULL REFERENCES "assessment_form_versions"("id"),
  "mode" "assessment_mode" NOT NULL,
  "status" "assessment_status" NOT NULL DEFAULT 'in_progress',
  "answers" jsonb NOT NULL DEFAULT '{}',
  -- Null only for one a participant started from their own link.
  "started_by_id" uuid REFERENCES "users"("id"),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_by_id" uuid REFERENCES "users"("id"),
  "completed_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "voided_at" timestamptz,
  "void_reason" text
);

CREATE INDEX "assessments_participant" ON "assessments" ("participant_id");

-- M14. NMBM run Anger Management now and expect Domestic Violence
-- classes once LA County approves. The answer that shapes this module
-- isn't the roster itself: "The PO's or whomever, will need proof the
-- person participated in the class."
--
-- That makes attendance evidence a third party relies on, not an
-- internal tally — so a mark records who made it and when, and nothing
-- is ever deleted.

CREATE TYPE "cohort_status" AS ENUM ('planned', 'running', 'completed', 'cancelled');
CREATE TYPE "cohort_enrollment_status" AS ENUM ('enrolled', 'completed', 'withdrawn');
-- "excused" is distinct from "absent" on purpose: a court or probation
-- officer reading this cares which one it was.
CREATE TYPE "attendance_status" AS ENUM ('present', 'late', 'excused', 'absent');

CREATE TABLE "programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- A cohort is one run of a programme — the thing a person is actually
-- enrolled in, so "Anger Management" can run twice a year without the
-- two rosters mixing.
CREATE TABLE "program_cohorts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "programs"("id"),
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "facilitator_id" uuid REFERENCES "users"("id"),
  -- How many sessions constitute completion. Nullable because NMBM
  -- hasn't said — court-mandated programmes usually have a number, and
  -- until they give it the system counts without judging.
  "required_sessions" integer,
  "status" cohort_status NOT NULL DEFAULT 'planned',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "cohort_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cohort_id" uuid NOT NULL REFERENCES "program_cohorts"("id"),
  "session_date" date NOT NULL,
  "topic" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "cohort_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cohort_id" uuid NOT NULL REFERENCES "program_cohorts"("id"),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "status" cohort_enrollment_status NOT NULL DEFAULT 'enrolled',
  "enrolled_at" timestamptz NOT NULL DEFAULT now(),
  "withdrawn_at" timestamptz,
  "withdrawn_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Somebody appearing twice on one roster would double every count
  -- drawn from it.
  UNIQUE ("cohort_id", "participant_id")
);

-- Keyed on the enrolment, not the participant: you can only be marked
-- for a class you were on the roster for.
CREATE TABLE "session_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "cohort_sessions"("id"),
  "enrollment_id" uuid NOT NULL REFERENCES "cohort_enrollments"("id"),
  "status" attendance_status NOT NULL,
  "note" text,
  -- Who marked it and when. This is the part that makes the record
  -- worth anything to a probation officer.
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("session_id", "enrollment_id")
);

CREATE INDEX "cohort_sessions_cohort_idx" ON "cohort_sessions" ("cohort_id", "session_date");
CREATE INDEX "cohort_enrollments_participant_idx" ON "cohort_enrollments" ("participant_id");
CREATE INDEX "session_attendance_enrollment_idx" ON "session_attendance" ("enrollment_id");

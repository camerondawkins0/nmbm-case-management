-- M12: QA follow-up calls at 3, 5, 9 and 12 months after disenrolment.
-- Only the calls are stored. When each one is due is worked out from the
-- episode's end date every time it's asked for, so there is no schedule
-- row to fall out of step with the episode it came from.
CREATE TYPE "follow_up_outcome" AS ENUM (
  'reached_doing_well',
  'reached_wants_services',
  'no_answer',
  'declined',
  'wrong_number'
);

-- One row per attempt, so "tried three times, no answer" is on record
-- rather than collapsed into the eventual result.
CREATE TABLE "follow_up_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "milestone_months" integer NOT NULL CHECK ("milestone_months" IN (3, 5, 9, 12)),
  "outcome" "follow_up_outcome" NOT NULL,
  "note" text,
  "services_feedback" text,
  "called_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "called_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "follow_up_calls_episode" ON "follow_up_calls" ("episode_id");

-- A milestone is settled once. Attempts that didn't get through can
-- pile up; a second "reached" for the same call would double-count in
-- any report built on this.
CREATE UNIQUE INDEX "follow_up_calls_one_result_per_milestone"
  ON "follow_up_calls" ("episode_id", "milestone_months")
  WHERE "outcome" <> 'no_answer';

-- Readmission search: by date of birth, and by name without regard to
-- case.
CREATE INDEX "participants_dob" ON "participants" ("date_of_birth");
CREATE INDEX "participants_last_name_lower" ON "participants" (lower("last_name"));

-- People referred *to* NMBM (M17's other direction; R5 expects
-- substance-use referrals soon). A referral arrives before anybody is a
-- participant, so it carries its own name and details; once the person
-- is admitted it points at their record and episode.
--
-- Nothing is deleted: one entered by mistake is closed as
-- 'entered_in_error'. The referrer being told the outcome is recorded
-- separately — closing the loop with whoever sent them is its own act,
-- and the one plans now ask about.
CREATE TYPE "incoming_referral_source" AS ENUM (
  'health_plan', 'hospital', 'clinic', 'court_probation', 'community_org', 'self', 'other'
);
CREATE TYPE "incoming_referral_status" AS ENUM ('new', 'contacting', 'admitted', 'closed');
CREATE TYPE "incoming_referral_close_reason" AS ENUM (
  'declined', 'unable_to_reach', 'not_eligible', 'referred_elsewhere', 'duplicate', 'entered_in_error'
);

CREATE TABLE "incoming_referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "received_date" date NOT NULL,
  "source_type" "incoming_referral_source" NOT NULL,
  "source_name" text,
  "source_contact" text,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "date_of_birth" date,
  "phone" text,
  "payer" "payer",
  "reason" text NOT NULL,
  "status" "incoming_referral_status" NOT NULL DEFAULT 'new',
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "participant_id" uuid REFERENCES "participants"("id"),
  "episode_id" uuid REFERENCES "episodes"("id"),
  "admitted_by_id" uuid REFERENCES "users"("id"),
  "admitted_at" timestamptz,
  "close_reason" "incoming_referral_close_reason",
  "close_note" text,
  "closed_by_id" uuid REFERENCES "users"("id"),
  "closed_at" timestamptz,
  "outcome_reported_by_id" uuid REFERENCES "users"("id"),
  "outcome_reported_at" timestamptz,
  -- The state and its evidence move together: admitted means a record
  -- to point at, closed means a reason.
  CONSTRAINT "incoming_referrals_admitted_has_record"
    CHECK ("status" <> 'admitted' OR ("participant_id" IS NOT NULL AND "episode_id" IS NOT NULL)),
  CONSTRAINT "incoming_referrals_closed_has_reason"
    CHECK ("status" <> 'closed' OR "close_reason" IS NOT NULL)
);

CREATE INDEX "incoming_referrals_open" ON "incoming_referrals" ("received_date")
  WHERE "status" IN ('new', 'contacting');
CREATE INDEX "incoming_referrals_participant" ON "incoming_referrals" ("participant_id");

-- Each attempt to reach the person, and anything else worth noting
-- before they're a participant (after that, notes go on the record).
CREATE TABLE "incoming_referral_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "referral_id" uuid NOT NULL REFERENCES "incoming_referrals"("id"),
  "body" text NOT NULL,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "incoming_referral_notes_referral" ON "incoming_referral_notes" ("referral_id");

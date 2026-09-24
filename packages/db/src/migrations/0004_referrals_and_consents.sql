-- M15/M16/M17. Referrals and consents land together because M15 asks
-- whether a signature "unlocks something else, like a referral" and the
-- discovery doc's own description of the referral module answers it:
-- "Send someone to a partner agency, but only once consent is signed."

-- NMBM hasn't listed their actual forms — the blank intake packet is
-- still on the outstanding list — so this is the smallest set the
-- referral gate needs, not a guess at their filing cabinet.
CREATE TYPE "consent_type" AS ENUM (
  'general_services',
  'release_of_information',
  'photo_media',
  'other'
);

ALTER TABLE "consents" ADD COLUMN "type" consent_type NOT NULL DEFAULT 'general_services';
ALTER TABLE "consents" ADD COLUMN "recorded_by_id" uuid REFERENCES "users"("id");
ALTER TABLE "consents" ADD COLUMN "revoked_at" timestamptz;
ALTER TABLE "consents" ADD COLUMN "revoked_reason" text;
-- Which episode's enrolment date the expiry was counted from. M16 says
-- "a year after the client is enrolled", so the anchor is the episode,
-- not the signature — worth being able to show the working.
ALTER TABLE "consents" ADD COLUMN "episode_id" uuid REFERENCES "episodes"("id");

CREATE INDEX "consents_participant_idx" ON "consents" ("participant_id", "type");

CREATE TYPE "referral_status" AS ENUM (
  'sent',
  'accepted',
  'declined',
  'completed',
  'no_response',
  'withdrawn'
);

-- M17: "we would need to know what happened with the client and the
-- referral." The outcome fields are the point of the table — a referral
-- with none recorded is unfinished work, and the home screen says so.
--
-- partner_name is free text rather than a foreign key to a partner
-- directory: NMBM hasn't given their list of partner agencies, and
-- inventing the directory before seeing it is how you end up migrating
-- it twice.
CREATE TABLE "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "partner_name" text NOT NULL,
  "service_type" text NOT NULL,
  "reason" text,
  -- The consent that authorised sharing with this partner. Not
  -- nullable: a referral cannot exist without one.
  "consent_id" uuid NOT NULL REFERENCES "consents"("id"),
  "referred_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "referred_at" timestamptz NOT NULL DEFAULT now(),
  "status" referral_status NOT NULL DEFAULT 'sent',
  "outcome_note" text,
  "outcome_recorded_by_id" uuid REFERENCES "users"("id"),
  "outcome_recorded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "referrals_participant_idx" ON "referrals" ("participant_id");
CREATE INDEX "referrals_open_idx" ON "referrals" ("status", "referred_at");

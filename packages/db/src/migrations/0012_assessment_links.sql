-- M13: a participant fills in a form themselves, from a link and a
-- passcode their case manager gives them. Nothing is sent from the app:
-- the case manager passes both on by whatever route suits the person,
-- ideally separately, so a forwarded email alone doesn't open the form.
--
-- The link opens one assessment (mode 'self') and nothing else. Neither
-- the link's secret nor the passcode is stored, only hashes of them.
CREATE TABLE "assessment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "assessments"("id"),
  "token_hash" text NOT NULL UNIQUE,
  "passcode_hash" text NOT NULL,
  "passcode_salt" text NOT NULL,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "failed_attempts" integer NOT NULL DEFAULT 0,
  -- Set when the passcode has been got wrong too many times. A locked
  -- link stays locked; the case manager issues a new one.
  "locked_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by_id" uuid REFERENCES "users"("id"),
  "first_opened_at" timestamptz,
  -- The browser that entered the passcode holds a cookie whose hash is
  -- here; it lapses after a spell of inactivity.
  "access_hash" text,
  "access_expires_at" timestamptz,
  "submitted_at" timestamptz
);

-- One live link per assessment. Issuing a new one revokes the old in
-- the same transaction, so a passcode read out last week can't still
-- work alongside today's.
CREATE UNIQUE INDEX "assessment_links_one_live"
  ON "assessment_links" ("assessment_id")
  WHERE "revoked_at" IS NULL AND "submitted_at" IS NULL AND "locked_at" IS NULL;

-- Something a participant did through their link has no staff member to
-- name. Naming the one who issued it would say they did it.
ALTER TABLE "audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;

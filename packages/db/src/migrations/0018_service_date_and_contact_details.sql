-- The day the contact happened, which isn't always the day it was
-- written up. NMBM work in Long Beach, so "today" is Pacific time, not
-- the database server's.
ALTER TABLE "notes" ADD COLUMN "service_date" date;
UPDATE "notes" SET "service_date" = ("created_at" AT TIME ZONE 'America/Los_Angeles')::date;
ALTER TABLE "notes" ALTER COLUMN "service_date" SET NOT NULL;
ALTER TABLE "notes" ALTER COLUMN "service_date" SET DEFAULT ((now() AT TIME ZONE 'America/Los_Angeles')::date);
CREATE INDEX "notes_episode_service_date_idx" ON "notes" ("episode_id", "service_date");

-- M6's run of failed attempts, in the order the attempts happened rather
-- than the order they were typed up: a call made on Monday and logged
-- on Wednesday comes before Tuesday's. Ties on the day fall back to when
-- each was written. Otherwise as in 0006.
DROP VIEW "v_no_contact_counts";

CREATE VIEW "v_no_contact_counts" AS
SELECT
  e.participant_id AS participant_id,
  e.id AS episode_id,
  COUNT(n.id) FILTER (WHERE n.contact_result = 'no_contact') AS consecutive_no_contacts
FROM episodes e
LEFT JOIN LATERAL (
  SELECT c.service_date, c.created_at
    FROM notes c
   WHERE c.episode_id = e.id
     AND c.contact_result = 'contacted'
   ORDER BY c.service_date DESC, c.created_at DESC
   LIMIT 1
) last_contact ON true
LEFT JOIN notes n
  ON n.episode_id = e.id
 AND (last_contact.service_date IS NULL
      OR (n.service_date, n.created_at) > (last_contact.service_date, last_contact.created_at))
WHERE e.status = 'open'
GROUP BY e.participant_id, e.id;

-- What intake collects beyond name and date of birth. All optional: M3
-- (what has to be known before intake can proceed) is still unanswered.
-- Phones are stored as ten digits and formatted for display.
ALTER TABLE "participants"
  ADD COLUMN "phone" text,
  ADD COLUMN "email" text,
  ADD COLUMN "address_line1" text,
  ADD COLUMN "address_line2" text,
  ADD COLUMN "city" text,
  ADD COLUMN "state" text,
  ADD COLUMN "postal_code" text,
  ADD COLUMN "medi_cal_cin" text,
  ADD COLUMN "plan_member_id" text,
  ADD COLUMN "emergency_contact_name" text,
  ADD COLUMN "emergency_contact_phone" text,
  ADD COLUMN "emergency_contact_relationship" text,
  ADD COLUMN "details_updated_at" timestamptz;

-- A Medi-Cal CIN names one person. Two records with the same one are the
-- same client twice, or a mistyped number; either way it's refused.
CREATE UNIQUE INDEX "participants_medi_cal_cin" ON "participants" ("medi_cal_cin") WHERE "medi_cal_cin" IS NOT NULL;

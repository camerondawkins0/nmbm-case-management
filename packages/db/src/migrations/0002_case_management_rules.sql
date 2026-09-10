-- Everything the no-contact rule (M6) and the care plan sign-off chain
-- (M9/M10) need in order to be enforced rather than just described.

CREATE TYPE "episode_closure_reason" AS ENUM ('completed', 'no_contact', 'participant_declined', 'moved', 'other');

-- M6's Molina branch needs to know a participant's plan. One nullable
-- column rather than a coverage-history table: real coverage changes
-- over time, but modeling that belongs with the billing module, which
-- is blocked on M23.
ALTER TABLE "participants" ADD COLUMN "payer" payer;

ALTER TABLE "episodes" ADD COLUMN "closure_reason" episode_closure_reason;
ALTER TABLE "episodes" ADD COLUMN "closure_note" text;
-- M6: for Molina participants a disenrollment-warning letter is
-- required at the 3rd failed attempt. Recorded here so the
-- disenrollment gate can require it, not just recommend it.
ALTER TABLE "episodes" ADD COLUMN "disenrollment_letter_sent_at" timestamptz;

-- U6/invariants: "return for revision" is a state, not a delete-and-redo
-- — the author has to be able to see why it bounced.
ALTER TABLE "care_plans" ADD COLUMN "review_note" text;

-- M6: consecutive failed contact attempts, reset by any successful
-- contact. Derived rather than stored so it can't drift from the notes
-- it's counted from. Every participant gets a row, so callers can join
-- without worrying about missing ones.
CREATE VIEW "v_no_contact_counts" AS
SELECT
  p.id AS participant_id,
  COUNT(n.id) FILTER (WHERE n.contact_result = 'no_contact') AS consecutive_no_contacts
FROM participants p
LEFT JOIN notes n
  ON n.participant_id = p.id
 AND n.created_at > COALESCE(
       (SELECT MAX(c.created_at)
          FROM notes c
         WHERE c.participant_id = p.id
           AND c.contact_result = 'contacted'),
       '-infinity'::timestamptz)
GROUP BY p.id;

CREATE INDEX "care_plans_episode_idx" ON "care_plans" ("episode_id");
CREATE INDEX "episodes_participant_idx" ON "episodes" ("participant_id", "status");

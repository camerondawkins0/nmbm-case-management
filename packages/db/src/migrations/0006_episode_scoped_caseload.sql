-- R10: "disenrolment immediately moves a participant out of the active
-- caseload view", while the record stays retrievable. Until now closing
-- an episode set its status and stopped, so a disenrolled participant
-- stayed on their worker's list and read as needing attention.

-- Everything that means "this person is active" joins the open
-- episode. Two open episodes for one person would duplicate them in
-- every list and make "which clock is running" unanswerable, so the
-- database refuses it rather than trusting every writer to check.
CREATE UNIQUE INDEX "episodes_one_open_per_participant"
  ON "episodes" ("participant_id")
  WHERE "status" = 'open';

-- Repair rows the old close path left behind: an assignment still open
-- for somebody whose episodes are all closed. Ended, not deleted — who
-- held the case stays answerable.
UPDATE "assignments" a
   SET "ended_at" = COALESCE(
         (SELECT MAX(e."end_date")::timestamptz
            FROM "episodes" e
           WHERE e."participant_id" = a."participant_id"),
         now())
 WHERE a."ended_at" IS NULL
   AND EXISTS (SELECT 1 FROM "episodes" e
                WHERE e."participant_id" = a."participant_id" AND e."status" = 'closed')
   AND NOT EXISTS (SELECT 1 FROM "episodes" e
                    WHERE e."participant_id" = a."participant_id" AND e."status" = 'open');

-- M6's run of failed contacts belongs to an episode, not to a person.
-- Counted per participant, somebody disenrolled for no contact and
-- later readmitted would begin the new episode already at three
-- strikes — the previous episode's attempts are still their most recent
-- notes. Only open episodes appear here, so a closed record has no run
-- to report.
DROP VIEW "v_no_contact_counts";

CREATE VIEW "v_no_contact_counts" AS
SELECT
  e.participant_id AS participant_id,
  e.id AS episode_id,
  COUNT(n.id) FILTER (WHERE n.contact_result = 'no_contact') AS consecutive_no_contacts
FROM episodes e
LEFT JOIN notes n
  ON n.episode_id = e.id
 AND n.created_at > COALESCE(
       (SELECT MAX(c.created_at)
          FROM notes c
         WHERE c.episode_id = e.id
           AND c.contact_result = 'contacted'),
       '-infinity'::timestamptz)
WHERE e.status = 'open'
GROUP BY e.participant_id, e.id;

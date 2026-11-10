-- One care plan per stay. The record, the caseload list and the M9
-- clocks all read "the" plan of an episode; a second one was saved but
-- never shown, and doubled the client in the caseload list. If a
-- database already holds two plans for one episode this fails, and the
-- deploy stops before anything else changes: choose which plan stands
-- by hand rather than have a migration guess.
DROP INDEX IF EXISTS "care_plans_episode_idx";
CREATE UNIQUE INDEX "care_plans_one_per_episode" ON "care_plans" ("episode_id");
-- U6: whether a note goes to clinical review, fixed when it's written,
-- so a later change to the author's roles doesn't move notes already in
-- someone's queue.
ALTER TABLE "notes" ADD COLUMN "clinical_review" boolean NOT NULL DEFAULT false;
-- Notes already written by interns: the only role that starts with
-- "Notes go to clinical review".
UPDATE "notes" SET "clinical_review" = true
WHERE "author_id" IN (
  SELECT ur."user_id" FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."role_id"
  WHERE r."code" = 'apcc_acsw_intern'
);

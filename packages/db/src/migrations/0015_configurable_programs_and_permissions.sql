-- Two things NMBM decide for themselves rather than through a developer.
--
-- 1. What completing a program takes (M14). A default number of classes
--    for new cohorts (each cohort can still set its own), and whether a
--    late or an excused mark counts toward it. Late counted and excused
--    didn't before this; those stay the defaults.
ALTER TABLE "programs"
  ADD COLUMN "default_required_sessions" integer CHECK ("default_required_sessions" > 0),
  ADD COLUMN "late_counts" boolean NOT NULL DEFAULT true,
  ADD COLUMN "excused_counts" boolean NOT NULL DEFAULT false;

-- 2. Which permissions each role holds. The defaults live in the code;
--    a row here is NMBM's decision to differ from one. The release job
--    reads these, so a deploy applies new defaults without undoing a
--    choice NMBM made. No row means "the default".
CREATE TABLE "role_permission_overrides" (
  "role_id" uuid NOT NULL REFERENCES "roles"("id"),
  "permission_id" uuid NOT NULL REFERENCES "permissions"("id"),
  "granted" boolean NOT NULL,
  "changed_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("role_id", "permission_id")
);

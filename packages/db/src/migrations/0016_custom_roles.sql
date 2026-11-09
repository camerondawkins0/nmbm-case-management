-- NMBM add roles of their own (a role for a new funder's program, say),
-- next to the nine built in. A custom role is just a named set of the
-- permissions the code defines; it can't invent new ones.
--
-- builtin: the nine roles the code knows. Their names are fixed, they
--   can't be retired, and the release job manages their defaults.
-- active: a retired custom role grants nothing and can't be assigned.
--   Retired, not deleted (hard rule 1): who held it stays answerable.
ALTER TABLE "roles"
  ADD COLUMN "builtin" boolean NOT NULL DEFAULT false,
  ADD COLUMN "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN "description" text,
  ADD COLUMN "created_by_id" uuid REFERENCES "users"("id"),
  ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now();

UPDATE "roles" SET "builtin" = true WHERE "code" IN (
  'clinical_director', 'billing_coordinator', 'intake_specialist',
  'health_education_prevention_specialist', 'community_health_worker',
  'program_manager', 'apcc_acsw_intern', 'quality_assurance_coordinator',
  'system_administrator'
);

-- Two active roles with the same name would make the Staff page's role
-- list ambiguous about which one is being given.
CREATE UNIQUE INDEX "roles_active_label" ON "roles" (lower("label")) WHERE "active";

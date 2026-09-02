-- Initial schema. Hand-written to match packages/db/src/schema/*.ts —
-- see CLAUDE.md hard rule 4: never edit an applied migration, add a new one.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "role" AS ENUM ('clinical_director', 'billing_coordinator', 'intake_specialist', 'health_education_prevention_specialist', 'community_health_worker', 'program_manager', 'apcc_acsw_intern', 'quality_assurance_coordinator', 'system_administrator');
CREATE TYPE "episode_status" AS ENUM ('open', 'closed');
CREATE TYPE "contact_result" AS ENUM ('contacted', 'no_contact');
CREATE TYPE "care_plan_status" AS ENUM ('draft', 'pending_review', 'approved', 'needs_revision', 'closed');
CREATE TYPE "payer" AS ENUM ('medicare', 'medi_cal', 'molina', 'kaiser', 'blue_shield', 'la_health_net', 'self_pay');
CREATE TYPE "consent_status" AS ENUM ('active', 'expired', 'revoked');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deactivated_at" timestamptz
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "label" text NOT NULL
);

CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE
);

CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL REFERENCES "roles"("id"),
  "permission_id" uuid NOT NULL REFERENCES "permissions"("id"),
  PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_roles" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role_id" uuid NOT NULL REFERENCES "roles"("id"),
  PRIMARY KEY ("user_id", "role_id")
);

-- Append-only. Nothing here is ever updated or deleted.
CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "date_of_birth" date NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "worker_id" uuid NOT NULL REFERENCES "users"("id"),
  "assigned_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz
);

CREATE TABLE "episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "status" episode_status NOT NULL DEFAULT 'open',
  "start_date" date NOT NULL,
  "end_date" date,
  "readmitted_from_episode_id" uuid REFERENCES "episodes"("id"),
  "care_plan_due_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "contact_result" contact_result NOT NULL,
  "body" text NOT NULL,
  "approved_by_id" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "care_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "status" care_plan_status NOT NULL DEFAULT 'draft',
  "goals" text NOT NULL,
  "next_review_due" date,
  "approved_by_id" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "form_name" text NOT NULL,
  "document_url" text,
  "signed_date" date NOT NULL,
  "expires_date" date NOT NULL,
  "status" consent_status NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "funding_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "payer" payer
);

CREATE TABLE "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "funding_source_id" uuid REFERENCES "funding_sources"("id"),
  "category" text NOT NULL,
  "service_date" timestamptz NOT NULL,
  "duration_minutes" integer,
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "assignments_active_idx" ON "assignments" ("participant_id") WHERE "ended_at" IS NULL;
CREATE INDEX "notes_participant_idx" ON "notes" ("participant_id", "created_at");

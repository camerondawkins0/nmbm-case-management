-- Housing Community Supports (M24). Five tables, each voided rather than
-- deleted. The checks below hold the rules the app also enforces, so a
-- bug or a hand-written query can't leave a row that contradicts itself.
CREATE TYPE "cs_service" AS ENUM ('housing_transition_navigation', 'housing_deposits', 'housing_tenancy_sustaining');
CREATE TYPE "cs_authorization_status" AS ENUM ('requested', 'approved', 'denied');
CREATE TYPE "cs_unit_type" AS ENUM ('fifteen_minutes', 'hour', 'visit', 'day', 'month');
CREATE TYPE "housing_situation" AS ENUM ('unsheltered', 'emergency_shelter', 'transitional_housing', 'temporarily_with_others', 'institution', 'permanent_rental', 'permanent_subsidized', 'permanent_supportive_housing', 'owns_home', 'unknown');
CREATE TYPE "housing_activity" AS ENUM ('housing_assessment', 'housing_support_plan', 'housing_search', 'application_assistance', 'document_gathering', 'landlord_engagement', 'move_in_coordination', 'tenancy_education', 'eviction_prevention', 'crisis_intervention', 'benefits_linkage', 'other');
CREATE TYPE "service_contact_method" AS ENUM ('in_person', 'phone', 'video', 'collateral');
CREATE TYPE "deposit_purpose" AS ENUM ('security_deposit', 'utility_deposit_or_setup', 'first_month_utilities', 'furnishings_household_goods', 'moving_costs', 'cleaning_or_pest', 'accessibility_modifications', 'other');
CREATE TYPE "deposit_status" AS ENUM ('requested', 'approved', 'declined', 'paid');
CREATE TYPE "subsidy_type" AS ENUM ('none', 'housing_choice_voucher', 'permanent_supportive', 'rapid_rehousing', 'other');

CREATE TABLE "cs_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "service" "cs_service" NOT NULL,
  "status" "cs_authorization_status" NOT NULL DEFAULT 'requested',
  "plan" "payer",
  "authorization_number" text,
  "requested_date" date NOT NULL,
  "decision_date" date,
  "start_date" date,
  "end_date" date,
  "unit_type" "cs_unit_type",
  "units_authorized" integer,
  "amount_authorized" numeric(10, 2),
  "ended_date" date,
  "ended_reason" text,
  "note" text,
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "decided_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "void_reason" text,
  -- Approved means the plan gave a number and a period to work in.
  CONSTRAINT "cs_auth_approved_complete" CHECK (
    "status" <> 'approved'
    OR ("decision_date" IS NOT NULL AND "authorization_number" IS NOT NULL AND "start_date" IS NOT NULL AND "end_date" IS NOT NULL AND "decided_by_id" IS NOT NULL)
  ),
  CONSTRAINT "cs_auth_denied_decided" CHECK ("status" <> 'denied' OR ("decision_date" IS NOT NULL AND "decided_by_id" IS NOT NULL)),
  CONSTRAINT "cs_auth_period" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "cs_auth_units" CHECK (("unit_type" IS NULL) = ("units_authorized" IS NULL) AND ("units_authorized" IS NULL OR "units_authorized" > 0)),
  CONSTRAINT "cs_auth_amount" CHECK ("amount_authorized" IS NULL OR "amount_authorized" > 0),
  -- Money for deposits, units for the time services; never the other way.
  CONSTRAINT "cs_auth_amount_is_deposits" CHECK ("amount_authorized" IS NULL OR "service" = 'housing_deposits'),
  CONSTRAINT "cs_auth_units_are_time" CHECK ("unit_type" IS NULL OR "service" <> 'housing_deposits'),
  CONSTRAINT "cs_auth_ended" CHECK (
    ("ended_date" IS NULL) = ("ended_reason" IS NULL)
    AND ("ended_date" IS NULL OR ("status" = 'approved' AND "ended_date" >= "start_date" AND "ended_date" <= "end_date"))
  ),
  CONSTRAINT "cs_auth_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("voided_at" IS NULL) = ("voided_by_id" IS NULL))
);
CREATE INDEX "cs_authorizations_participant_idx" ON "cs_authorizations" ("participant_id");

CREATE TABLE "housing_statuses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "situation" "housing_situation" NOT NULL,
  "effective_date" date NOT NULL,
  "note" text,
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "void_reason" text,
  CONSTRAINT "housing_status_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("voided_at" IS NULL) = ("voided_by_id" IS NULL))
);
CREATE INDEX "housing_statuses_participant_idx" ON "housing_statuses" ("participant_id", "effective_date");

CREATE TABLE "housing_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "episode_id" uuid NOT NULL REFERENCES "episodes"("id"),
  "authorization_id" uuid NOT NULL REFERENCES "cs_authorizations"("id"),
  "service_date" date NOT NULL,
  "minutes" integer NOT NULL CHECK ("minutes" BETWEEN 1 AND 720),
  "activity" "housing_activity" NOT NULL,
  "contact_method" "service_contact_method" NOT NULL,
  "note" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "void_reason" text,
  CONSTRAINT "housing_service_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("voided_at" IS NULL) = ("voided_by_id" IS NULL))
);
CREATE INDEX "housing_services_participant_idx" ON "housing_services" ("participant_id", "service_date");
CREATE INDEX "housing_services_authorization_idx" ON "housing_services" ("authorization_id");
CREATE INDEX "housing_services_date_idx" ON "housing_services" ("service_date");

CREATE TABLE "tenancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "move_in_date" date NOT NULL,
  "address_line1" text NOT NULL,
  "address_line2" text,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "postal_code" text NOT NULL,
  "landlord_name" text,
  "landlord_phone" text,
  "subsidy" "subsidy_type" NOT NULL,
  "monthly_rent" numeric(10, 2) CHECK ("monthly_rent" IS NULL OR "monthly_rent" >= 0),
  "tenant_portion" numeric(10, 2) CHECK ("tenant_portion" IS NULL OR "tenant_portion" >= 0),
  "lease_start" date,
  "lease_end" date,
  "move_out_date" date,
  "move_out_reason" text,
  "recorded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "void_reason" text,
  CONSTRAINT "tenancy_lease" CHECK ("lease_end" IS NULL OR "lease_start" IS NULL OR "lease_end" >= "lease_start"),
  CONSTRAINT "tenancy_move_out" CHECK (
    ("move_out_date" IS NULL) = ("move_out_reason" IS NULL)
    AND ("move_out_date" IS NULL OR "move_out_date" >= "move_in_date")
  ),
  CONSTRAINT "tenancy_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("voided_at" IS NULL) = ("voided_by_id" IS NULL))
);
CREATE INDEX "tenancies_participant_idx" ON "tenancies" ("participant_id");
-- One home at a time: a second current tenancy means the first move-out
-- wasn't recorded.
CREATE UNIQUE INDEX "tenancies_one_current" ON "tenancies" ("participant_id") WHERE "move_out_date" IS NULL AND "voided_at" IS NULL;

CREATE TABLE "housing_deposits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  "authorization_id" uuid NOT NULL REFERENCES "cs_authorizations"("id"),
  "purpose" "deposit_purpose" NOT NULL,
  "payee" text NOT NULL,
  "amount" numeric(10, 2) NOT NULL CHECK ("amount" > 0),
  "status" "deposit_status" NOT NULL DEFAULT 'requested',
  "note" text,
  "requested_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by_id" uuid REFERENCES "users"("id"),
  "decided_at" timestamptz,
  "decision_note" text,
  "paid_date" date,
  "payment_reference" text,
  "paid_recorded_by_id" uuid REFERENCES "users"("id"),
  "voided_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "void_reason" text,
  CONSTRAINT "deposit_decided" CHECK ("status" = 'requested' OR ("decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)),
  -- Whoever asked for the money isn't who approves it.
  CONSTRAINT "deposit_not_self_approved" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id"),
  CONSTRAINT "deposit_paid" CHECK (
    ("status" = 'paid') = ("paid_date" IS NOT NULL AND "payment_reference" IS NOT NULL AND "paid_recorded_by_id" IS NOT NULL)
  ),
  -- Money that went out stays on the record.
  CONSTRAINT "deposit_paid_not_voided" CHECK ("status" <> 'paid' OR "voided_at" IS NULL),
  CONSTRAINT "deposit_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("voided_at" IS NULL) = ("voided_by_id" IS NULL))
);
CREATE INDEX "housing_deposits_participant_idx" ON "housing_deposits" ("participant_id");
CREATE INDEX "housing_deposits_authorization_idx" ON "housing_deposits" ("authorization_id");

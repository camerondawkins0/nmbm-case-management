-- Feedback/ticket intake — see docs/SUPPORT.md. Added as a new migration
-- rather than folded into 0000_init.sql: that one's already been pushed
-- and reviewed, so from here on out CLAUDE.md hard rule 4 applies
-- (never edit an applied migration, add a new one).

CREATE TYPE "feedback_category" AS ENUM ('bug', 'feature_request', 'question', 'other');
CREATE TYPE "feedback_status" AS ENUM ('open', 'in_review', 'resolved', 'wont_fix');

CREATE TABLE "feedback_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "submitted_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "category" feedback_category NOT NULL,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "status" feedback_status NOT NULL DEFAULT 'open',
  "resolution_note" text,
  "resolved_by_id" uuid REFERENCES "users"("id"),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "feedback_items_status_idx" ON "feedback_items" ("status", "created_at");

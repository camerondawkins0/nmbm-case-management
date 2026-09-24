-- U6: "CHW supervisor/Program Manager can either approve CHW notes or
-- return them for revision. Clinical Director reviews notes, treatment
-- plans, etc., for APCC/ACSW." The approval columns existed from 0000
-- but there was no way to express "sent back", so a reviewer's only
-- option was to approve or leave it sitting.

CREATE TYPE "note_status" AS ENUM ('pending_review', 'approved', 'needs_revision');

ALTER TABLE "notes" ADD COLUMN "status" note_status NOT NULL DEFAULT 'pending_review';
-- Why it was sent back, so the author isn't left guessing.
ALTER TABLE "notes" ADD COLUMN "review_note" text;

-- Notes already approved in 0000/0002 data keep that meaning.
UPDATE "notes" SET "status" = 'approved' WHERE "approved_at" IS NOT NULL;

CREATE INDEX "notes_status_idx" ON "notes" ("status", "created_at");

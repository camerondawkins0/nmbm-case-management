-- Uploaded files on a participant's record: scans of signed consent
-- forms first among them. The bytes live in Cloud Storage under an
-- opaque key; this row is what the file is, whose it is, and who did
-- what with it.
--
-- A row is 'pending' from the moment an upload link is issued until the
-- server has checked the file actually arrived. Pending rows are never
-- shown — a record must not list a document that doesn't exist.
-- Nothing is deleted (M30): a document filed against the wrong person
-- is voided, with the reason, and its file kept.
CREATE TYPE "document_status" AS ENUM ('pending', 'uploaded', 'voided');

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "participants"("id"),
  -- Set when this is the scan of a consent form recorded in the system.
  "consent_id" uuid REFERENCES "consents"("id"),
  "description" text NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "original_filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "status" "document_status" NOT NULL DEFAULT 'pending',
  "uploaded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "uploaded_at" timestamptz,
  "voided_by_id" uuid REFERENCES "users"("id"),
  "voided_at" timestamptz,
  "void_reason" text
);

CREATE INDEX "documents_participant" ON "documents" ("participant_id");

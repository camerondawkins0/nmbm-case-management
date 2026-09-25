-- Settings NMBM change from the app rather than by asking for a deploy
-- (M31: no IT staff). A row exists only once somebody has changed a
-- setting; until then the default declared in @nmbm/shared applies, so
-- a new setting needs no data migration to take effect.
--
-- Integer-valued because every setting so far is a number of days or
-- minutes. Who changed it and when is kept on the row, and the change
-- itself is also written to the audit log.
-- The uuid exists for the audit log, whose entity ids are uuids.
CREATE TABLE "app_settings" (
  "id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "key" text PRIMARY KEY,
  "value" integer NOT NULL,
  "updated_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

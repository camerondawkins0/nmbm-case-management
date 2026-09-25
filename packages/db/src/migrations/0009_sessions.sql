-- Sessions in the database rather than in the server's memory. On Cloud
-- Run a memory store signs everybody out on every restart and deploy,
-- and two instances don't share it, so a person would be bounced between
-- signed in and signed out depending on which one answered.
--
-- The key is a SHA-256 of the session id, never the id itself. The id is
-- what the browser presents to prove who it is; anyone who could read
-- this table would otherwise be able to become any signed-in user.
-- Nothing here is participant data: a user id, timestamps and the
-- sign-in round-trip token.
CREATE TABLE "sessions" (
  "id_hash" text PRIMARY KEY,
  "data" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX "sessions_expires_at" ON "sessions" ("expires_at");

import { pgView, uuid, bigint } from "drizzle-orm/pg-core";

// Defined in migration 0006 (replacing 0002's), declared here with
// .existing() so queries against it are typed. Derived, never written
// to: the run of failed contact attempts since the last successful one
// (M6), counted within the open episode only — see
// docs/agent/invariants.md, R10.
export const vNoContactCounts = pgView("v_no_contact_counts", {
  participantId: uuid("participant_id").notNull(),
  episodeId: uuid("episode_id").notNull(),
  consecutiveNoContacts: bigint("consecutive_no_contacts", { mode: "number" }).notNull(),
}).existing();

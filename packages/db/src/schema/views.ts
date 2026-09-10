import { pgView, uuid, bigint } from "drizzle-orm/pg-core";

// Defined in migration 0002, declared here with .existing() so queries
// against it are typed. Derived, never written to: the count is the run
// of failed contact attempts since the last successful one (M6).
export const vNoContactCounts = pgView("v_no_contact_counts", {
  participantId: uuid("participant_id").notNull(),
  consecutiveNoContacts: bigint("consecutive_no_contacts", { mode: "number" }).notNull(),
}).existing();

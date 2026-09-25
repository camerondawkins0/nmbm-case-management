import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Sign-in sessions, shared by every instance of the app. Keyed by a hash
// of the session id — see migration 0009 for why never the id itself.
export const sessions = pgTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  data: jsonb("data").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

import { pgTable, text, integer, uuid, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Admin-changeable settings, one row per key that has been changed.
// Keys, defaults and bounds live in @nmbm/shared (APP_SETTINGS) — an
// absent row means the default.
export const appSettings = pgTable("app_settings", {
  // For the audit log, whose entity ids are uuids.
  id: uuid("id").notNull().unique().defaultRandom(),
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
  updatedById: uuid("updated_by_id").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

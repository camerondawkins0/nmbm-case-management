import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { consentStatusEnum } from "./enums.js";

// M15/M16: uploads with a status and an expiry. Expiry is stored, not
// just computed, so a status flip to "expired" can be driven by a
// scheduled job and show up in queries without recomputing from
// signedDate every time.
export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  formName: text("form_name").notNull(),
  documentUrl: text("document_url"), // Cloud Storage object path
  signedDate: date("signed_date").notNull(),
  // M16: one year after signedDate. What happens when a required
  // consent is missing/expired (block vs. warn) is still open — see
  // docs/DISCOVERY_FOLLOWUP.md.
  expiresDate: date("expires_date").notNull(),
  status: consentStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

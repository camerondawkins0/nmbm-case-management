import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { consents } from "./consents.js";
import { users } from "./users.js";
import { documentStatusEnum } from "./enums.js";

// Uploaded files on a participant's record. Bytes in Cloud Storage under
// an opaque key; see migration 0010 for the pending/uploaded/voided life.
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  consentId: uuid("consent_id").references(() => consents.id),
  description: text("description").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: documentStatusEnum("status").notNull().default("pending"),
  uploadedById: uuid("uploaded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  voidedById: uuid("voided_by_id").references(() => users.id),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
});

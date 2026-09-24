import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { participants } from "./participants.js";
import { episodes } from "./episodes.js";
import { users } from "./users.js";
import { consentStatusEnum, consentTypeEnum } from "./enums.js";

// M15/M16. `status` only ever carries "revoked" as a decision someone
// made; whether a consent has expired is derived from expiresDate at
// read time rather than flipped by a scheduled job. A stored status and
// a date that disagree is the failure mode that lets an expired consent
// authorise a disclosure.
//
// No file upload yet: DOCUMENTS_BUCKET is unprovisioned, so documentUrl
// stays for when Cloud Storage exists. Recording that a form was signed
// is useful without the scan attached.
export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  // Which enrolment the expiry was counted from — M16 anchors it to
  // enrolment, not to the signature.
  episodeId: uuid("episode_id").references(() => episodes.id),
  type: consentTypeEnum("type").notNull().default("general_services"),
  formName: text("form_name").notNull(),
  documentUrl: text("document_url"),
  signedDate: date("signed_date").notNull(),
  expiresDate: date("expires_date").notNull(),
  status: consentStatusEnum("status").notNull().default("active"),
  recordedById: uuid("recorded_by_id").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

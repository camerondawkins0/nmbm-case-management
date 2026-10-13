import { z } from "zod";

// Why a whole record is leaving the system. Recorded with every export,
// because handing over everything about a person is a disclosure, and
// HIPAA's accounting of disclosures asks for the purpose.
export const RECORD_EXPORT_PURPOSES = [
  "participant_request",
  "legal_request",
  "transfer_of_care",
  "funder_audit",
  "other",
] as const;
export type RecordExportPurpose = (typeof RECORD_EXPORT_PURPOSES)[number];

export const recordExportSchema = z
  .object({
    purpose: z.enum(RECORD_EXPORT_PURPOSES),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.purpose !== "other" || !!v.note, {
    message: "Say what the export is for",
    path: ["note"],
  });

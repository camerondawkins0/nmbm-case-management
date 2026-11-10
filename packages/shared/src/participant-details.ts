import { z } from "zod";

// NMBM work in Long Beach. "Today" for a date of service is the day it
// is there, not on the server, which runs on UTC: a note written at 6pm
// is still that day's.
export const ORG_TIME_ZONE = "America/Los_Angeles";

export function todayInOrg(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIME_ZONE }).format(now);
}

// Empty means "not given", so a cleared box clears the value.
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullish());

// Ten digits, however they were typed; a leading 1 is dropped.
const phone = z.preprocess(
  blankToNull,
  z
    .string()
    .transform((v) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
    .refine((v) => /^\d{10}$/.test(v), { message: "A phone number has 10 digits, like (562) 555-0134" })
    .nullish(),
);

export function formatPhone(digits: string | null | undefined) {
  if (!digits) return "";
  return /^\d{10}$/.test(digits) ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

// The Medi-Cal Client Index Number: eight digits and a check letter.
export const MEDI_CAL_CIN_PATTERN = /^\d{8}[A-Z]$/;

export const participantDetailsSchema = z.object({
  phone,
  email: z.preprocess(blankToNull, z.string().trim().toLowerCase().email().max(200).nullish()),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  state: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use the two-letter state code, like CA")
      .nullish(),
  ),
  postalCode: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "A ZIP code is 5 digits, or 5 and 4 like 90802-1234")
      .nullish(),
  ),
  mediCalCin: z.preprocess(
    blankToNull,
    z
      .string()
      .transform((v) => v.replace(/\s/g, "").toUpperCase())
      .refine((v) => MEDI_CAL_CIN_PATTERN.test(v), { message: "A Medi-Cal CIN is 8 digits and a letter, like 91234567A" })
      .nullish(),
  ),
  // Each plan formats its own, so it's only trimmed.
  planMemberId: text(40),
  emergencyContactName: text(200),
  emergencyContactPhone: phone,
  emergencyContactRelationship: text(100),
});
export type ParticipantDetails = z.infer<typeof participantDetailsSchema>;
export const PARTICIPANT_DETAIL_FIELDS = Object.keys(participantDetailsSchema.shape) as (keyof ParticipantDetails)[];

// Changing them afterward: only what's sent changes.
export const participantDetailsUpdateSchema = participantDetailsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

// For the audit line and the screen: which fields changed, never the
// values, which are PHI.
export const PARTICIPANT_DETAIL_LABELS: Record<keyof ParticipantDetails, string> = {
  phone: "Phone",
  email: "Email",
  addressLine1: "Address",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  postalCode: "ZIP code",
  mediCalCin: "Medi-Cal CIN",
  planMemberId: "Health plan member ID",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency contact phone",
  emergencyContactRelationship: "Emergency contact relationship",
};

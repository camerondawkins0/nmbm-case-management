import { z } from "zod";
import { PAYERS } from "./enums.js";

// People referred *to* NMBM. M17 only covered referrals going out; R5
// says substance-use referrals are expected soon and mental-health ones
// already arrive. Who sends them, and what each sender wants back, was
// never answered — so the sources below are broad, and the free-text
// name carries the specifics until NMBM give a partner list.
export const INCOMING_REFERRAL_SOURCES = [
  "health_plan",
  "hospital",
  "clinic",
  "court_probation",
  "community_org",
  "self",
  "other",
] as const;
export type IncomingReferralSource = (typeof INCOMING_REFERRAL_SOURCES)[number];

// new → contacting → admitted or closed. Nothing is deleted: a referral
// entered by mistake is closed as "entered in error", with who and why.
export const INCOMING_REFERRAL_STATUSES = ["new", "contacting", "admitted", "closed"] as const;
export type IncomingReferralStatus = (typeof INCOMING_REFERRAL_STATUSES)[number];

export const INCOMING_REFERRAL_CLOSE_REASONS = [
  "declined",
  "unable_to_reach",
  "not_eligible",
  "referred_elsewhere",
  "duplicate",
  "entered_in_error",
] as const;
export type IncomingReferralCloseReason = (typeof INCOMING_REFERRAL_CLOSE_REASONS)[number];

// The referrer isn't owed an outcome for these: there's nobody to tell
// about a self-referral, and "duplicate" or "entered in error" weren't
// referrals at all.
export const NO_OUTCOME_OWED_REASONS: ReadonlySet<IncomingReferralCloseReason> = new Set([
  "duplicate",
  "entered_in_error",
]);

export const incomingReferralCreateSchema = z.object({
  receivedDate: z.string().date(),
  sourceType: z.enum(INCOMING_REFERRAL_SOURCES),
  sourceName: z.string().trim().max(200).nullish(),
  sourceContact: z.string().trim().max(300).nullish(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().date().nullish(),
  phone: z.string().trim().max(50).nullish(),
  payer: z.enum(PAYERS).nullish(),
  reason: z.string().trim().min(1).max(2000),
});
export type IncomingReferralCreate = z.infer<typeof incomingReferralCreateSchema>;

export const incomingReferralNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export const incomingReferralCloseSchema = z.object({
  reason: z.enum(INCOMING_REFERRAL_CLOSE_REASONS),
  note: z.string().trim().max(2000).nullish(),
});

export const incomingReferralLinkSchema = z.object({ participantId: z.string().uuid() });

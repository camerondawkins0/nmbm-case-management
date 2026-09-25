import { z } from "zod";

// M12: "3, 5, 9, 12 months after disenrollment ... someone do follow up
// calls to reach out to participants to see how they are doing. This may
// lead to re-enrollment or the client is successful." QA makes the calls.
export const FOLLOW_UP_MONTHS = [3, 5, 9, 12] as const;
export type FollowUpMonths = (typeof FOLLOW_UP_MONTHS)[number];

// A milestone stays in the queue until the next one falls due; the last
// one until this many months after closure. NMBM didn't say how long a
// missed call stays worth making — this is our assumption, flagged in
// docs/DISCOVERY_FOLLOWUP.md.
export const FOLLOW_UP_FINAL_LAPSE_MONTHS = 15;

// How far ahead of the due date a call can be made and still count.
export const FOLLOW_UP_EARLY_DAYS = 14;

// The two answers M12 names — "re-enrollment or the client is
// successful" — plus the three ways a call doesn't get that far.
export const FOLLOW_UP_OUTCOMES = [
  "reached_doing_well",
  "reached_wants_services",
  "no_answer",
  "declined",
  "wrong_number",
] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

// Outcomes that settle a milestone. "No answer" is an attempt; the call
// is still owed.
export const FOLLOW_UP_COMPLETING: readonly FollowUpOutcome[] = [
  "reached_doing_well",
  "reached_wants_services",
  "declined",
  "wrong_number",
];

export const FOLLOW_UP_OUTCOME_LABELS: Record<FollowUpOutcome, string> = {
  reached_doing_well: "Reached — doing well",
  reached_wants_services: "Reached — wants services again",
  no_answer: "No answer",
  declined: "Reached — declined to talk",
  wrong_number: "Number no longer works",
};

export const followUpCallSchema = z
  .object({
    episodeId: z.string().uuid(),
    milestoneMonths: z.union([z.literal(3), z.literal(5), z.literal(9), z.literal(12)]),
    outcome: z.enum(FOLLOW_UP_OUTCOMES),
    note: z.string().trim().min(1).optional(),
    // "to see how the services were received" — the QA half of M12.
    servicesFeedback: z.string().trim().min(1).optional(),
  })
  .refine((v) => !v.outcome.startsWith("reached_") || v.note, {
    message: "Say how they're doing — a reached call needs a note",
    path: ["note"],
  });
export type FollowUpCall = z.infer<typeof followUpCallSchema>;

// Readmission search. A name fragment, a date of birth, or both.
export const participantSearchSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    dob: z.string().date().optional(),
  })
  .refine((v) => (v.q && v.q.length >= 2) || v.dob, {
    message: "Search by at least two letters of a name, or a date of birth",
  });
export type ParticipantSearch = z.infer<typeof participantSearchSchema>;

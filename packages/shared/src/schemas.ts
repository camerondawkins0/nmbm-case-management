import { z } from "zod";
import {
  EPISODE_STATUSES,
  CONTACT_RESULTS,
  CARE_PLAN_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
} from "./enums.js";

export const participantCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().date(),
  assignedWorkerId: z.string().uuid().optional(),
});
export type ParticipantCreate = z.infer<typeof participantCreateSchema>;

export const episodeCreateSchema = z.object({
  participantId: z.string().uuid(),
  startDate: z.string().date(),
  status: z.enum(EPISODE_STATUSES).default("open"),
});
export type EpisodeCreate = z.infer<typeof episodeCreateSchema>;

// M5: basic contact info, ECM Comp Needs Assessment info, health
// insurance, care plan — free-text body plus a structured contact result
// so the no-contact counter (M6) can be derived without parsing text.
export const noteCreateSchema = z.object({
  participantId: z.string().uuid(),
  episodeId: z.string().uuid(),
  contactResult: z.enum(CONTACT_RESULTS),
  body: z.string().min(1),
});
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const carePlanUpdateSchema = z.object({
  status: z.enum(CARE_PLAN_STATUSES),
  goals: z.string().min(1),
});
export type CarePlanUpdate = z.infer<typeof carePlanUpdateSchema>;

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
});
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;

export const feedbackStatusUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  resolutionNote: z.string().min(1).optional(),
});
export type FeedbackStatusUpdate = z.infer<typeof feedbackStatusUpdateSchema>;

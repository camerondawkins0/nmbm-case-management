import type { EpisodeClosureReason } from "@nmbm/shared";

// Shared so the close form, the closed list and the episode history
// can't describe the same exit three different ways.
export const CLOSURE_REASON_LABELS: Record<EpisodeClosureReason, string> = {
  completed: "Completed services",
  no_contact: "Unable to contact",
  participant_declined: "Declined services",
  moved: "Moved out of area",
  other: "Other",
};

export const PAYER_LABELS: Record<string, string> = {
  medicare: "Medicare",
  medi_cal: "Medi-Cal",
  molina: "Molina",
  kaiser: "Kaiser",
  blue_shield: "Blue Shield",
  la_health_net: "LA Health Net",
  self_pay: "Self-pay",
};

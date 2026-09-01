// Roles as given in discovery (U2). "Are we missing any?" was left open —
// check docs/DISCOVERY_FOLLOWUP.md before adding or removing one.
export const ROLES = [
  "clinical_director",
  "billing_coordinator",
  "intake_specialist",
  "health_education_prevention_specialist",
  "community_health_worker",
  "program_manager",
  "apcc_acsw_intern",
  "quality_assurance_coordinator",
  "system_administrator",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  clinical_director: "Clinical Director",
  billing_coordinator: "Billing Coordinator",
  intake_specialist: "Intake Specialist",
  health_education_prevention_specialist:
    "Health Education and Prevention Specialist",
  community_health_worker: "Community Health Worker",
  program_manager: "Program Manager",
  apcc_acsw_intern: "APCC / ACSW Intern",
  quality_assurance_coordinator: "Quality Assurance Coordinator",
  system_administrator: "System Administrator",
};

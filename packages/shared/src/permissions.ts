import type { Role } from "./roles.js";

// Permission codes are the unit `authorize()` checks against — never a
// role name directly, so a role's grants can change without touching
// route code. Scoped to what's actually built in this scaffold
// (participants, episodes, notes, care plans) plus admin.
export const PERMISSIONS = [
  "participants.read.own", // own caseload only (discovery U5)
  "participants.read.all",
  "participants.write",
  "episodes.write",
  "notes.write",
  "notes.approve", // CHW supervisor / Program Manager (U6)
  "care_plans.write",
  "care_plans.approve", // Clinical Director (U6)
  "admin.users.manage",
  "admin.settings.manage",
  "feedback.submit", // any logged-in user — NMBM has no dedicated IT staff (M31), see docs/SUPPORT.md
  "feedback.manage", // triage/status changes — restricted, see docs/SUPPORT.md
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Starting grants, seeded from the sign-off chains in discovery U3/U6.
// Not a final permission grid — confirm against docs/spec/WSL_Permission_Grid.md's
// approach (one row per capability, reviewed with the client) before launch.
// feedback.submit is granted to every role below — anyone logged in can
// report an issue or leave feedback, regardless of what else they can
// see or do. Listed explicitly per role rather than defaulted globally,
// so the grid stays the single source of truth for "who can do what."
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  clinical_director: [
    "participants.read.all",
    "participants.write",
    "episodes.write",
    "notes.write",
    "notes.approve",
    "care_plans.write",
    "care_plans.approve",
    "feedback.submit",
  ],
  billing_coordinator: ["participants.read.all", "feedback.submit"],
  intake_specialist: [
    "participants.read.own",
    "participants.write",
    "episodes.write",
    "feedback.submit",
  ],
  health_education_prevention_specialist: [
    "participants.read.own",
    "notes.write",
    "feedback.submit",
  ],
  community_health_worker: [
    "participants.read.own",
    "notes.write",
    "care_plans.write",
    "feedback.submit",
  ],
  program_manager: [
    "participants.read.all",
    "notes.approve",
    "feedback.submit",
  ],
  apcc_acsw_intern: ["participants.read.own", "notes.write", "feedback.submit"],
  quality_assurance_coordinator: ["participants.read.all", "feedback.submit"],
  system_administrator: [
    "admin.users.manage",
    "admin.settings.manage",
    "participants.read.all",
    "feedback.submit",
    "feedback.manage",
  ],
};

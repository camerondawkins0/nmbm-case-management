import type { Role } from "./roles.js";

// Permission codes are the unit `authorize()` checks against — never a
// role name directly, so a role's grants can change without touching
// route code. Scoped to what's actually built in this scaffold
// (participants, episodes, notes, care plans) plus admin.
export const PERMISSIONS = [
  "participants.read.own", // own caseload only (discovery U5)
  "participants.read.all",
  // R10: find and open former participants' records, for readmission.
  // NMBM: intake "can readmit, especially if a directive is given to do
  // so" — which needs sight of the closed record without sight of every
  // active caseload.
  "participants.read.closed",
  "participants.write",
  // U3/M4: "Supervisors can assign a client to a CHW. Clinical Director
  // can assign a mental health client to an MSW intern, APCC, or ACSW."
  "participants.assign",
  "episodes.write",
  "notes.write",
  "notes.approve", // CHW supervisor / Program Manager (U6)
  "care_plans.write",
  "care_plans.approve", // Clinical Director (U6)
  "consents.write", // record and revoke consent forms (M15/M16)
  "referrals.write", // refer out and record what came back (M17)
  "programs.manage", // set up programmes, cohorts and class dates (M14)
  "attendance.record", // mark a roster — the evidence a PO relies on (M14)
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
    "programs.manage",
    "attendance.record",
    "consents.write",
    "referrals.write",
    "participants.read.all",
    "participants.write",
    "participants.assign",
    "episodes.write",
    "notes.write",
    "notes.approve",
    "care_plans.write",
    "care_plans.approve",
    "feedback.submit",
  ],
  billing_coordinator: ["participants.read.all", "feedback.submit"],
  intake_specialist: [
    "participants.read.closed",
    "consents.write",
    "referrals.write",
    "participants.read.own",
    "participants.write",
    "episodes.write",
    "feedback.submit",
  ],
  health_education_prevention_specialist: [
    "attendance.record",
    "participants.read.own",
    "notes.write",
    "feedback.submit",
  ],
  community_health_worker: [
    "attendance.record",
    "consents.write",
    "referrals.write",
    "participants.read.own",
    "notes.write",
    "care_plans.write",
    "feedback.submit",
  ],
  program_manager: [
    "programs.manage",
    "attendance.record",
    "referrals.write",
    "participants.read.all",
    "participants.assign",
    "notes.approve",
    "feedback.submit",
  ],
  apcc_acsw_intern: [
    "attendance.record",
    "participants.read.own",
    "notes.write",
    "referrals.write",
    "feedback.submit",
  ],
  quality_assurance_coordinator: ["participants.read.all", "feedback.submit"],
  system_administrator: [
    "programs.manage",
    "admin.users.manage",
    "admin.settings.manage",
    "participants.read.all",
    "participants.assign",
    "feedback.submit",
    "feedback.manage",
  ],
};

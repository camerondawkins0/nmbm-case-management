import { z } from "zod";
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
  // Upload a file to a record, or void one filed in error. Reading needs
  // only sight of the participant; every open is audited.
  "documents.write",
  "referrals.write", // refer out and record what came back (M17)
  // People referred *to* NMBM: the queue before anyone is admitted. It
  // holds names of people who aren't participants yet, so it isn't
  // open to every worker.
  "incoming_referrals.manage",
  // A participant's complete record as one document — for their own
  // request, a court, a transfer of care. A disclosure, so it's audited
  // with a purpose and held by few.
  "records.export",
  // Build and publish NMBM's own forms — the registration form, the
  // needs assessment (M11/M13). Changes what every worker is asked to
  // collect, so it sits with the people who decide that.
  "assessments.manage",
  // Fill one in on a participant's record, with them or from paper.
  "assessments.write",
  "programs.manage", // set up programs, cohorts and class dates (M14)
  "attendance.record", // mark a roster — the evidence a PO relies on (M14)
  // M12: "it would be nice for our QA to be able to make the calls".
  "follow_ups.record",
  "admin.users.manage",
  "admin.settings.manage",
  // Change which permissions each role holds. NMBM decide their own
  // grid; this is how they change it without a developer.
  "admin.roles.manage",
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
    "records.export",
    "incoming_referrals.manage",
    "assessments.write",
    "assessments.manage",
    "documents.write",
    "follow_ups.record",
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
    "incoming_referrals.manage",
    "assessments.write",
    "documents.write",
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
    "assessments.write",
    "documents.write",
    "attendance.record",
    "consents.write",
    "referrals.write",
    "participants.read.own",
    "notes.write",
    "care_plans.write",
    "feedback.submit",
  ],
  program_manager: [
    "incoming_referrals.manage",
    "assessments.manage",
    "programs.manage",
    "attendance.record",
    "referrals.write",
    "participants.read.all",
    "participants.assign",
    "notes.approve",
    "feedback.submit",
  ],
  apcc_acsw_intern: [
    "assessments.write",
    "attendance.record",
    "participants.read.own",
    "notes.write",
    "referrals.write",
    "feedback.submit",
  ],
  quality_assurance_coordinator: ["records.export", "participants.read.all", "follow_ups.record", "feedback.submit"],
  system_administrator: [
    "admin.roles.manage",
    "assessments.manage",
    "programs.manage",
    "admin.users.manage",
    "admin.settings.manage",
    "participants.read.all",
    "participants.assign",
    "feedback.submit",
    "feedback.manage",
  ],
};

// What each permission lets somebody do, in the words the permissions
// screen shows. Grouped so the grid reads by area of work.
export const PERMISSION_INFO: Record<Permission, { group: string; label: string; description: string }> = {
  "participants.read.own": { group: "Clients", label: "See own caseload", description: "Open the records of clients assigned to them." },
  "participants.read.all": { group: "Clients", label: "See every client", description: "Open any active or closed record, on anyone's caseload." },
  "participants.read.closed": { group: "Clients", label: "See closed records", description: "Find and open former clients' records, to readmit them. Not active ones." },
  "participants.write": { group: "Clients", label: "Admit clients", description: "Complete intake for a new client." },
  "participants.assign": { group: "Clients", label: "Assign case managers", description: "Hand a client to a different case manager." },
  "episodes.write": { group: "Clients", label: "Close and readmit", description: "Close an enrollment (disenroll) and readmit a former client." },
  "records.export": { group: "Clients", label: "Export whole records", description: "Export a client's complete record. Logged with a reason, as a disclosure." },
  "notes.write": { group: "Notes and care plans", label: "Write notes", description: "Record contact notes on clients they can see." },
  "notes.approve": { group: "Notes and care plans", label: "Review notes", description: "Approve other people's notes or return them for revision." },
  "care_plans.write": { group: "Notes and care plans", label: "Write care plans", description: "Write and submit care plans." },
  "care_plans.approve": { group: "Notes and care plans", label: "Approve care plans", description: "Approve care plans or return them for revision." },
  "consents.write": { group: "Consents, referrals and documents", label: "Record consents", description: "Record signed consent forms and revoke them." },
  "referrals.write": { group: "Consents, referrals and documents", label: "Refer out", description: "Refer clients to partner agencies and record what happened." },
  "incoming_referrals.manage": { group: "Consents, referrals and documents", label: "Work referrals in", description: "Record people referred to NMBM and admit or close them." },
  "documents.write": { group: "Consents, referrals and documents", label: "Upload documents", description: "Upload scans to a record and void ones filed in error." },
  "assessments.write": { group: "Forms", label: "Fill in forms", description: "Fill in forms on a record and send forms to participants." },
  "assessments.manage": { group: "Forms", label: "Build forms", description: "Create, edit and publish NMBM's forms." },
  "programs.manage": { group: "Programs", label: "Set up programs", description: "Create programs and cohorts, set what completing one takes, add class dates, enroll and withdraw." },
  "attendance.record": { group: "Programs", label: "Take attendance", description: "Mark attendance for a class." },
  "follow_ups.record": { group: "Programs", label: "Make follow-up calls", description: "See the 3/5/9/12-month call queue and record calls." },
  "admin.users.manage": { group: "Administration", label: "Manage staff", description: "Give staff their roles, and deactivate or reactivate accounts." },
  "admin.roles.manage": { group: "Administration", label: "Change permissions", description: "Change what each role can do, on this screen." },
  "admin.settings.manage": { group: "Administration", label: "Change settings", description: "Change settings such as the former case manager's access window." },
  "feedback.submit": { group: "Administration", label: "Report issues", description: "Send feedback or report a problem." },
  "feedback.manage": { group: "Administration", label: "Triage feedback", description: "Work the feedback queue." },
};

// The permissions that keep the app administrable. A change that would
// leave no active person holding one of these is refused.
export const LOCKOUT_PERMISSIONS: Permission[] = ["admin.roles.manage", "admin.users.manage"];

// Custom roles: a name NMBM choose for a set of the permissions above.
export const roleCreateSchema = z.object({
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullish(),
  // Start as a copy of an existing role's permissions, or empty.
  copyFrom: z.string().min(1).max(100).nullish(),
});

export const roleUpdateSchema = z
  .object({
    label: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

// Permissions that do nothing on their own, and what they need with them.
// Shown as a warning on the role, not enforced: a role is often built up
// one box at a time, and refusing the intermediate steps would make that
// impossible. The server still checks every request against what the
// role actually holds.
const SEES_CLIENTS: Permission[] = ["participants.read.own", "participants.read.all"];
export const PERMISSION_NEEDS: Partial<Record<Permission, { anyOf: Permission[]; why: string }>> = {
  "notes.write": { anyOf: SEES_CLIENTS, why: "notes are written on a client's record" },
  "care_plans.write": { anyOf: SEES_CLIENTS, why: "care plans are written on a client's record" },
  "consents.write": { anyOf: SEES_CLIENTS, why: "consents are recorded on a client's record" },
  "referrals.write": { anyOf: SEES_CLIENTS, why: "referrals are made from a client's record" },
  "documents.write": { anyOf: SEES_CLIENTS, why: "documents are uploaded to a client's record" },
  "assessments.write": { anyOf: SEES_CLIENTS, why: "forms are filled in on a client's record" },
  "episodes.write": { anyOf: [...SEES_CLIENTS, "participants.read.closed"], why: "closing and readmitting happen on a client's record" },
  "records.export": { anyOf: SEES_CLIENTS, why: "only records they can see can be exported" },
  "participants.assign": { anyOf: ["participants.read.all"], why: "reassigning needs sight of other caseloads" },
};

export function permissionWarnings(held: Permission[]) {
  const has = new Set(held);
  return held.flatMap((p) => {
    const need = PERMISSION_NEEDS[p];
    if (!need || need.anyOf.some((n) => has.has(n))) return [];
    return [{ permission: p, needs: need.anyOf, why: need.why }];
  });
}

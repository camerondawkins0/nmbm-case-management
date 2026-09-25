# Architecture — NMBM Case Management

Status: **partly built.** The scoping decisions below came from the
discovery document and NMBM's compliance follow-up; everything under
"What is built" is running code that can be signed into and used. The
BAA is signed (see below), so hosting can proceed; D2/D3 (budget,
timeline) and M23 (billing) still aren't closed — see
`docs/DISCOVERY_FOLLOWUP.md` for current status on every item.

Jump to **What is built** and **What is not built** at the bottom for
the current state. The sections in between are the reasoning that
produced it, and they haven't changed.

## Why this looks like the WSL system

WSL's case management system (Fastify + Drizzle + Postgres + React SPA, one
Cloud Run service) is the reference implementation this scaffold is adapted
from: participant record + episode, named-worker caseloads, notes with a
no-contact counter, care plans with review clocks, versioned assessments,
grants with scoped services, append-only audit log, void-not-delete. NMBM's
discovery answers land on "yes" or "yes with a twist" for nearly all of it
(see the item-by-item mapping below). The differences are real, though, and
they're concentrated in two places: **billing** and **the specific automated
prompts NMBM described that WSL doesn't have.**

## Hosting: Google Cloud, not Azure

The WSL system runs on Cloud Run against a plain (no-BAA) setup, with an
Azure port documented separately (`docs/AZURE.md` in that repo). NMBM's
**Google Workspace Business Standard BAA is signed** (R2/R3 — CEO Dayna
Moore signed it) specifically so this system can run under it — that
decision is *why* Google was picked, not an afterthought, and it's now
confirmed rather than pending. R4 (whether a *second* BAA is needed
covering this system and whoever builds/hosts it, since a contractor
other than Google touches the data during build) is still open — NMBM is
looking into it. Don't treat "the BAA is signed" as "hosting is fully
cleared" until R4 closes.

| Concern | Choice | Why |
|---|---|---|
| Compute | Cloud Run (single service, same shape as WSL: Fastify API serves the built React SPA) | Matches proven architecture; scales to zero between the ~10 staff logins (U8), which matters for cost at this size |
| Database | Cloud SQL for Postgres | Drizzle schema/migrations port directly; Cloud SQL is covered under Google's standard BAA terms |
| File storage (documents, consent uploads, photos) | Cloud Storage, private bucket, signed URLs | `lib/storage.ts` in the WSL codebase already abstracts this behind a `StorageProvider` interface with a GCS implementation — reuse as-is |
| Auth | Google OIDC (Workspace SSO) as the only login path | NMBM is already a Google Workspace org (M27); no separate Entra ID path needed unlike WSL, which supports both |
| Secrets | Secret Manager | DB credentials, OIDC client secret |
| CI/CD | Cloud Build, same `cloudbuild.yaml` pattern as WSL: migrate then deploy in one run | Reuse the pattern, not the file — NMBM's migrations start from zero |
| Backups | Cloud SQL automated backups + point-in-time recovery | Non-negotiable given this is PHI once R1 resolves either way |

Open question this whole table depends on: **R1 — is NMBM a HIPAA covered
entity, business associate, or neither?** They answered "not right now,"
but they bill Medicare/Medi-Cal/health plans (M22) and hold clinical notes,
which is usually what makes that answer stop being "not right now." Build
for covered-entity-grade handling regardless (encryption at rest and in
transit, audit log, BAA-covered services only) — it costs little extra now
and a lot to retrofit.

**42 CFR Part 2 (R5) is now a real, near-term requirement, not a
hypothetical.** NMBM expects SUD referrals soon and already receives
general mental-health referrals (DV-specific referrals are on hold
pending LA County approval). They asked directly whether this can be
built and acknowledged it's likely additional cost — treat that as a
yes: Part 2 needs its own consent and re-disclosure handling, distinct
from standard HIPAA-level consent (`packages/db/src/schema/consents.ts`
will need a Part-2-specific flag and a stricter disclosure-gate rule
once this is scoped), priced as an add-on once M23 sets the baseline
estimate. Retention separately confirmed at 7 years, per California
state requirement (R6) — feeds directly into whatever the R10 archive
behavior below computes against.

## What carries over from the WSL pattern directly

- **Module split**: `routes.ts` (parse + `authorize()`, no Drizzle) /
  `service.ts` (rules, transactions, no HTTP) / `repository.ts` (Drizzle
  queries, no rules). Kept as-is in this scaffold — see
  `docs/agent/map.md`.
- **Void, not delete**: matches NMBM's own answer to M30 exactly
  ("I like the voiding of it to be able to get the information"). Same
  hard rule as WSL, unchanged.
- **Named-worker caseload**: U5 ("own assignments") and M4 map directly
  onto WSL's `lib/caseload.ts` pattern — a front-line CHW's queries are
  scoped to their own assignments server-side, not just hidden in the UI.
- **Append-only audit log**: U9 (archive on departure, reassign caseload)
  and M30 both want this; same `audit_log` table shape.
- **Money as a string, numeric columns end to end**: applies the moment
  stipends (M18/M19) or billing (M22) are built — carried over from WSL's
  hard rule #5, for the same reason (float rounding on currency).

## Where NMBM diverges from WSL

**Billing is new and is the biggest single piece — and it's more layered
than the first pass suggested.** WSL doesn't bill a payer per unit of
service; NMBM's follow-up on M22 broke the funding picture into four
distinct channels, not one:

- Medicare and Medi-Cal, billed **directly** by NMBM.
- Kaiser Independent Living Services (ILS), billed under a separate
  **MCP contract**, for ILS/Community Supports work only — not routed
  through Full Circle Health Net at all.
- Kaiser Medi-Cal, Molina, Blue Shield, and LA Health Net, billed
  through **Full Circle Health Net (FCHN)** as the intermediary.
- Molina, though nominally under the FCHN contract, appears to actually
  require NMBM to self-bill — which NMBM themselves flagged as still
  unclear on their end.

FCHN is a billing channel for *some* payers, not a payer itself, and at
least one payer under it may not really follow that path. Don't model
`funding_sources` as one payer = one channel when this module gets
built. R8 confirmed the same fragmentation from the submission side:
Kaiser ILS, Medicare, Medi-Cal, and Molina each have their own file
format or portal; the rest go through FCHN's Exym instead.

This is real eligibility checking, code lookup, encounter recording, and
payer-specific batch export, times at least four channels — and **M23
(each channel's required layout, and what happens on a rejected line) is
still unanswered and is still the one item that swings the estimate
most**, more so now that it's confirmed to be plural, not singular.
Nothing beyond a schema placeholder should be built here until M23 comes
back.

**Automated prompts that don't exist in WSL, described specifically by
NMBM.** Three of the four below are now built; the fourth (M12) isn't.

- **Built.** 3 consecutive no-contact attempts → prompt to prepare exit
  documentation, and the CHW needs 2 more non-contacts before
  disenrollment is allowed (M6). For Molina clients specifically, the
  3rd attempt also triggers a required disenrollment-warning letter.
  This is a stricter, state-specific version of WSL's no-contact
  counter/flag, not a new concept — same `v_no_contact_counts`-style
  view, plus a payer-conditional letter template and a hard gate on the
  disenrollment action itself.
- **Built.** 30-day care-plan-completion countdown from enrollment, then a nudge
  every 2 weeks while services are ongoing, then a close-out prompt at
  exit (M9). WSL has review clocks on existing plans; NMBM additionally
  wants a *completion* deadline from enrollment, which is a new clock
  type, not a variant of the existing one.
- **Not built.** Follow-up QA calls at 3/5/9/12 months **after
  disenrollment** (M12),
  potentially leading to re-enrollment. This is a participant lifecycle
  state WSL doesn't have — closed-but-being-followed-up — and needs its
  own status rather than overloading "closed."
- **Built.** Disenrollment **immediately** moves a participant out of
  the active caseload view (R10) — not a batch job, not eventual, so
  "who's active right now" is never stale. Closing an episode ends the
  assignment in the same transaction; the caseload and dashboard only
  count people with an open episode; closed records are listed
  separately and stay fully retrievable, with readmission opening a
  fresh episode. See `docs/agent/invariants.md`.

**Smaller-scale, but not smaller-complexity.** 10 total users (U8) means
the permission *grid* still needs to be right (U2–U7 describe real
sign-off chains — Clinical Director approves CHW care plans and APCC/ACSW
notes; Program Manager or CHW supervisor approves CHW notes), but there's
no multi-department scale problem to design around. Build the same
role/permission engine as WSL, seeded with NMBM's roles instead of WSL's.

**No housing module (yet).** M24 is "not yet, future." No tables, no
module — build when it's actually asked for, not preemptively (WSL's own
hard rule 001 applies here too: don't build for hypothetical
requirements).

**Kiosk / self-serve intake matches WSL directly, but isn't built.** M13
— NMBM already
sends the comprehensive needs assessment by email/text and fills it on
tablets. This is the same participant-facing kiosk pattern WSL built:
outside the staff app, one form, no other participant's record visible,
self-locking.

## Data model note

M1 is unresolved in the discovery doc itself ("Clients and we can call
them cases — are there any thoughts to this ladies?"). The schema uses
`participants` as the table name (internal, matches WSL) and leaves the
**user-facing label** ("Client" vs "Case") as a single string constant
in `@nmbm/shared` so it can be changed without a migration once NMBM
picks one. Still unpicked; the constant is currently "Client", so
that is what every page reads.

## What is built

Everything below is running code: a migration, a module, and in most
cases a page reachable after signing in. Current as of migration `0005`.

| Area | What works | Where |
|---|---|---|
| Sign-in (M27) | Google OIDC against a named Workspace domain with a one-use `state` token, a fresh session id at sign-in, an idle timeout and a hard ceiling, audited sign-in and sign-out; a login page that says why a sign-in was refused and what to do next; a holding page for accounts with no role; sign-out in the header. Dev login is double-gated behind `NODE_ENV !== "production"` and `ALLOW_DEV_LOGIN` | `plugins/auth.ts`, `pages/login-page.tsx`, `docs/GOOGLE_SETUP.md` |
| Authorization | Permission codes, never role names, read from the database at request time | `plugins/authorize.ts`, `packages/shared/src/permissions.ts` |
| Caseload (U5) | A front-line worker's list, dashboard and participant record are scoped server-side to their own assignments | `lib/caseload.ts` |
| Participants and intake (M3/M4/R10) | Admission opens the record, the episode and the assignment in one transaction; reassignment; assignable-worker list. The list is active people only; closed records are a separate list for those who can read all | `modules/participants/` |
| Episodes (M2/M6/R10) | Close — which ends the assignment — and readmission, which opens a new linked episode with a named worker. The payer-conditional disenrolment-warning letter gate | `modules/episodes/` |
| Notes and the no-contact ladder (M6/U6) | Write, submit, approve, return for revision, revise and resubmit; three consecutive failed contacts prompt exit documentation and two more are required before disenrolment is allowed | `modules/notes/`, `lib/rules.ts` |
| Care plans (M9/U6) | Authoring, goals, submit, approve, return; the 30-day completion clock and the 2-week review nudge derived side by side | `modules/care-plans/`, `lib/rules.ts` |
| Consents (M15/M16) | Four form types, expiry derived at read time from the episode start date, revocation | `modules/consents/` |
| Referrals (M17) | Refuses to send without a usable release and distinguishes the three reasons; records the outcome that came back | `modules/referrals/` |
| Programmes and attendance (M14) | Programmes, cohorts, class dates, rosters, whole-roster marking in one request, and a printable participation record | `modules/programs/` |
| Staff administration (U9) | Grant and revoke roles, deactivate and reactivate — refused while a worker still holds open assignments | `modules/admin/` |
| Audit (M30) | Append-only, written inside the transaction that performs the action, read-only endpoint | `plugins/audit.ts` |
| Feedback (M31) | In-app issue reporting and a triage queue, because NMBM has no IT staff | `modules/feedback/`, `docs/SUPPORT.md` |

48 API routes across 12 modules, 21 tables and one view, 13 pages plus
two holding screens (no role yet; server unreachable).
`docs/agent/map.md` lists them route by route and page by page.

Two properties hold across all of it: state a person could be wrong
about is **derived at read time** rather than stored (consent expiry,
the no-contact run, the participation outcome), and every consequential
action writes an audit line inside the transaction that performs it.

## What is not built

Two different reasons, and they shouldn't be reported as one number.

**Blocked on an answer from NMBM:**

- **Billing and claims (M22/M23).** Schema placeholder only
  (`funding_sources`, `services`). Confirmed to be at least four
  submission channels rather than one, and neither the file layouts nor
  the rejection-handling process have arrived. Still the largest single
  scope driver in the discovery document; hard rule 7 in `CLAUDE.md`
  exists to stop this being guessed at.
- **Reporting and exports (R7/R8/M25).** The FCHN KPI spec was promised
  and hasn't been delivered. A report builder written against a guessed
  field list would be rewritten, not adjusted.
- **42 CFR Part 2 handling (R5).** Confirmed real and near-term, but it
  needs its own consent and re-disclosure rules rather than a flag on
  the existing ones, and its timing depends on the LA County DV
  approval.
- **Housing (M24).** "Not yet, future."

**Not blocked — ours to do:**

- **Sessions live in process memory.** Fine on one machine; on Cloud
  Run every restart signs everybody out, and two instances don't share
  sessions, so a person would be bounced between signed in and signed
  out. Needs a shared store (a Postgres table is enough at this size)
  before the first deploy, not after.
- **There are no tests.** Not one file. `npm test` runs vitest in
  `@nmbm/api` and finds nothing to run; CI builds and typechecks and
  stops there. Hard rule 8 in `CLAUDE.md` describes how to prove a test
  works, and there is not yet a suite for it to apply to. The rules
  worth covering first are the ones where being wrong is a harm rather
  than a bug: the referral release gate, consent expiry, the M6 ladder,
  caseload scoping, and the participation outcome. Three defects in that
  list were found only by driving the app by hand as more than one role
  — an authorization hook that let handlers run before the permission
  check resolved, `participants.read.all` failing to imply
  `participants.read.own`, and a participation verdict that called
  perfect attendance a failure. None would have survived a test.
- **There is no deployment.** No `Dockerfile`, no `cloudbuild.yaml`, and
  no GCP project, Cloud SQL instance or Secret Manager entry has been
  created. `docs/GOOGLE_SETUP.md` has the ordering for when that starts.
- **Assessments (M13).** The comprehensive needs assessment is sent by
  email and filled in on tablets today. A versioned assessment engine
  and the participant-facing kiosk are two real modules, neither begun.
- **Exym migration (M27-M29).** Needs an export or a screenshot of the
  current system first — item 5 on the next-meeting list in
  `docs/DISCOVERY_FOLLOWUP.md`.

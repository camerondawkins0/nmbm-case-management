# Architecture — NMBM Case Management

Status: **scoping draft**, written from the discovery document plus NMBM's
follow-up reply on compliance. The BAA is signed (see below), so hosting
can proceed; D2/D3 (budget, timeline) and M23 (billing) still aren't
closed — see `docs/DISCOVERY_FOLLOWUP.md` for current status on every
item.

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
NMBM:**

- 3 consecutive no-contact attempts → prompt to prepare exit
  documentation, and the CHW needs 2 more non-contacts before
  disenrollment is allowed (M6). For Molina clients specifically, the
  3rd attempt also triggers a required disenrollment-warning letter.
  This is a stricter, state-specific version of WSL's no-contact
  counter/flag, not a new concept — same `v_no_contact_counts`-style
  view, plus a payer-conditional letter template and a hard gate on the
  disenrollment action itself.
- 30-day care-plan-completion countdown from enrollment, then a nudge
  every 2 weeks while services are ongoing, then a close-out prompt at
  exit (M9). WSL has review clocks on existing plans; NMBM additionally
  wants a *completion* deadline from enrollment, which is a new clock
  type, not a variant of the existing one.
- Follow-up QA calls at 3/5/9/12 months **after disenrollment** (M12),
  potentially leading to re-enrollment. This is a participant lifecycle
  state WSL doesn't have — closed-but-being-followed-up — and needs its
  own status rather than overloading "closed."
- Disenrollment **immediately** moves a participant out of the active
  caseload view (R10) — not a batch job, not eventual, so "who's active
  right now" is never stale. The record itself stays fully retrievable
  (a returning participant, or a contractor/grantor request) — this is
  about default query scope, not access. See
  `docs/agent/invariants.md`.

**Smaller-scale, but not smaller-complexity.** 10 total users (U8) means
the permission *grid* still needs to be right (U2–U7 describe real
sign-off chains — Clinical Director approves CHW care plans and APCC/ACSW
notes; Program Manager or CHW supervisor approves CHW notes), but there's
no multi-department scale problem to design around. Build the same
role/permission engine as WSL, seeded with NMBM's roles instead of WSL's.

**No housing module (yet).** M24 is "not yet, future." Schema is scaffolded
with a placeholder domain but no tables — build when it's actually asked
for, not preemptively (WSL's own hard rule 001 applies here too: don't
build for hypothetical requirements).

**Kiosk / self-serve intake matches WSL directly.** M13 — NMBM already
sends the comprehensive needs assessment by email/text and fills it on
tablets. This is the same participant-facing kiosk pattern WSL built:
outside the staff app, one form, no other participant's record visible,
self-locking.

## Data model note

M1 is unresolved in the discovery doc itself ("Clients and we can call
them cases — are there any thoughts to this ladies?"). The schema in this
scaffold uses `participants` as the table name (internal, matches WSL) and
leaves the **user-facing label** ("Client" vs "Case") as a single string
constant in `@nmbm/shared` so it can be changed without a migration once
NMBM picks one.

## Explicitly not started

Per the scope selected for this scaffold: billing/claims, housing, full
assessment scoring engine, reporting/export builder, and the
migration-from-Exym importer are schema-stubbed at most, not built. Each
is a real module on the scale of one of WSL's 22 (`docs/agent/map.md`
lists them) and should be scoped individually once Part 3 and Part 4 of
discovery close.

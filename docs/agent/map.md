# Map

Where things are. Current as of migration `0012`.

## Packages

| Package | Holds | Consumed as |
|---|---|---|
| `@nmbm/shared` | Zod schemas, enums, permission codes, role seed data | `dist` |
| `@nmbm/db` | Drizzle schema, migrations, `migrate.ts`, seeds | `dist` |
| `@nmbm/api` | Fastify server, plugins, modules | runtime |
| `@nmbm/web` | React SPA | static build |

Dependency direction: `web` and `api` both depend on `shared`; `api`
depends on `db`; `db` depends on `shared`. Nothing depends on `web`.

## API module layout

`packages/api/src/modules/<area>/` holds up to three files:

- `routes.ts` — parse with Zod, `authorize()`, delegate. Never touches Drizzle.
- `service.ts` — rules and transactions. Never touches HTTP objects.
- `repository.ts` — Drizzle queries. Never holds a rule.

`repository.ts` is the one that's optional, and four modules don't have
one: `consents`, `referrals`, `programs` and `admin` query Drizzle from
the service directly. The split earns its keep when the same query is
reached from several rules, or is awkward enough to want a name; an
empty indirection layer added to satisfy the pattern would make those
files harder to read, not easier. The rule that is not optional runs the
other way — a `routes.ts` never touches Drizzle.

Two modules split their service layer where one file would have grown
unwieldy: `participants/intake.ts` (admission and reassignment, both
transactional) and `notes/review.ts` (the U6 approval chain). `admin`
splits out `audit.ts` for the same reason.

## API routes

80 routes across 15 modules, plus five on the auth plugin and two on the
local storage stand-in. Every route outside `PUBLIC_BY_DESIGN` carries
an `authorize()` or `authorizeAny()` preHandler, and the permission it
requires is named in the file. `test/routes-authorized.test.ts` reads
the source and fails on any route that has neither — see testing.md.

| Module | Routes |
|---|---|
| `health` | `GET /api/health` — PUBLIC_BY_DESIGN, Cloud Run health check |
| `me` | `GET /api/me` — PUBLIC_BY_DESIGN, answers "is anyone signed in?" |
| `participants` | `GET /api/participants` (`?status=closed` for former participants — R10), `GET /api/participants/search?q=&dob=`, `GET /api/participants/:id`, `GET /api/participants/assignable-workers`, `POST /api/participants`, `POST /api/participants/intake`, `POST /api/participants/:id/assignment` |
| `episodes` | `POST /api/episodes` (readmission — see invariants, R10), `POST /api/episodes/:id/close`, `POST /api/episodes/:id/disenrollment-letter` |
| `notes` | `POST /api/notes`, `PATCH /api/notes/:id`, `GET /api/notes/awaiting-review`, `GET /api/notes/returned`, `POST /api/notes/:id/approve`, `POST /api/notes/:id/return` |
| `care-plans` | `POST /api/care-plans`, `PATCH /api/care-plans/:id`, `POST /api/care-plans/:id/submit`, `GET /api/care-plans/awaiting-review`, `POST /api/care-plans/:id/approve`, `POST /api/care-plans/:id/return` |
| `consents` | `POST /api/consents`, `POST /api/consents/:id/revoke` |
| `referrals` | `POST /api/referrals`, `POST /api/referrals/:id/outcome` |
| `programs` | `GET /api/programs`, `POST /api/programs`, `POST /api/cohorts`, `GET /api/cohorts/:id`, `POST /api/cohorts/:id/sessions`, `POST /api/cohorts/:id/enrollments`, `POST /api/enrollments/:id/withdraw`, `POST /api/sessions/:id/attendance`, `GET /api/enrollments/:id/participation` |
| `assessments` | Forms: `GET /api/assessment-forms`, `POST /api/assessment-forms`, `GET /api/assessment-forms/:id`, `POST /api/assessment-forms/:id/drafts`, `POST /api/assessment-forms/:id/active`, `GET /api/assessment-versions/:id`, `PUT /api/assessment-versions/:id/questions` (draft only), `POST /api/assessment-versions/:id/publish`. On a record: `GET /api/participants/:id/assessments`, `POST /api/participants/:id/assessments`, `GET /api/assessments/:id`, `PATCH /api/assessments/:id/answers`, `POST /api/assessments/:id/complete`, `POST /api/assessments/:id/void`. The participant's link: `POST /api/participants/:id/assessment-links` (make one), `POST /api/assessments/:id/link` (replace it), `POST /api/assessments/:id/link/revoke`; and, public by design in `self-serve-routes.ts`, `POST /api/self-serve/:token/unlock`, `GET /api/self-serve/:token`, `PATCH /api/self-serve/:token/answers`, `POST /api/self-serve/:token/submit` |
| `documents` | `GET /api/participants/:id/documents`, `POST /api/participants/:id/documents` (returns a signed upload link), `POST /api/documents/:id/confirm`, `GET /api/documents/:id/download-url`, `POST /api/documents/:id/void` |
| `follow-ups` | `GET /api/follow-ups` (QA's queue), `POST /api/follow-ups` (record a call), `GET /api/follow-ups/re-enrollment-requests` |
| `dashboard` | `GET /api/dashboard` |
| `admin` | `GET /api/admin/users`, `GET /api/admin/roles`, `POST /api/admin/users/:id/roles`, `DELETE /api/admin/users/:id/roles/:roleCode`, `POST /api/admin/users/:id/deactivate`, `POST /api/admin/users/:id/reactivate`, `GET /api/admin/audit`, `GET /api/admin/settings`, `PUT /api/admin/settings/:key` |
| `feedback` | `POST /api/feedback`, `GET /api/feedback/mine`, `GET /api/feedback`, `PATCH /api/feedback/:id/status` |
| `plugins/auth.ts` | `GET /auth/google/login`, `GET /auth/google/callback`, `POST /auth/logout`, and in non-production with `ALLOW_DEV_LOGIN` only: `GET /auth/dev-login`, `GET /auth/dev-login/accounts` |
| `lib/storage.ts` | `PUT /api/local-storage/*`, `GET /api/local-storage/*` — registered only when there's no `DOCUMENTS_BUCKET` (development and tests); a signed query string is the gate |

Consents and referrals have no list endpoint of their own. Both are read
through `GET /api/participants/:id`, because neither is ever looked at
except in the context of one person's record.

## API libs

| File | What it is |
|---|---|
| `lib/caseload.ts` | `resolveScope`, `caseloadParticipantIds`, `formerCaseload`, `canSeeParticipant` — U5 scoping and R10's closed-record access |
| `lib/rules.ts` | The M6 no-contact ladder and M9 care plan clocks, derived in one place |
| `lib/follow-ups.ts` | `followUpSchedule`, `addMonths` — M12's schedule, derived from an episode's end date |
| `lib/storage.ts` | `StorageProvider`: `GcsStorageProvider` (signed V4 links, size range in the signature) or `LocalStorageProvider` (HMAC-signed stand-in); `opaqueKey`, `createStorageProvider` |
| `lib/csv.ts` | `csvCell`, `toCsv` — RFC 4180 quoting plus the formula-injection guard. Any CSV export goes through this |
| `lib/settings.ts` | `getSetting`, `listSettings`, `updateSetting` — admin-changeable values, declared with defaults and bounds in `@nmbm/shared` (`APP_SETTINGS`) |

## API plugins

| File | What it is |
|---|---|
| `plugins/auth.ts` | Google OIDC (Workspace SSO) with `state`, session regeneration, idle timeout, `safeReturnTo`, sign-in audit, dev login |
| `plugins/authorize.ts` | `authorize(code)`, `authorizeAny([...])`, `CAN_READ_PARTICIPANTS`, `getPermissions` |
| `plugins/session-store.ts` | `PostgresSessionStore` — sessions shared across instances, keyed by a hash of the id |
| `plugins/web-app.ts` | Serves the web build (with the app's routes falling back to `index.html`) and sets the security headers |
| `plugins/audit.ts` | `writeAudit(db, entry)` — append-only |
| `plugins/errors.ts` | `AppError` plus `badRequest`/`notFound`/`conflict`/`forbidden`/`unprocessable`, and `registerErrorHandler` |

`authorizeAny` exists because `participants.read.all` does not imply
`participants.read.own`. A route that accepts either takes
`CAN_READ_PARTICIPANTS` rather than naming one — getting this wrong
locked the Clinical Director out of the caseload entirely.

## Web pages

`packages/web/src/pages/`, routed in `App.tsx`. Everything below the
first is behind the session check.

| Path | Page | What it's for |
|---|---|---|
| `/f/:token` | `self-serve-page.tsx` | A participant's own form: passcode, then one form. Routed before the session check in `App.tsx` and uses its own fetch, never `lib/api.ts` |
| `/login` | `login-page.tsx` | Google sign-in, the reason for any refusal (`?error=` codes from `SIGN_IN_ERRORS` in `@nmbm/shared`), and the dev sign-in panel when the server offers it |
| — | `holding-pages.tsx` | Shown instead of the app: signed in with no role yet, or the server can't be reached |
| `/` | `dashboard-page.tsx` | What needs attention: care plan clocks, the no-contact ladder, notes awaiting review, referrals with no outcome |
| `/participants` | `participants-page.tsx` | Caseload list, scoped server-side; a Closed tab (everything, for intake and supervisors) or Recently closed (a worker's own former clients, with the date access ends) |
| `/participants/new` | `intake-page.tsx` | Admission — record, episode and assignment in one act |
| `/participants/:id` | `participant-detail-page.tsx` | The record: flags, notes, care plan, consents, forms and assessments, documents, referrals, episode history; on a closed record, readmission |
| `/assessments/:id` | `assessment-page.tsx` | Filling in a form (saves as you go, follow-ups appear as earlier answers are given), or reading and printing a completed one |
| `/notes/review` | `note-review-page.tsx` | The U6 queue — approve, or return with a reason |
| `/care-plans/review` | `care-plan-review-page.tsx` | The same, for care plans |
| `/programs` | `programs-page.tsx` | Programmes and their cohorts |
| `/follow-ups` | `follow-ups-page.tsx` | M12: QA's call queue, and who asked to come back (intake sees only the latter) |
| `/cohorts/:id` | `cohort-page.tsx` | The M14 grid — sessions across, people down — and the take-attendance panel; flags anyone whose NMBM services have ended |
| `/enrollments/:id/participation` | `participation-record-page.tsx` | The printable proof a probation officer receives |
| `/admin/users` | `admin/users-page.tsx` | Staff, roles, deactivation |
| `/admin/settings` | `admin/settings-page.tsx` | Settings NMBM change themselves (the former-worker window) |
| `/feedback` | `feedback-page.tsx` | Report an issue |
| `/admin/forms` | `admin/forms-page.tsx` | NMBM's forms: which exist, which version is live |
| `/admin/forms/:id` | `admin/form-builder-page.tsx` | Build a draft — questions, options, sections, show-if rules — preview it, publish it; past versions read-only |
| `/admin/feedback` | `admin/feedback-admin-page.tsx` | The triage queue |

Shared components in `packages/web/src/components/`: `app-shell.tsx`
(header and navigation, which hides what the signed-in user cannot
reach), `sign-out-button.tsx`, `brand-mark.tsx`, `flags.tsx` (the attention badges derived in
`lib/rules.ts`), and the five sections the participant record composes
— `care-plan-section.tsx`, `consents-section.tsx`,
`assessments-section.tsx`, `documents-section.tsx`, `referrals-section.tsx`.
`question-field.tsx` renders one question, the same way for the
staff page, the builder's preview and the participant's link.
`participant-link.tsx` shows a new link and passcode once, and a
link's state with its replace and withdraw actions.

`lib/use-me.ts` tells signed out, session expired and server
unreachable apart; `lib/api.ts` handles a session ending mid-page;
`lib/labels.ts` holds display labels shared across pages.
`components/participant-search.tsx` is the search used on the Clients
page and the intake form; `components/follow-up-call-form.tsx` records a
call from the queue or the record.

Hiding a nav link is a convenience, never the control. Every page here
is behind a server-side permission check on the endpoints it calls.

## Database

`packages/db/src/schema/*.ts`, one file per domain area, mirroring the
module layout. `enums.ts` wraps `as const` arrays from `@nmbm/shared` in
`pgEnum`, so an enum is declared once and used in both places — same
convention as the WSL system this was adapted from.

30 tables and one view:

| File | Tables |
|---|---|
| `users.ts` | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `audit_log` |
| `participants.ts` | `participants`, `assignments` |
| `episodes.ts` | `episodes` |
| `notes.ts` | `notes` |
| `care-plans.ts` | `care_plans` |
| `consents.ts` | `consents` |
| `referrals.ts` | `referrals` |
| `programs.ts` | `programs`, `program_cohorts`, `cohort_sessions`, `cohort_enrollments`, `session_attendance` |
| `funding.ts` | `funding_sources`, `services` — the M23 placeholder, deliberately unbuilt |
| `feedback.ts` | `feedback_items` |
| `settings.ts` | `app_settings` — one row per setting somebody has changed |
| `follow-ups.ts` | `follow_up_calls` — one row per call attempt; the schedule isn't stored |
| `assessments.ts` | `assessment_forms`, `assessment_form_versions`, `assessment_questions`, `assessments`, `assessment_links` (hashes only) — answers are a jsonb map keyed by each question's stable id |
| `documents.ts` | `documents` — uploaded files; the bytes are in Cloud Storage under an opaque key |
| `sessions.ts` | `sessions` — sign-in sessions, keyed by a hash of the session id |
| `views.ts` | `v_no_contact_counts` (rebuilt per episode in 0006), declared to Drizzle with `.existing()` |

Migrations are hand-written SQL in `packages/db/src/migrations/`, listed
in order in `meta/_journal.json`:

| Migration | Adds |
|---|---|
| `0000_init` | Users, roles, permissions, participants, episodes, notes, funding placeholders |
| `0001_add_feedback` | `feedback_items` |
| `0002_case_management_rules` | Care plans, assignments, audit log, `v_no_contact_counts` |
| `0003_note_review` | The U6 review columns on notes and care plans |
| `0004_referrals_and_consents` | `consents`, `referrals` |
| `0005_programs_and_attendance` | The five programme and attendance tables |
| `0006_episode_scoped_caseload` | One open episode per participant; repair of assignments left open on closed episodes; `v_no_contact_counts` rebuilt per episode |
| `0007_app_settings` | `app_settings` |
| `0008_follow_up_calls` | `follow_up_calls`, one settling result per milestone, search indexes on participants |
| `0009_sessions` | `sessions` |
| `0010_documents` | `documents`, `document_status` enum |
| `0011_assessments` | The four form and assessment tables; one draft per form |
| `0012_assessment_links` | `assessment_links`, one live link per assessment; `audit_log.actor_user_id` nullable for things a participant did |

## Seeds

`packages/db/src/seed/`.

- `reference.ts` is **required**. It writes the roles, permissions and
  grants that `authorize()` reads, and without it every authenticated
  route returns 403 — which presents as a broken login rather than as
  missing data. It also revokes grants the code no longer intends, so
  removing a permission from `DEFAULT_ROLE_PERMISSIONS` actually takes
  it away instead of leaving it granted forever.
- `synthetic.ts` is invented demo data: staff at `@nmbm.example.org`,
  twelve participants whose fixtures each exercise one rule (Irene
  Walsh is the disenrolled one, for R10; Price, Liu and Moreno show
  M12's overdue, due and asked-to-come-back states), and a
  running Anger Management cohort with six weekly sessions and three
  deliberately different attendance histories, and an invented "Example
  needs assessment" with two follow-up rules. Nothing in it is real.

## Deployment

`Dockerfile`, `cloudbuild.yaml` and `deploy/setup-gcp.sh` at the root;
`packages/db/src/release.ts` is the release job (migrate, then roles and
grants) and `packages/db/src/grant-role.ts` bootstraps the first
administrator. `packages/db/src/client.ts` is where the Cloud SQL socket
is handled. How it all fits: `docs/DEPLOY.md`.

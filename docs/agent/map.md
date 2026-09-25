# Map

Where things are. Current as of migration `0007`.

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

50 routes across 12 modules, plus five on the auth plugin. Every route
outside `PUBLIC_BY_DESIGN` carries an `authorize()` or `authorizeAny()`
preHandler, and the permission it requires is named in the file.

| Module | Routes |
|---|---|
| `health` | `GET /api/health` — PUBLIC_BY_DESIGN, Cloud Run health check |
| `me` | `GET /api/me` — PUBLIC_BY_DESIGN, answers "is anyone signed in?" |
| `participants` | `GET /api/participants` (`?status=closed` for former participants — R10), `GET /api/participants/:id`, `GET /api/participants/assignable-workers`, `POST /api/participants`, `POST /api/participants/intake`, `POST /api/participants/:id/assignment` |
| `episodes` | `POST /api/episodes` (readmission — see invariants, R10), `POST /api/episodes/:id/close`, `POST /api/episodes/:id/disenrollment-letter` |
| `notes` | `POST /api/notes`, `PATCH /api/notes/:id`, `GET /api/notes/awaiting-review`, `GET /api/notes/returned`, `POST /api/notes/:id/approve`, `POST /api/notes/:id/return` |
| `care-plans` | `POST /api/care-plans`, `PATCH /api/care-plans/:id`, `POST /api/care-plans/:id/submit`, `GET /api/care-plans/awaiting-review`, `POST /api/care-plans/:id/approve`, `POST /api/care-plans/:id/return` |
| `consents` | `POST /api/consents`, `POST /api/consents/:id/revoke` |
| `referrals` | `POST /api/referrals`, `POST /api/referrals/:id/outcome` |
| `programs` | `GET /api/programs`, `POST /api/programs`, `POST /api/cohorts`, `GET /api/cohorts/:id`, `POST /api/cohorts/:id/sessions`, `POST /api/cohorts/:id/enrollments`, `POST /api/enrollments/:id/withdraw`, `POST /api/sessions/:id/attendance`, `GET /api/enrollments/:id/participation` |
| `dashboard` | `GET /api/dashboard` |
| `admin` | `GET /api/admin/users`, `GET /api/admin/roles`, `POST /api/admin/users/:id/roles`, `DELETE /api/admin/users/:id/roles/:roleCode`, `POST /api/admin/users/:id/deactivate`, `POST /api/admin/users/:id/reactivate`, `GET /api/admin/audit`, `GET /api/admin/settings`, `PUT /api/admin/settings/:key` |
| `feedback` | `POST /api/feedback`, `GET /api/feedback/mine`, `GET /api/feedback`, `PATCH /api/feedback/:id/status` |
| `plugins/auth.ts` | `GET /auth/google/login`, `GET /auth/google/callback`, `POST /auth/logout`, and in non-production with `ALLOW_DEV_LOGIN` only: `GET /auth/dev-login`, `GET /auth/dev-login/accounts` |

Consents and referrals have no list endpoint of their own. Both are read
through `GET /api/participants/:id`, because neither is ever looked at
except in the context of one person's record.

## API libs

| File | What it is |
|---|---|
| `lib/caseload.ts` | `resolveScope`, `caseloadParticipantIds`, `formerCaseload`, `canSeeParticipant` — U5 scoping and R10's closed-record access |
| `lib/rules.ts` | The M6 no-contact ladder and M9 care plan clocks, derived in one place |
| `lib/settings.ts` | `getSetting`, `listSettings`, `updateSetting` — admin-changeable values, declared with defaults and bounds in `@nmbm/shared` (`APP_SETTINGS`) |

## API plugins

| File | What it is |
|---|---|
| `plugins/auth.ts` | Google OIDC (Workspace SSO) with `state`, session regeneration, idle timeout, `safeReturnTo`, sign-in audit, dev login |
| `plugins/authorize.ts` | `authorize(code)`, `authorizeAny([...])`, `CAN_READ_PARTICIPANTS`, `getPermissions` |
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
| `/login` | `login-page.tsx` | Google sign-in, the reason for any refusal (`?error=` codes from `SIGN_IN_ERRORS` in `@nmbm/shared`), and the dev sign-in panel when the server offers it |
| — | `holding-pages.tsx` | Shown instead of the app: signed in with no role yet, or the server can't be reached |
| `/` | `dashboard-page.tsx` | What needs attention: care plan clocks, the no-contact ladder, notes awaiting review, referrals with no outcome |
| `/participants` | `participants-page.tsx` | Caseload list, scoped server-side; a Closed tab (everything, for intake and supervisors) or Recently closed (a worker's own former clients, with the date access ends) |
| `/participants/new` | `intake-page.tsx` | Admission — record, episode and assignment in one act |
| `/participants/:id` | `participant-detail-page.tsx` | The record: flags, notes, care plan, consents, referrals, episode history; on a closed record, readmission |
| `/notes/review` | `note-review-page.tsx` | The U6 queue — approve, or return with a reason |
| `/care-plans/review` | `care-plan-review-page.tsx` | The same, for care plans |
| `/programs` | `programs-page.tsx` | Programmes and their cohorts |
| `/cohorts/:id` | `cohort-page.tsx` | The M14 grid — sessions across, people down — and the take-attendance panel; flags anyone whose NMBM services have ended |
| `/enrollments/:id/participation` | `participation-record-page.tsx` | The printable proof a probation officer receives |
| `/admin/users` | `admin/users-page.tsx` | Staff, roles, deactivation |
| `/admin/settings` | `admin/settings-page.tsx` | Settings NMBM change themselves (the former-worker window) |
| `/feedback` | `feedback-page.tsx` | Report an issue |
| `/admin/feedback` | `admin/feedback-admin-page.tsx` | The triage queue |

Shared components in `packages/web/src/components/`: `app-shell.tsx`
(header and navigation, which hides what the signed-in user cannot
reach), `sign-out-button.tsx`, `brand-mark.tsx`, `flags.tsx` (the attention badges derived in
`lib/rules.ts`), and the three sections the participant record composes
— `care-plan-section.tsx`, `consents-section.tsx`,
`referrals-section.tsx`.

`lib/use-me.ts` tells signed out, session expired and server
unreachable apart; `lib/api.ts` handles a session ending mid-page;
`lib/labels.ts` holds display labels shared across pages.

Hiding a nav link is a convenience, never the control. Every page here
is behind a server-side permission check on the endpoints it calls.

## Database

`packages/db/src/schema/*.ts`, one file per domain area, mirroring the
module layout. `enums.ts` wraps `as const` arrays from `@nmbm/shared` in
`pgEnum`, so an enum is declared once and used in both places — same
convention as the WSL system this was adapted from.

22 tables and one view:

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

## Seeds

`packages/db/src/seed/`.

- `reference.ts` is **required**. It writes the roles, permissions and
  grants that `authorize()` reads, and without it every authenticated
  route returns 403 — which presents as a broken login rather than as
  missing data. It also revokes grants the code no longer intends, so
  removing a permission from `DEFAULT_ROLE_PERMISSIONS` actually takes
  it away instead of leaving it granted forever.
- `synthetic.ts` is invented demo data: staff at `@nmbm.example.org`,
  nine participants whose fixtures each exercise one rule (Irene Walsh
  is the disenrolled one, for R10), and a
  running Anger Management cohort with six weekly sessions and three
  deliberately different attendance histories. Nothing in it is real.

## Not in this repo yet

No tests, no `Dockerfile`, no `cloudbuild.yaml`. CI builds and
typechecks and stops. See "What is not built" in
`docs/ARCHITECTURE.md`.

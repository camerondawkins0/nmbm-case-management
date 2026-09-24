# Map

## Packages

| Package | Holds | Consumed as |
|---|---|---|
| `@nmbm/shared` | Zod schemas, enums, permission codes, role seed data | `dist` |
| `@nmbm/db` | Drizzle schema, migrations, `migrate.ts` | `dist` |
| `@nmbm/api` | Fastify server, plugins, modules | runtime |
| `@nmbm/web` | React SPA | static build |

Dependency direction: `web` and `api` both depend on `shared`; `api`
depends on `db`; `db` depends on `shared`. Nothing depends on `web`.

## API module layout

`packages/api/src/modules/<area>/` holds three files:

- `routes.ts` — parse with Zod, `authorize()`, delegate. Never touches Drizzle.
- `service.ts` — rules and transactions. Never touches HTTP objects.
- `repository.ts` — Drizzle queries. Never holds a rule.

Built so far: `health`, `me`, `participants` (list, record, intake,
assignment), `episodes`, `notes` (write + review), `care-plans`,
`dashboard`, `consents`, `referrals`, `programs` (cohorts, rosters,
attendance), `admin` (staff, roles, audit),
`feedback` (see `docs/SUPPORT.md` for that one). Everything else in
`docs/ARCHITECTURE.md`'s "explicitly not started" list gets a module
directory the same shape when it's built.

Two modules split their service layer where one file would have grown
unwieldy: `participants/intake.ts` (admission and reassignment, both
transactional) and `notes/review.ts` (the U6 approval chain).

## API libs

| File | What it is |
|---|---|
| `lib/caseload.ts` | `resolveScope`, `caseloadParticipantIds`, `canSeeParticipant` — U5 scoping |
| `lib/rules.ts` | The M6 no-contact ladder and M9 care plan clocks, derived in one place |

## API plugins

| File | What it is |
|---|---|
| `plugins/auth.ts` | Google OIDC (Workspace SSO), sessions, `requireUser` |
| `plugins/authorize.ts` | `authorize(code)`, `authorizeAny([...])`, `CAN_READ_PARTICIPANTS`, `getPermissions` |
| `plugins/audit.ts` | `writeAudit(db, entry)` — append-only |
| `plugins/errors.ts` | `AppError` plus `badRequest`/`notFound`/`conflict`/`forbidden`/`unprocessable`, and `registerErrorHandler` |

## Database

`packages/db/src/schema/*.ts`. One file per domain area, mirroring the
module layout above. `enums.ts` wraps `as const` arrays from
`@nmbm/shared` in `pgEnum`, so an enum is declared once and used in both
places — same convention as the WSL system this was adapted from.

Migrations are hand-written SQL in `packages/db/src/migrations/`, listed
in order in `meta/_journal.json`. `v_no_contact_counts` (migration 0002)
derives the consecutive failed-contact run per participant; it's declared
to Drizzle in `schema/views.ts` with `.existing()`.

Seeds live in `packages/db/src/seed/`. `reference.ts` is required — it
writes the roles, permissions and grants that `authorize()` reads, and
without it every route 403s. `synthetic.ts` is invented demo data whose
fixtures are shaped to exercise each rule.

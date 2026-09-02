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

Scaffolded so far: `health`, `participants`, `episodes`, `feedback` (see
`docs/SUPPORT.md` for what that one's for). Everything else in
`docs/ARCHITECTURE.md`'s "explicitly not started" list gets a module
directory the same shape when it's built.

## API plugins

| File | What it is |
|---|---|
| `plugins/auth.ts` | Google OIDC (Workspace SSO), sessions, `requireUser` |
| `plugins/authorize.ts` | `authorize(code)` preHandler, checks the caller's permission codes |
| `plugins/audit.ts` | `writeAudit(db, entry)` — append-only |
| `plugins/errors.ts` | `AppError` plus `badRequest`/`notFound`/`conflict`/`forbidden` |

## Database

`packages/db/src/schema/*.ts`. One file per domain area, mirroring the
module layout above. `enums.ts` wraps `as const` arrays from
`@nmbm/shared` in `pgEnum`, so an enum is declared once and used in both
places — same convention as the WSL system this was adapted from.

Migrations are hand-written SQL in `packages/db/src/migrations/`, listed
in order in `meta/_journal.json`.

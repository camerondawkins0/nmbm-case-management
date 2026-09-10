# NMBM Case Management

A case management system for NMBM, adapted from the WSL case management
system's architecture and hosted on Google Cloud (Cloud Run + Cloud SQL,
under NMBM's Google Workspace BAA).

**Status: scaffold.** This repository was seeded from NMBM's discovery
document, not from a signed-off spec. Core structure (monorepo layout,
auth/authorize pattern, module split, base schema) is real and working;
most domain modules are stubs. See `docs/ARCHITECTURE.md` for what's built
vs. planned, and `docs/DISCOVERY_FOLLOWUP.md` for the discovery questions
that are still open and should close before further build-out — in
particular the compliance questions in Part 3 and the billing layout
question (M23), which affects scope more than anything else on the doc.

## Stack

npm workspaces monorepo, Fastify + Drizzle + Postgres API, React SPA,
one Cloud Run service serving both — same shape as the WSL system this
was adapted from.

```
packages/
  shared/   zod schemas, enums, permission codes — built to dist, consumed by api and web
  db/       Drizzle schema, migrations, seeds — built to dist, consumed by api
  api/      Fastify server: plugins (auth, authorize, audit, errors) + modules (routes/service/repository)
  web/      React SPA (Vite + Tailwind)
```

## Commands

```bash
npm run build                 # shared, db, api, web (dist is what others import)
npm run typecheck             # all workspaces
DATABASE_URL=... npm test     # all workspaces; api/db need Postgres
npm run dev:api               # :8080
npm run dev:web               # :5173, proxies /api to :8080

DATABASE_URL=... npm run -w @nmbm/db migrate
DATABASE_URL=... npm run -w @nmbm/db seed:reference   # roles, permissions, grants — required
DATABASE_URL=... npm run -w @nmbm/db seed:synthetic   # invented staff and participants for demos
```

Reference data is not optional: `authorize()` reads its grants from the
database, so before `seed:reference` runs every authenticated route
returns 403.

For local sign-in without Google, set `ALLOW_DEV_LOGIN=true` and visit
`/auth/dev-login?email=t.green@nmbm.example.org`. It is refused when
`NODE_ENV=production`.

## Branding

See `docs/BRANDING.md` for the palette, typography, and mark-usage notes
(approximated from chat-shared images, not sampled from source files —
that doc says exactly what's left to finish). The actual logo files
still need to be dropped into `packages/web/public/branding/`.

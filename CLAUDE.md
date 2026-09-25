# NMBM Case Management System

Case management for NMBM. Holds participant PHI once R1 (HIPAA status) is
resolved either way — treat it as PHI now, don't wait for the answer.
npm workspaces monorepo, Fastify + Drizzle + Postgres, React SPA, one
Cloud Run service serving both. Adapted from the WSL case management
system's architecture; see `docs/ARCHITECTURE.md` for what carries over
and what's specific to NMBM.

## Read this much, then stop

| Doing | Read |
|---|---|
| Anything | this file |
| Where code lives, route by route and page by page | `docs/agent/map.md` |
| Running or writing tests | `docs/agent/testing.md` |
| Changing domain behaviour | `docs/agent/invariants.md` |
| What's built vs. stubbed, and why it's shaped this way | `docs/ARCHITECTURE.md` |
| What NMBM hasn't answered yet | `docs/DISCOVERY_FOLLOWUP.md` |
| Touching colors, fonts, or the logo | `docs/BRANDING.md` |
| Reviewing user-submitted tickets/feedback | `docs/SUPPORT.md` |
| Google sign-in, OAuth clients, redirect URIs | `docs/GOOGLE_SETUP.md` |
| The no-contact ladder or care plan clocks | `packages/api/src/lib/rules.ts` |

## Commands

```bash
npm run build                 # shared, db, api, web (dist is what others import)
npm run typecheck             # all workspaces
TEST_DATABASE_URL=... npm test  # any Postgres server; each run makes and drops its own database
npm run dev:api               # :8080
npm run dev:web               # :5173, proxies /api to :8080

DATABASE_URL=... npm run -w @nmbm/db migrate
DATABASE_URL=... npm run -w @nmbm/db seed:reference   # roles, permissions, grants — required
DATABASE_URL=... npm run -w @nmbm/db seed:synthetic   # invented staff and participants for demos
```

Reference data is not optional: `authorize()` reads its grants from the
database, so before `seed:reference` runs every authenticated route
returns 403 — which presents as a broken login, not as missing data.

Tests run through the real server against a real Postgres, on every
push in CI. What they cover, and what they don't, is in
`docs/agent/testing.md`.

For local sign-in without Google, set `ALLOW_DEV_LOGIN=true`: the login
page then lists the seeded staff by role, one click each. The route
behind it (`/auth/dev-login?email=…`) is never registered when
`NODE_ENV=production`.

## Hard rules

1. **Nothing is deleted.** Void, retire, revoke, disenrol. NMBM confirmed
   this directly (discovery M30: "I like the voiding of it to be able to
   get the information").
2. **Authorization is opt-in and enforced server-side.** Every route
   carries an `authorize()` preHandler or is listed in `PUBLIC_BY_DESIGN`
   with a reason.
3. **After editing `packages/shared` or `packages/db`, rebuild them.**
   Both are consumed from `dist`.
4. **Never edit an applied migration.** Add a new one and update
   `packages/db/src/migrations/meta/_journal.json`.
5. **Money is a string end to end.** `numeric` columns, string in the
   API, string in the schema. Applies the moment billing (M22) or
   stipends (M18/M19) are built.
6. **A front-line worker sees their own caseload only**, server-side, not
   just hidden in the UI (discovery U5).
7. **Don't build billing beyond the schema placeholder until M23
   lands.** The payer file layout and rejection-handling process are
   unanswered in discovery and are the single biggest scope driver in
   the whole document — see `docs/DISCOVERY_FOLLOWUP.md`.
8. **Prove a test works by breaking the code.** Revert the fix, confirm
   the new test fails for the right reason, restore. Every test in the
   suite has been through this (the table is in `docs/agent/testing.md`),
   and the first pass found a rule no test was guarding.
9. **Derive state that can drift; store only decisions a person made.**
   Consent expiry, the no-contact run and programme completion are
   computed at read time. A stored status that nothing keeps honest goes
   on asserting something false until somebody notices — and the thing
   it asserts is usually about a real person. See
   `docs/agent/invariants.md`.

## Working agreements

- Branch: work directly on `main` until this repo has a real CI/deploy
  pipeline of its own. CI builds, typechecks and runs the tests on push; there is no
  `Dockerfile`, no `cloudbuild.yaml`, and no GCP project yet, so nothing
  a merge does can reach a running system.
- Check a rule over HTTP as more than one role before building the page
  for it. Two of the worst bugs in this repo so far — an authorization
  hook that let handlers run before the check resolved, and a Clinical
  Director locked out of the whole caseload — were invisible from a
  single signed-in session, and one of them was masked by tests passing
  on the 401 path.
- This system is not the WSL system. Don't copy WSL business rules
  (billing categories, program names, permission grid) by default —
  check them against NMBM's own discovery answers first. Architecture
  patterns carry over; domain content doesn't.

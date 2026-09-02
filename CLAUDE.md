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
| Where code lives | `docs/agent/map.md` |
| Changing domain behaviour | `docs/agent/invariants.md` |
| What's built vs. stubbed, and why it's shaped this way | `docs/ARCHITECTURE.md` |
| What NMBM hasn't answered yet | `docs/DISCOVERY_FOLLOWUP.md` |
| Touching colors, fonts, or the logo | `docs/BRANDING.md` |
| Reviewing user-submitted tickets/feedback | `docs/SUPPORT.md` |

## Commands

```bash
npm run build                 # shared, db, api, web (dist is what others import)
npm run typecheck             # all workspaces
DATABASE_URL=... npm test     # all workspaces; api/db need Postgres
npm run dev:api               # :8080
npm run dev:web               # :5173, proxies /api to :8080
DATABASE_URL=... npm run -w @nmbm/db migrate
```

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
   the new test fails for the right reason, restore.

## Working agreements

- Branch: work directly on `main` until this repo has a real CI/deploy
  pipeline of its own (there is none yet — this is a scaffold).
- This system is not the WSL system. Don't copy WSL business rules
  (billing categories, program names, permission grid) by default —
  check them against NMBM's own discovery answers first. Architecture
  patterns carry over; domain content doesn't.

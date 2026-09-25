# Google Workspace and OAuth setup

What has to exist in NMBM's Google tenancy before anyone can sign in
with their real account. None of it blocks development today — local
work uses `ALLOW_DEV_LOGIN` (see `CLAUDE.md`) — but all of it blocks the
first real deployment.

## The ordering, because it looks circular and isn't

The production redirect URI contains the app's own URL, which doesn't
exist until the app is deployed. That reads like a deadlock; it isn't.
The sequence is:

1. Create the GCP project in NMBM's org.
2. Create the OAuth client with **only** the localhost redirect URI.
   Local sign-in against real Google accounts works from this point.
3. Deploy to Cloud Run. This produces the service URL.
4. Add the production redirect URI to the same OAuth client and
   redeploy with `GOOGLE_OIDC_REDIRECT_URI` set to it.

Step 4 is a two-minute edit, not a rebuild. If you'd rather not revisit
it, map a custom domain (`app.<their-domain>`) before step 2 and use
that in the redirect URI from the start — then the callback never
changes, even if the Cloud Run service is recreated.

## What to create

**A GCP project inside NMBM's organisation**, not a personal one. This
matters for the next item.

**An OAuth client**, type *Web application*. Two settings carry real
weight:

- **User type: Internal.** Only available when the project sits in the
  Workspace org, which is what super-admin access buys. Internal means
  Google itself refuses to issue a token to anyone outside NMBM's
  domain — a stronger guarantee than the `hd` parameter, which is only
  a UI hint on the authorize request. Keep both: the app re-checks the
  domain on the token it receives (`packages/api/src/plugins/auth.ts`).
- **Authorized redirect URIs**, exactly:
  - `http://localhost:8080/auth/google/callback` — local development
  - `https://<service-url>/auth/google/callback` — production

  These must match byte for byte, including scheme and trailing path.
  A mismatch fails at Google with `redirect_uri_mismatch` before the
  app is ever reached.

## What the app needs in its environment

| Variable | Where it comes from |
|---|---|
| `GOOGLE_OIDC_CLIENT_ID` | the OAuth client |
| `GOOGLE_OIDC_CLIENT_SECRET` | the OAuth client — Secret Manager in production, never the repo |
| `GOOGLE_OIDC_REDIRECT_URI` | must equal one of the registered URIs above |
| `GOOGLE_WORKSPACE_DOMAIN` | NMBM's primary Workspace domain, e.g. `nmbm.org` |
| `SESSION_SECRET` | 32+ random characters — Secret Manager. The server refuses to start in production without it, because the development fallback is published in this repository |
| `SESSION_IDLE_MINUTES` | Optional; default 60. Idle time before a session ends |
| `TRUST_PROXY` | `true` on Cloud Run, which ends TLS in front of the app. Without it the Secure session cookie is never sent and sign-in fails with no error |
| `DATABASE_SOCKET_DIR` | `/cloudsql/<connection name>` on Cloud Run — see `docs/DEPLOY.md` |

`GOOGLE_WORKSPACE_DOMAIN` has no default on purpose: sign-in refuses to
start without it rather than falling back to accepting any Google
account on the internet. If any of the four Google variables is
missing, the login page says "Sign-in isn't set up yet" rather than
failing with a server error.

## What the person at the screen sees when it goes wrong

Every refusal lands back on the login page with a reason and a next
step (`SIGN_IN_ERRORS` in `packages/shared/src/auth.ts`). The two worth
knowing about when setting this up:

- **"That isn't an NMBM account"** — someone chose a personal Gmail.
  The authorize request sends `prompt=select_account`, so Google always
  shows the account chooser rather than silently picking whichever
  account the browser was already signed into.
- **"Your account is waiting for access"** — anyone in the Workspace
  can sign in, and arrives with no role. An administrator assigns one
  on the Staff page; until then they see a holding page, not an app
  full of errors.

## Scopes

`openid email profile` only. The app reads a name and an email address
to identify a staff member; it does not touch Gmail, Drive or Calendar,
and shouldn't acquire scopes that would let it.

## A note on super-admin access

Workspace super admin means an account inside NMBM's domain, which has
two consequences worth being deliberate about:

1. **The maintainer becomes a normal user of this system.** Sign-in,
   the domain check and role assignment all work for that account like
   anyone else's — see `docs/SUPPORT.md`, which used to assume
   otherwise.
2. **Super admin reaches all Workspace data**, including every user's
   mail and Drive — a far wider boundary than this application. It
   strengthens the case that R4 (a BAA covering the maintainer, not
   just Google) is a yes rather than an open question. Worth confirming
   before real participant data exists, not after. See
   `docs/DISCOVERY_FOLLOWUP.md`.

Day-to-day work in this system does not need super admin, and shouldn't
use it. Use a normal Workspace account with an assigned role in the app;
keep the super-admin account for Workspace and GCP administration.

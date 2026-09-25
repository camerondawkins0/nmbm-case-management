# Deploying

One Cloud Run service serves the API and the built web app. Cloud SQL
holds the data and the sign-in sessions. Every push to `main` builds,
tests, migrates and deploys — once the trigger below exists.

| File | What it does |
|---|---|
| `Dockerfile` | One image for both the service and the release job |
| `cloudbuild.yaml` | Test → build image → push → migrate and seed grants → deploy |
| `deploy/setup-gcp.sh` | One-time: registry, Cloud SQL, secrets, service accounts |
| `packages/db/src/release.ts` | The release job: migrations, then roles and grants |
| `packages/db/src/grant-role.ts` | Gives the first administrator their role |

## What has and hasn't been verified

Verified in the build sandbox: the image builds and runs as a non-root
user; the release job migrates a fresh database over a unix socket
mounted the way Cloud Run mounts Cloud SQL, and is safe to re-run; the
app serves the web build with its security headers, sets the Secure
session cookie behind a proxy, keeps sessions across instances, and
shuts down cleanly on SIGTERM; every page runs under the Content Security
Policy without a violation; Cloud Build's test step passes against a
`postgres:16` container on a network named `cloudbuild`.

**Not verified, because there is no Google Cloud project yet:** anything
that talks to Google Cloud — `deploy/setup-gcp.sh`, the `gcloud` steps in
`cloudbuild.yaml`, IAM, and the Cloud SQL socket mount itself. Expect the
first run to need small corrections.

## Before anything else

1. **The Google Cloud BAA.** NMBM signed the Google *Workspace* BAA
   (R2/R3). That agreement covers Workspace services — Gmail, Drive and
   so on. It does not cover Google Cloud: Cloud Run, Cloud SQL, Secret
   Manager and Cloud Logging are under Google Cloud's own BAA, which
   NMBM has to accept separately for its Cloud organisation. This has to
   be in place before any real client information goes in.
2. **R4** — whether a BAA is also needed with whoever builds and
   maintains this. See `docs/DISCOVERY_FOLLOWUP.md`.
3. **A Google Cloud project inside NMBM's organisation**, with billing
   attached. Not a personal project — `docs/GOOGLE_SETUP.md` explains why
   the OAuth client depends on it.

## First deployment

1. **Provision.** From Cloud Shell, signed in as someone who can create
   resources in the project:

   ```bash
   PROJECT_ID=<project> WORKSPACE_DOMAIN=<nmbm-domain> ./deploy/setup-gcp.sh
   ```

   It prints the values for step 3.

2. **Create the OAuth client** as described in `docs/GOOGLE_SETUP.md`,
   then store its secret:

   ```bash
   printf '%s' '<client-secret>' | gcloud secrets versions add nmbm-google-client-secret --data-file=-
   ```

3. **Connect the repository and create the trigger.** In the console:
   Cloud Build → Triggers → Connect repository → GitHub →
   `camerondawkins0/nmbm-case-management`. Then create the trigger:

   ```bash
   gcloud builds triggers create github \
     --name=nmbm-main --region=us-west2 \
     --repo-owner=camerondawkins0 --repo-name=nmbm-case-management \
     --branch-pattern='^main$' --build-config=cloudbuild.yaml \
     --service-account="projects/<project>/serviceAccounts/nmbm-build@<project>.iam.gserviceaccount.com" \
     --substitutions=_SQL_INSTANCE=<from step 1>,_RUNTIME_SA=<from step 1>,_WORKSPACE_DOMAIN=<domain>,_GOOGLE_CLIENT_ID=<client id>,_REDIRECT_URI=https://placeholder.invalid/auth/google/callback
   ```

4. **First deploy.** Run the trigger (or push to `main`). The service
   URL appears at the end of the build log.

5. **Fix the redirect URI.** Add `https://<service-url>/auth/google/callback`
   to the OAuth client, set `_REDIRECT_URI` on the trigger to the same
   value, and run the trigger again. `docs/GOOGLE_SETUP.md` explains why
   this is two passes, and how a custom domain avoids it.

6. **The first administrator.** Sign in once with your NMBM account — you
   will land on "waiting for access", which is correct. Then:

   ```bash
   gcloud run jobs execute nmbm-release --region=us-west2 --wait \
     --args=packages/db/dist/grant-role.js,<your-email>,system_administrator
   ```

   Reload the page. Every other role is then assigned on the Staff page
   by that administrator, and audited there.

## Every deploy after that

Push to `main`. Cloud Build runs the tests against a throwaway Postgres,
builds the image, runs the release job (migrations, then roles and
grants), and only then moves traffic to the new version. If any step
fails, nothing after it runs and the running version is untouched.

Two consequences to work with:

- **The database changes before the code does.** For the length of a
  deploy, the *old* version runs against the *new* schema. A migration
  must work with both: add a column or a table, and don't rename or drop
  one in the same deploy that stops using it — do that in a later one.
- **`main` is production** once the trigger exists. Work on a branch and
  merge when it's ready (`CLAUDE.md`).

## When something goes wrong

- **Bad code, fine data:** send traffic back to the previous revision.

  ```bash
  gcloud run revisions list --service=nmbm-app --region=us-west2
  gcloud run services update-traffic nmbm-app --region=us-west2 --to-revisions=<previous>=100
  ```

  Then fix forward on `main`.
- **Bad data:** Cloud SQL keeps 30 daily backups and 7 days of
  point-in-time recovery. Restore to a *new* instance first and check it,
  rather than overwriting the live one:

  ```bash
  gcloud sql instances clone nmbm-db nmbm-db-restore --point-in-time='2026-01-01T15:30:00Z'
  ```

- **Everyone signed out at once:** sessions live in the `sessions` table,
  so a restart or deploy doesn't do this. Rotating `nmbm-session-secret`
  does, by design.

## What the running service is configured with

| Setting | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Turns off development sign-in; requires `SESSION_SECRET` |
| `TRUST_PROXY` | `true` | Cloud Run ends TLS and forwards HTTP; without this the Secure session cookie is never set and sign-in silently fails |
| `DATABASE_SOCKET_DIR` | `/cloudsql/<connection name>` | The Cloud SQL socket. The driver won't take it from the URL — see `packages/db/src/client.ts` |
| `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_OIDC_CLIENT_SECRET` | Secret Manager | Never in the repository or the trigger |
| Instances | 0–3, 512 MB | Scales to nothing overnight; ten staff never need more than one. The first request after a quiet spell takes a few seconds |

## Cost, roughly

Cloud SQL is almost all of it — the dedicated 1 vCPU instance is in the
region of $50–60 a month, plus storage and backups. Cloud Run at this
traffic, Artifact Registry and Secret Manager come to a few dollars.
Check Google's pricing calculator before quoting a figure to NMBM.

## Logs

Cloud Run request logs record paths such as `/api/participants/<id>`,
and error logs can include what a request contained. Treat Cloud Logging
as holding client information: it is covered by the Google Cloud BAA
once accepted, and access to it should be limited to the people who
administer the system.

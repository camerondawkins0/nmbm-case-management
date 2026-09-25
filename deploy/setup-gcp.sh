#!/usr/bin/env bash
# One-time Google Cloud setup for the NMBM case management system.
#
# Creates everything cloudbuild.yaml deploys into: the Artifact Registry
# repository, the Cloud SQL instance and database, the secrets, and two
# service accounts with only the roles they need. Safe to re-run — each
# step skips what already exists.
#
# Run it from Cloud Shell (or anywhere gcloud is signed in) as someone
# who can create resources in NMBM's project. Read docs/DEPLOY.md first:
# the Google Cloud BAA must be in place before real client data, and it
# is NOT the same agreement as the Google Workspace BAA.
#
#   PROJECT_ID=nmbm-case-management WORKSPACE_DOMAIN=nmbm.org ./deploy/setup-gcp.sh

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to NMBM's Google Cloud project id}"
: "${WORKSPACE_DOMAIN:?Set WORKSPACE_DOMAIN to NMBM's Google Workspace domain, e.g. nmbm.org}"
REGION="${REGION:-us-west2}"          # Los Angeles
SQL_INSTANCE="${SQL_INSTANCE:-nmbm-db}"
# 1 vCPU / 3.75 GB, dedicated. Shared-core tiers are cheaper but carry no
# SLA, which is the wrong trade for the system of record.
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
DB_NAME=nmbm
DB_USER=nmbm
REPO=nmbm
RUNTIME_SA="nmbm-run@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="nmbm-build@${PROJECT_ID}.iam.gserviceaccount.com"

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null

step "Enabling APIs"
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com

step "Artifact Registry repository '$REPO'"
exists gcloud artifacts repositories describe "$REPO" --location="$REGION" ||
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
    --description="NMBM case management images"

step "Cloud SQL instance '$SQL_INSTANCE' (takes several minutes the first time)"
exists gcloud sql instances describe "$SQL_INSTANCE" ||
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 --edition=enterprise --tier="$SQL_TIER" --region="$REGION" \
    --storage-type=SSD --storage-size=10GB --storage-auto-increase \
    --backup-start-time=10:00 --enable-point-in-time-recovery \
    --retained-backups-count=30 --retained-transaction-log-days=7 \
    --ssl-mode=ENCRYPTED_ONLY --deletion-protection
# Backups at 10:00 UTC are 2-3am in Los Angeles. Point-in-time recovery
# means a bad afternoon can be undone to the minute, not to last night.
# Deletion protection means removing the instance takes a deliberate
# second step.

step "Database and user"
exists gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" ||
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

secret_exists() { exists gcloud secrets describe "$1"; }
put_secret() {
  # Creates the secret with its first value; leaves an existing one alone.
  if secret_exists "$1"; then echo "secret $1 already exists — left as is"; return; fi
  printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=-
}

if ! secret_exists nmbm-database-url; then
  DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  # If a previous run created the user but stopped before saving the
  # secret, reset its password rather than failing on "already exists".
  if [ -n "$(gcloud sql users list --instance="$SQL_INSTANCE" --filter="name=$DB_USER" --format='value(name)')" ]; then
    gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
  else
    gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
  fi
  # The host is a placeholder: on Cloud Run the connection goes through
  # the socket in DATABASE_SOCKET_DIR (see packages/db/src/client.ts).
  put_secret nmbm-database-url "postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
  unset DB_PASSWORD
else
  echo "nmbm-database-url exists — assuming the database user was created with it"
fi

step "Secrets"
put_secret nmbm-session-secret "$(openssl rand -base64 48)"
# Filled in after the OAuth client exists (docs/GOOGLE_SETUP.md):
#   printf '%s' 'THE-SECRET' | gcloud secrets versions add nmbm-google-client-secret --data-file=-
put_secret nmbm-google-client-secret "not-set-yet"

step "Service accounts"
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create nmbm-run --display-name="NMBM app (Cloud Run)"
exists gcloud iam service-accounts describe "$BUILD_SA" ||
  gcloud iam service-accounts create nmbm-build --display-name="NMBM deploys (Cloud Build)"

# The app: connect to Cloud SQL, read its three secrets. Nothing else.
gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudsql.client >/dev/null
for secret in nmbm-database-url nmbm-session-secret nmbm-google-client-secret; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor >/dev/null
done

# Deploys: push images, manage Cloud Run, act as the runtime account,
# write build logs. It never reads the secrets itself.
gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" \
  --member="serviceAccount:$BUILD_SA" --role=roles/artifactregistry.writer >/dev/null
for role in roles/run.admin roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None \
    --member="serviceAccount:$BUILD_SA" --role="$role" >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$BUILD_SA" --role=roles/iam.serviceAccountUser >/dev/null

CONNECTION="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

cat <<EOF

Done. Values for the Cloud Build trigger's substitutions:

  _REGION            $REGION
  _SQL_INSTANCE      $CONNECTION
  _RUNTIME_SA        $RUNTIME_SA
  _WORKSPACE_DOMAIN  $WORKSPACE_DOMAIN
  _GOOGLE_CLIENT_ID  (from the OAuth client — docs/GOOGLE_SETUP.md)
  _REDIRECT_URI      (https://<service-url>/auth/google/callback, after the first deploy)

Trigger service account: $BUILD_SA

Next: docs/DEPLOY.md, "Connecting the repository".

Before any real client data: confirm the Google Cloud BAA is accepted for
this project's organisation. The Workspace BAA does not cover Cloud Run,
Cloud SQL or Secret Manager.
EOF

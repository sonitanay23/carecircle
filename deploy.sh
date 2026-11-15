#!/usr/bin/env bash
# Deploys CareCircle to Google Cloud Run, with Firestore, Secret Manager and
# Cloud Scheduler. Safe to run again: it updates what already exists.
#
#   PROJECT_ID=my-project ./deploy.sh
#
# Reads GEMINI_API_KEY, SMTP_USER, SMTP_PASS and MAIL_FROM from your local .env
# and stores the secret ones in Secret Manager (never in the container image).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=my-project ./deploy.sh}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-carecircle}"

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
GEMINI_API_KEY="$(env_value GEMINI_API_KEY)"
SMTP_USER="$(env_value SMTP_USER)"
SMTP_PASS="$(env_value SMTP_PASS)"
MAIL_FROM="$(env_value MAIL_FROM)"
: "${GEMINI_API_KEY:?GEMINI_API_KEY missing from .env}"
: "${SMTP_USER:?SMTP_USER missing from .env}"
: "${SMTP_PASS:?SMTP_PASS missing from .env}"
MAIL_FROM="${MAIL_FROM:-CareCircle <$SMTP_USER>}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "Using project $PROJECT_ID in $REGION"
gcloud config set project "$PROJECT_ID" >/dev/null

step "Turning on Google Cloud APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  translate.googleapis.com texttospeech.googleapis.com

step "Creating the Firestore database (if needed)"
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
fi

step "Storing secrets in Secret Manager"
put_secret() { # name value
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null
  fi
  echo "  $1 stored"
}
existing_secret() { gcloud secrets versions access latest --secret="$1" 2>/dev/null || true; }
SESSION_SECRET="$(existing_secret session-secret)"; SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
CRON_SECRET="$(existing_secret cron-secret)"; CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 24)}"
put_secret gemini-api-key "$GEMINI_API_KEY"
put_secret smtp-pass "$SMTP_PASS"
put_secret session-secret "$SESSION_SECRET"
put_secret cron-secret "$CRON_SECRET"

step "Giving the Cloud Run service account only the access it needs"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for role in roles/datastore.user roles/secretmanager.secretAccessor roles/cloudtranslate.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role="$role" --condition=None >/dev/null
done

step "Building and deploying to Cloud Run (takes a few minutes)"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --service-account "$RUN_SA" --memory 512Mi --cpu 1 --min-instances 0 --max-instances 3 --timeout 120 \
  --set-env-vars "^@^NODE_ENV=production@STORE=firestore@MAIL_TRANSPORT=smtp@SMTP_HOST=smtp.gmail.com@SMTP_PORT=465@SMTP_USER=${SMTP_USER}@MAIL_FROM=${MAIL_FROM}@GEMINI_MODEL=gemini-flash-latest@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest,SMTP_PASS=smtp-pass:latest,SESSION_SECRET=session-secret:latest,CRON_SECRET=cron-secret:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
step "Telling the app its public address ($URL)"
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "APP_BASE_URL=$URL" >/dev/null

step "Scheduling reminders every 5 minutes (Cloud Scheduler)"
JOB_ARGS=(--location="$REGION" --schedule="*/5 * * * *" --uri="$URL/internal/reminders/run" --http-method=POST
  --headers="X-Cron-Secret=$CRON_SECRET" --attempt-deadline=120s --time-zone="Asia/Kolkata")
if gcloud scheduler jobs describe carecircle-reminders --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http carecircle-reminders "${JOB_ARGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http carecircle-reminders "${JOB_ARGS[@]}" >/dev/null
fi

step "Checking the live app"
curl -fsS "$URL/healthz" && echo
curl -fsS -o /dev/null -w "Home page: %{http_code}\n" "$URL/"
curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" "$URL/internal/reminders/run" && echo

printf '\n\033[1mDone. Live link: %s\033[0m\n' "$URL"

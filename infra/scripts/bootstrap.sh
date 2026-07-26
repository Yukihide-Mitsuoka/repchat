#!/usr/bin/env bash
# Prerequisites Terraform cannot or should not own (ADR-0012 T3/T6):
#   1. APIs            — must be on before anything else can be created
#   2. Artifact Registry — must exist before the image the services reference
#   3. Terraform state bucket — chicken-and-egg with the backend it stores
#   4. Secret Manager entries — kept OUT of Terraform state on purpose (T3)
#
# Idempotent: safe to re-run. Secret VALUES are read from the gitignored .env
# and piped straight to gcloud — never echoed, never passed as argv (GR-001).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-repchat}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-tfstate}"
# Re-adding a version on every deploy would churn; rotation must be deliberate.
ROTATE_SECRETS="${ROTATE_SECRETS:-no}"

if [[ -z "$PROJECT" ]]; then
  echo "GOOGLE_CLOUD_PROJECT is not set" >&2
  exit 2
fi
command -v gcloud >/dev/null 2>&1 || { echo "gcloud is required but not installed" >&2; exit 2; }

echo "==> project=${PROJECT} region=${REGION}"

# --- 1. APIs -----------------------------------------------------------------
# Deliberately NOT a Terraform resource: `terraform destroy` would then disable
# them, which is slow, surprising, and can break unrelated things in the project.
echo "==> enabling APIs (idempotent)"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  bigquery.googleapis.com \
  --project="$PROJECT"

# --- 2. Artifact Registry ----------------------------------------------------
# Must exist before `gcloud builds submit` can push the image that Terraform
# then points the services at.
if gcloud artifacts repositories describe "$REPOSITORY" \
     --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  echo "==> artifact registry ${REPOSITORY}: exists"
else
  echo "==> artifact registry ${REPOSITORY}: creating"
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker --location="$REGION" \
    --description="RepChat service images" --project="$PROJECT"
fi

# --- 3. Terraform state bucket ----------------------------------------------
# Versioned, uniform access. Losing state means `destroy` cannot clean up and
# billable resources are orphaned — so state lives remotely from the start (T6).
if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project="$PROJECT" >/dev/null 2>&1; then
  echo "==> state bucket ${STATE_BUCKET}: exists"
else
  echo "==> state bucket ${STATE_BUCKET}: creating"
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
fi

# --- 4. Secrets --------------------------------------------------------------
# Values go in here and NOWHERE else: not into Terraform state, not into argv
# (visible in `ps`), not into logs. Only the KEY name is ever printed.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "no .env at ${ENV_FILE} — cannot seed secrets" >&2
  exit 2
fi

# Reads one value from .env without printing it.
value_of() {
  grep -E "^${1}=" "$ENV_FILE" | head -n1 | cut -d= -f2-
}

seed_secret() {
  local key="$1" value
  value="$(value_of "$key")"
  if [[ -z "$value" ]]; then
    echo "    ${key}: MISSING in .env" >&2
    return 1
  fi
  if gcloud secrets describe "$key" --project="$PROJECT" >/dev/null 2>&1; then
    if [[ "$ROTATE_SECRETS" == "yes" ]]; then
      printf '%s' "$value" | gcloud secrets versions add "$key" \
        --data-file=- --project="$PROJECT" >/dev/null
      echo "    ${key}: new version added (rotated)"
    else
      echo "    ${key}: exists (set ROTATE_SECRETS=yes to add a new version)"
    fi
  else
    gcloud secrets create "$key" --replication-policy=automatic --project="$PROJECT" >/dev/null
    printf '%s' "$value" | gcloud secrets versions add "$key" \
      --data-file=- --project="$PROJECT" >/dev/null
    echo "    ${key}: created"
  fi
}

echo "==> secrets (values never printed)"
missing=0
for key in DATABASE_URL APP_RUNTIME_PASSWORD CONTROL_PLANE_TOKEN EXECUTOR_TOKEN; do
  seed_secret "$key" || missing=1
done
if [[ "$missing" -ne 0 ]]; then
  echo "one or more required secrets are missing from .env — see docs/deploy.md" >&2
  exit 2
fi

echo "==> bootstrap complete"

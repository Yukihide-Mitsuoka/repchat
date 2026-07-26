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
#
# Normalized the way every other consumer of .env reads it — `set -a; . .env`,
# and the Node spikes' own parser. Without this, a quoted or CRLF-terminated
# line seeds the secret WITH the quotes, and the value the service then expects
# matches nothing anyone would paste: the shell strips the quotes, so the
# operator's copy and the deployed copy disagree while looking identical.
value_of() {
  local raw
  # `|| true`: a key absent from .env is reported by the caller as MISSING, and
  # must not abort the run via `set -e` before that message is printed.
  raw="$(grep -E "^${1}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  raw="${raw%$'\r'}"                       # CRLF-edited .env
  case "$raw" in
    \"*\") raw="${raw#\"}"; raw="${raw%\"}" ;;
    \'*\') raw="${raw#\'}"; raw="${raw%\'}" ;;
  esac
  printf '%s' "$raw"
}

# sha256 of stdin, hex only. Portable across macOS (shasum) and Linux.
digest() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1
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
      # Report DRIFT rather than a bare "exists". Skipping silently when .env
      # has moved on leaves the deployed service authenticating against a value
      # nobody holds any more, and the resulting 401 surfaces far away as an
      # opaque 500 at the gate (COD-011: no silent failures). Compared by
      # digest, so neither value is ever printed.
      local deployed_hash local_hash
      # `|| true`: no read access to the version is not a reason to fail the
      # deploy — it only means we cannot compare, so we say nothing about drift.
      deployed_hash="$(gcloud secrets versions access latest --secret="$key" \
        --project="$PROJECT" 2>/dev/null | digest || true)"
      local_hash="$(printf '%s' "$value" | digest)"
      if [[ -n "$deployed_hash" && "$deployed_hash" != "$local_hash" ]]; then
        echo "    ${key}: DRIFT — deployed value differs from .env; set ROTATE_SECRETS=yes" >&2
        drifted=1
      else
        echo "    ${key}: exists (matches .env)"
      fi
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
drifted=0
for key in DATABASE_URL APP_RUNTIME_PASSWORD CONTROL_PLANE_TOKEN EXECUTOR_TOKEN; do
  seed_secret "$key" || missing=1
done
if [[ "$missing" -ne 0 ]]; then
  echo "one or more required secrets are missing from .env — see docs/deploy.md" >&2
  exit 2
fi
if [[ "$drifted" -ne 0 ]]; then
  echo "deployed secret(s) differ from .env — re-run with ROTATE_SECRETS=yes" >&2
  exit 2
fi

# --- 5. Cloud Build's service account ---------------------------------------
# Cloud Build runs as the Compute Engine default service account. Newer projects
# no longer grant that account Editor automatically — correctly, since a blanket
# Editor on a default identity is exactly the kind of standing privilege we
# avoid — so it starts with NO permissions and cannot even read the source
# tarball it was just handed (observed on the first real deploy, LOG-0055).
#
# roles/cloudbuild.builds.builder is the purpose-built grant: read the source,
# write build logs, push the image. Assembling the individual permissions by
# hand risks missing one and re-learning this the slow way.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "==> Cloud Build service account: granting builds.builder to ${BUILD_SA}"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/cloudbuild.builds.builder" \
  --condition=None >/dev/null

echo "==> bootstrap complete"

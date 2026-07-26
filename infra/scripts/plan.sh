#!/usr/bin/env bash
# Read-only: what would `make deploy` change? Runs bootstrap-free so it never
# creates anything, which means it needs the state bucket to already exist
# (i.e. run it after the first deploy, or accept the init error).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"

PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-repchat}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-tfstate}"
ALLOW_PUBLIC_INVOKE="${ALLOW_PUBLIC_INVOKE:-true}"

if [[ -z "$PROJECT" ]]; then
  echo "GOOGLE_CLOUD_PROJECT is not set" >&2
  exit 2
fi
command -v terraform >/dev/null 2>&1 || { echo "terraform is required but not installed" >&2; exit 2; }

# Terraform uses Application Default Credentials, which expire separately from
# the gcloud CLI session (LOG-0056).
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "Application Default Credentials are missing or expired. Refresh them:" >&2
  echo "  gcloud auth application-default login" >&2
  echo "  gcloud auth application-default set-quota-project ${PROJECT}" >&2
  exit 2
fi

TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPOSITORY}/app:${TAG}"

terraform -chdir="$TF_DIR" init -upgrade -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="prefix=repchat"

terraform -chdir="$TF_DIR" plan \
  -var="project_id=${PROJECT}" \
  -var="region=${REGION}" \
  -var="image=${IMAGE}" \
  -var="allow_public_invoke=${ALLOW_PUBLIC_INVOKE}"

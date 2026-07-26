#!/usr/bin/env bash
# One-command deploy (ADR-0012). Order matters:
#   bootstrap (APIs, registry, state bucket, secrets)
#     -> build+push the image (Cloud Build, so no local Docker)
#     -> terraform apply (service accounts, IAM, both Cloud Run services, tenants)
#
# The image must exist before apply, because the services reference it by tag.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"

PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-repchat}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-tfstate}"
# false when the org forbids allUsers (docs/deploy.md §3.4.2).
ALLOW_PUBLIC_INVOKE="${ALLOW_PUBLIC_INVOKE:-true}"

if [[ -z "$PROJECT" ]]; then
  echo "GOOGLE_CLOUD_PROJECT is not set" >&2
  exit 2
fi
command -v gcloud >/dev/null 2>&1 || { echo "gcloud is required but not installed" >&2; exit 2; }
command -v terraform >/dev/null 2>&1 || { echo "terraform is required but not installed" >&2; exit 2; }

# Terraform authenticates with Application Default Credentials, NOT the gcloud
# CLI session. The two expire independently, so a perfectly working gcloud can
# sit next to stale ADC — and under a Workspace reauth policy that surfaces as
# an opaque `invalid_rapt` from the state backend, minutes in, after the image
# has already built and pushed (LOG-0056). Check it in the first second instead.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "Application Default Credentials are missing or expired. Refresh them:" >&2
  echo "  gcloud auth application-default login" >&2
  echo "  gcloud auth application-default set-quota-project ${PROJECT}" >&2
  exit 2
fi

bash "${REPO_ROOT}/infra/scripts/bootstrap.sh"

# Tag by commit so a running revision can be traced back to source.
TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPOSITORY}/app:${TAG}"

echo "==> building ${IMAGE} (Cloud Build)"
gcloud builds submit "$REPO_ROOT" --tag="$IMAGE" --project="$PROJECT"

echo "==> terraform init"
terraform -chdir="$TF_DIR" init -upgrade -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="prefix=repchat"

echo "==> terraform apply"
terraform -chdir="$TF_DIR" apply -auto-approve \
  -var="project_id=${PROJECT}" \
  -var="region=${REGION}" \
  -var="image=${IMAGE}" \
  -var="allow_public_invoke=${ALLOW_PUBLIC_INVOKE}"

terraform -chdir="$TF_DIR" output

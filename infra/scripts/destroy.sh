#!/usr/bin/env bash
# DANGEROUS — tears down every Terraform-managed GCP resource (ADR-0012 T7).
#
# Guarded per GR-031 and profiles rule 3: an explicit opt-in variable is
# required, and an interactive session must additionally re-type the project id.
# An agent running this still needs the human to approve THIS command.
#
# Bootstrap-owned resources (registry images, secrets, state bucket) survive by
# default — the state bucket in particular must outlive the destroy that reads
# it. PURGE_BOOTSTRAP=yes removes them afterwards.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"

PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-repchat}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-tfstate}"
ALLOW_DESTROY="${ALLOW_DESTROY:-no}"
PURGE_BOOTSTRAP="${PURGE_BOOTSTRAP:-no}"

if [[ -z "$PROJECT" ]]; then
  echo "GOOGLE_CLOUD_PROJECT is not set" >&2
  exit 2
fi
if [[ "$ALLOW_DESTROY" != "yes" ]]; then
  echo "refusing to destroy: set ALLOW_DESTROY=yes to opt in (GR-031)" >&2
  echo "  make destroy ALLOW_DESTROY=yes" >&2
  exit 2
fi

echo "About to DESTROY all Terraform-managed resources in project: ${PROJECT}"
if [[ -t 0 ]]; then
  # Interactive: make the operator name the target, so a wrong-project destroy
  # cannot happen by holding down Enter.
  read -r -p "Re-type the project id to confirm: " confirm
  if [[ "$confirm" != "$PROJECT" ]]; then
    echo "confirmation did not match — aborted" >&2
    exit 2
  fi
fi

terraform -chdir="$TF_DIR" init -upgrade -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="prefix=repchat"

terraform -chdir="$TF_DIR" destroy -auto-approve \
  -var="project_id=${PROJECT}" \
  -var="region=${REGION}" \
  -var="image=unused-during-destroy"

if [[ "$PURGE_BOOTSTRAP" == "yes" ]]; then
  echo "==> purging bootstrap-owned resources"
  gcloud artifacts repositories delete "$REPOSITORY" \
    --location="$REGION" --project="$PROJECT" --quiet || true
  for key in DATABASE_URL APP_RUNTIME_PASSWORD CONTROL_PLANE_TOKEN EXECUTOR_TOKEN; do
    gcloud secrets delete "$key" --project="$PROJECT" --quiet || true
  done
  # Last, because the destroy above read its state from here.
  gcloud storage rm -r "gs://${STATE_BUCKET}" --project="$PROJECT" || true
else
  echo "==> bootstrap-owned resources kept: registry ${REPOSITORY}, 4 secrets, gs://${STATE_BUCKET}"
  echo "    (PURGE_BOOTSTRAP=yes also removes them)"
fi

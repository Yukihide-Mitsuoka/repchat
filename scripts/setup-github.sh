#!/usr/bin/env bash
# Compatibility entry point for the policy-driven GitHub governance reconciler.
# Requires Python 3 and an authenticated gh CLI. Apply additionally requires local
# repository Administration write access.
#
# Usage:
#   bash scripts/setup-github.sh OWNER/REPOSITORY --confirm-repo OWNER/REPOSITORY
#   DRY_RUN=1 bash scripts/setup-github.sh OWNER/REPOSITORY

set -euo pipefail

usage() {
  printf 'Usage: bash scripts/setup-github.sh OWNER/REPOSITORY --confirm-repo OWNER/REPOSITORY\n' >&2
  printf '       DRY_RUN=1 bash scripts/setup-github.sh OWNER/REPOSITORY\n' >&2
}

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
governance="$root/scripts/github_governance.py"

if [ -n "${DRY_RUN:-}" ]; then
  if [ "$#" -ne 1 ]; then
    usage
    exit 2
  fi
  repository="$1"
  exec python3 "$governance" plan --root "$root" --repo "$repository"
fi

if [ "$#" -ne 3 ] || [ "$2" != "--confirm-repo" ]; then
  usage
  exit 2
fi
if [ "$1" != "$3" ]; then
  printf 'setup-github: --confirm-repo must exactly match OWNER/REPOSITORY\n' >&2
  usage
  exit 2
fi

repository="$1"
exec python3 "$governance" apply --root "$root" --repo "$repository" \
  --confirm-repo "$3"

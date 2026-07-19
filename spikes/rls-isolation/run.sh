#!/usr/bin/env bash
# RLS isolation spike runner. Spins up an ephemeral Postgres in Docker, applies
# the schema + RLS + seed, then proves — as the non-privileged app_runtime role,
# the only principal RLS actually constrains — that tenant isolation holds even
# when the application-layer WHERE clause is absent. No local psql needed (psql
# runs inside the container); no secrets (container uses trust auth on localhost).
#
# Usage: bash spikes/rls-isolation/run.sh   (needs a running Docker daemon)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CT=rls_spike
IMAGE=postgres:16-alpine
ALPHA=11111111-1111-1111-1111-111111111111
BRAVO=22222222-2222-2222-2222-222222222222

cleanup() { docker rm -f "$CT" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ starting $IMAGE ..."
docker run -d --name "$CT" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=spike \
  "$IMAGE" >/dev/null

echo -n "→ waiting for readiness"
for _ in $(seq 1 60); do
  if docker exec "$CT" pg_isready -U postgres -d spike >/dev/null 2>&1; then break; fi
  echo -n .; sleep 1
done
echo

su() { docker exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d spike "$@"; }
# app_runtime value read: set the tenant, run the SQL, return the value only.
# tail -n1 drops psql's "SET" command tag; every assertion query is single-row.
app() { # $1 = tenant uuid ("" to leave unset), $2 = sql
  local setstmt=""
  [ -n "$1" ] && setstmt="SET app.tenant_id = '$1';"
  docker exec -i "$CT" psql -tA -U app_runtime -d spike -c "$setstmt $2" | tail -n1
}
# app_runtime write that MUST be rejected: ON_ERROR_STOP makes psql exit non-zero
# on the RLS/FK error (no pipe, so the exit code is psql's).
app_write() { # $1 = tenant uuid, $2 = sql
  docker exec -i "$CT" psql -v ON_ERROR_STOP=1 -tA -U app_runtime -d spike \
    -c "SET app.tenant_id = '$1'; $2"
}

echo "→ applying schema / rls / seed ..."
su < "$DIR/01_schema.sql" >/dev/null
su < "$DIR/02_rls.sql" >/dev/null
su < "$DIR/03_seed.sql" >/dev/null

pass=0; fail=0
check() { # $1 = label, $2 = expected, $3 = actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 (expected '$2', got '$3')"; fail=$((fail+1)); fi
}
# Negative test: the SQL MUST error (RLS/FK rejects it).
check_rejected() { # $1 = label, $2 = sql, $3 = tenant
  if app_write "$3" "$2" >/dev/null 2>&1; then
    echo "  FAIL  $1 (write was allowed — should have been rejected)"; fail=$((fail+1))
  else echo "  PASS  $1"; pass=$((pass+1)); fi
}

echo "→ assertions (as app_runtime, the RLS-constrained role):"
# 1-2: each tenant sees only its own rows, even with NO WHERE clause (backstop).
check "alpha sees only its user (bare SELECT, no WHERE)" "a@alpha" "$(app "$ALPHA" 'SELECT email FROM users;')"
check "bravo sees only its user (bare SELECT, no WHERE)" "b@bravo" "$(app "$BRAVO" 'SELECT email FROM users;')"
check "alpha user count is exactly 1"                     "1"       "$(app "$ALPHA" 'SELECT count(*) FROM users;')"
# 3: fail-closed — no tenant set → sees nothing.
check "unset tenant sees zero rows (fail-closed)"         "0"       "$(app "" 'SELECT count(*) FROM users;')"
# 4: cross-tenant read of a specific other-tenant id returns nothing.
check "alpha cannot read bravo's row by id"               "0"       "$(app "$ALPHA" "SELECT count(*) FROM users WHERE id = 'b2222222-2222-2222-2222-222222222222';")"
# 5: WITH CHECK blocks writing a row into another tenant.
check_rejected "alpha cannot INSERT a user into bravo (WITH CHECK)" \
  "INSERT INTO users (id, tenant_id, email) VALUES ('e0000000-0000-0000-0000-000000000000','$BRAVO','x');" "$ALPHA"
# 6: composite FK blocks granting one tenant's user a different tenant's role.
check_rejected "cross-tenant role grant is unrepresentable (composite FK)" \
  "INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ('$ALPHA','a1111111-1111-1111-1111-111111111111','d2222222-2222-2222-2222-222222222222');" "$ALPHA"

echo "→ result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

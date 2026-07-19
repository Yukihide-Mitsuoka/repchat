# Spike: Postgres RLS tenant-isolation backstop

Turns ADR-0005 §3's "**RLS is the last-resort backstop** — an app-layer WHERE-clause
mistake must not leak across tenants" from a design claim into an empirically tested
fact, on a real Postgres. Issue: #53. Schema mirrors
[docs/system-design.md](../../docs/system-design.md) §3 (representative subset, not the
production migration — that ships with the control-plane module against Neon).

## What it proves

The gate injects `tenant_id` at the app layer (proven in `spikes/vertical-slice`). RLS is
the *second* layer: even if that injection is ever missing, the datasource itself must not
return another tenant's rows. This spike connects as `app_runtime` — a non-superuser,
non-owner role, the only principal RLS actually constrains — and checks:

1. A **bare `SELECT ... FROM users` with no WHERE clause** returns only the current
   tenant's row (the backstop: a forgotten filter does not leak).
2. Each tenant sees exactly its own rows; neither can read the other's row even by id.
3. **Fail-closed**: with `app.tenant_id` unset, queries return zero rows (not all rows).
4. `WITH CHECK` blocks *writing* a row into another tenant.
5. The composite `(tenant_id, id)` FK makes a **cross-tenant role grant unrepresentable**
   (system-design §3 rule 2) — independent of RLS.

## Files

| File | Role |
|------|------|
| `01_schema.sql` | tenants / users / roles / user_roles with composite `(tenant_id, id)` FKs |
| `02_rls.sql` | `enable`+`force` RLS, `USING`+`WITH CHECK` policy per table, the `app_runtime` login role + grants |
| `03_seed.sql` | two tenants (alpha, bravo), one user + role each, fixed UUIDs |
| `run.sh` | ephemeral Docker Postgres → apply → assert as `app_runtime` → teardown |

## Run

```bash
bash spikes/rls-isolation/run.sh    # needs a running Docker daemon; no local psql
```

No secrets: the container uses `POSTGRES_HOST_AUTH_METHOD=trust` on localhost, and
`app_runtime` has no password (GR-001).

## Results (2026-07-18, Postgres 16-alpine)

**7/7 assertions pass** as `app_runtime` (the RLS-constrained role):

```
  PASS  alpha sees only its user (bare SELECT, no WHERE)
  PASS  bravo sees only its user (bare SELECT, no WHERE)
  PASS  alpha user count is exactly 1
  PASS  unset tenant sees zero rows (fail-closed)
  PASS  alpha cannot read bravo's row by id
  PASS  alpha cannot INSERT a user into bravo (WITH CHECK)
  PASS  cross-tenant role grant is unrepresentable (composite FK)
→ result: 7 passed, 0 failed
```

## Findings

1. **The backstop holds.** A `SELECT` with no tenant predicate at all returns only the
   session tenant's rows — the exact "app forgot the WHERE clause" failure mode is
   contained by the datasource, as ADR-0005 §3 requires. This is now a tested fact.
2. **Fail-closed, not fail-open.** An unset `app.tenant_id` yields zero rows, never all
   rows — `current_setting(..., true)::uuid` is NULL and `col = NULL` matches nothing.
   The gate must still always `SET app.tenant_id` per request; if it forgets, the failure
   is "sees nothing", not "sees everything".
3. `FORCE ROW LEVEL SECURITY` matters: without it the table owner bypasses the policy, so
   the app must connect as a non-owner role (`app_runtime`) — which this spike does, or
   the test would be vacuous.
4. `WITH CHECK` (not just `USING`) is required to block *writes* into another tenant; a
   `USING`-only policy would filter reads but allow a cross-tenant INSERT.
5. The composite `(tenant_id, id)` FK rejects a cross-tenant role grant independently of
   RLS — defense in depth at the schema level.

## Caveats / not covered

- Representative 4-table subset, not the full §3 schema or the production migration (that
  ships with the control-plane module against Neon). The RLS *mechanism* is what's proven;
  applying it to every tenant-owned table is mechanical (the §3.3 loop).
- Neon runs stock Postgres, so RLS behaves identically; still worth re-running the full
  migration against Neon once provisioned.

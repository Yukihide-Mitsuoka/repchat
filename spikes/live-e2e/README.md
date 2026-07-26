---
id: spike-live-e2e
title: Live end-to-end — deployed gate through to BigQuery
updated: 2026-07-26
---

# Spike: live end-to-end

Drives the **deployed** gate over real HTTP with real signed tokens. Nothing is
stubbed: Cloudflare Workers → Cloud Run → Neon (and BigQuery on the ② path).

This is the live counterpart to two earlier results that were both measured in
process: the vertical slice (LOG-0031, 12/12) and the fixture-backed slice
(LOG-0035, 8/8). Passing here means the same guarantees hold across real
network boundaries, real RLS, and real IAM.

## What it asserts

| # | Assertion | What it proves |
|---|---|---|
| 1 | alpha gets the report shell | JWT verification, the gate→control-plane HTTP transport, authz resolved out of Postgres under RLS |
| 2 | shell served again | ① cache path |
| 3 | ungranted report refused | the report allow-list (原則E②) |
| 4 | no token refused | — |
| 5 | wrong `aud` refused | audience binding |
| 6 | expired token refused | `exp` enforcement |
| 7 | unknown tenant refused | the principal must exist in the control plane |
| 8 | alpha gets query results | ② path: executor → BigQuery via D1 impersonation |
| 9 | second request is a cache hit | ② result cache |
| 10 | **bravo never receives alpha rows** | no cross-tenant leak on the live wire |

## Prerequisites

- GCP and Cloudflare deployed (`make deploy`, `npx wrangler deploy`).
- `.env` holds `DATABASE_URL`; `GOOGLE_CLOUD_PROJECT` is exported.
- The LOG-0052 fixtures exist: datasets `t_alpha` / `t_bravo` with an `orders`
  table, and service accounts `t-alpha-reader` / `t-bravo-reader`.

### Extra prerequisites for the ② data path only

Assertions 1–7 pass without these; 8–10 need them.

**a. The executor must be allowed to impersonate the tenant service accounts.**
LOG-0052 granted `tokenCreator` to the owner's own account, which is right for
a local spike and wrong for a deployed service. Point it at the running
identity instead:

```bash
for T in alpha bravo; do
  gcloud iam service-accounts add-iam-policy-binding \
    "t-${T}-reader@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
    --project="$GOOGLE_CLOUD_PROJECT" \
    --member="serviceAccount:executor-run@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountTokenCreator"
done
```

> These are test fixtures, deliberately kept out of Terraform's `tenants`
> (ADR-0012). A real tenant gets this binding from Terraform.

**b. The executor needs a table allowlist.** It ships fail-closed
(`{"tables":[]}` refuses everything, LOG-0039), so allow the fixture table:

```bash
make deploy QUERY_POLICY='{"tables":[{"name":"orders","scopeColumn":"store_id"}]}'
```

## Run

```bash
node spikes/live-e2e/setup.mjs
```

Seeds two demo tenants and prints a `VENDOR_KEYS` line. Put it in
`wrangler.toml` under `[vars]` and redeploy — it is a **public** key, so
committing it is fine (GR-001 permits public keys; `vendor_keys` stores only
public keys for the same reason). The matching private key is written to a
gitignored file and never leaves the machine.

```bash
npx wrangler deploy
GATE_URL=https://gate.<subdomain>.workers.dev node spikes/live-e2e/verify.mjs
```

## Teardown

```bash
node spikes/live-e2e/setup.mjs --teardown
```

Removes the demo tenants and deletes the local private key. The GCP fixtures
and the deployed services are left alone — `make destroy ALLOW_DESTROY=yes`
handles those.

## Notes

- The demo tenants use fixed UUIDs so re-running is idempotent, and teardown
  deletes exactly what was seeded rather than guessing.
- Seeding connects as the database **owner** on purpose: RLS stops
  `app_runtime` writing tenant rows, which is the behaviour proven in LOG-0032,
  not an obstacle to work around.
- Assertion 10 is the one that matters most. Same URL, same query id, different
  tenant token — if the caches or the boundary were wrong anywhere along the
  chain, this is where it would show.

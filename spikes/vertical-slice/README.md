# Spike: ADR-0005 §11 thin vertical slice — layered cache × authorization

Proves, in one runnable path, the safety/speed core of
[ADR-0005](../../docs/adr/0005-cache-and-authorization-architecture.md) before Phase 1:
vendor-signed JWT → edge gate → ① shell / ② result / ③ authz caches → mock MCP over
per-tenant datasets. Issue: #21. Diagrammed design: [docs/system-design.md](../../docs/system-design.md).

## Layout

| File | Stands in for |
|------|---------------|
| `jwt.mjs` | Vendor-backend-signed short-lived embed JWT (ES256, node:crypto only) |
| `control_plane.mjs` | Postgres control plane + BigQuery per-tenant datasets (原則D), token minting |
| `gate.mjs` | Edge authorization gate: ①②③ caches, §4 key formula, version-token invalidation, epoch+denylist revocation, payload tenant assert, single-flight |
| `test.mjs` | The cross-tenant / cross-scope proof (12 tests) |
| `bench.mjs` | §11 exit criteria: hit rate + latency |

## Run

```bash
node --test spikes/vertical-slice/test.mjs
node spikes/vertical-slice/bench.mjs
```

No dependencies (node ≥ 20 built-ins only).

## Results (2026-07-18, Node 24)

**Tests: 12/12 pass.** Each maps to an ADR rule:

- 原則B — a forged client `tenant_id` (param or JWT claim) has zero effect: the cache
  key is derived only from the server-resolved ctx, and a claim that contradicts the
  SoR is rejected before any lookup.
- 原則C-4 — an *induced* key-derivation bug (every tenant deriving t_alpha's key) is
  caught by the payload `tenant_id` assert: 500, nothing served.
- ADR §5 — `data_version` / `report_version` bumps invalidate with **no purge**; the
  stale entry stays in the map but becomes unreachable.
- ADR §6 — different data scopes never share a key; two *different roles* with the same
  effective scope share one entry (role-explosion containment).
- Revocation — an unexpired JWT dies immediately via denylist, stays dead via epoch
  mismatch after the denylist entry lapses, and a re-minted token works again.
- Plus: single-flight (10 concurrent misses → 1 execution), errors never cached,
  403 outside `allowed_reports`, signature/expiry/audience rejection.

**Bench** (20k requests, 4 users across 2 tenants ×3 scopes, `data_version` bumped
every 2k requests to simulate ETL):

```
hit rate        99.89%  (hits 19979 / misses 21)
executor calls  21 (one per scope×version, single-flight)
p50 / p95 / p99 0.26 / 0.51 / 0.79 ms (in-process)
```

## Findings

1. **The invariants hold under attack-shaped tests.** Cross-tenant addressing is not
   "checked" so much as *unrepresentable*: a bravo principal cannot produce an alpha
   key (原則B), and even a deliberately broken key derivation cannot serve alpha's
   payload (原則C-4). This is the property the ADR promises.
2. **Version-token invalidation behaves as designed** — freshness after ETL without a
   purge path, at a 99.9% hit rate even with refreshes every 2k requests.
3. **ES256 verification dominates in-process latency** (~0.25 ms of the p50). Fine for
   the edge budget, but it prices ADR §10-1 (short-TTL authz cache vs claims-only):
   whatever the ③ choice, signature verification is the floor, so the DB-lookup-per-
   request cost that claims-embedding avoids should be compared against ~0.25 ms, not 0.
4. **Not covered here** (unchanged §10 open items): real edge runtime + KV, real
   Postgres RLS / BigQuery datasets (spiked separately: `nl2sql-*`, `evidence-dynamic`),
   scope normalization beyond `store_id`, result-size eviction to object storage.

## Verdict

The §11 exit bar — shell+result caching with version invalidation and cross-tenant
requests reliably rejected — passes in-process. Phase 1 can lift `gate.mjs`'s rules
onto a real edge runtime with the test list as the acceptance suite.

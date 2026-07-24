---
id: spike-executor-d1-backstop
title: D1 per-tenant impersonation — live backstop proof
updated: 2026-07-24
---

# Spike: D1 per-tenant impersonation backstop

Proves the ADR-0010 **D1** claim on real BigQuery: with per-tenant impersonation, the
① tenant boundary holds **even if the AST binder fails completely**. The verifier bypasses
the binder and hands the runner fully-qualified cross-tenant SQL; BigQuery denies it because
the impersonated service account has no access to the other dataset. This is the data-layer
insurance that `docs/status.md` (LOG-0040) recorded as missing for BigQuery.

Impersonation mints **short-lived tokens** via the IAM Credentials API — **no key files are
downloaded or stored** (GR-001). The runtime only needs `serviceAccountTokenCreator` on each
tenant SA.

## Prerequisites

- Datasets `t_alpha` and `t_bravo` exist with an `orders` table (from the `executor-bigquery`
  spike, LOG-0033).
- `gcloud` authenticated as a user with admin on your GCP project, and ADC set
  (`gcloud auth application-default login`).
- `GOOGLE_CLOUD_PROJECT` exported to your project id (the verifier reads it).

## Owner steps (gcloud)

Run these once. They create one read-only SA per tenant, scope each to **its own dataset
only**, and let your identity impersonate them. Copy-paste as a block:

```bash
PROJECT="${GOOGLE_CLOUD_PROJECT:?export GOOGLE_CLOUD_PROJECT to your GCP project id}"
RUNTIME="user:$(gcloud config get-value account 2>/dev/null)"   # who may impersonate

for T in alpha bravo; do
  SA="t-${T}-reader@${PROJECT}.iam.gserviceaccount.com"

  # 1. Create the per-tenant read-only service account.
  gcloud iam service-accounts create "t-${T}-reader" \
    --project="$PROJECT" \
    --display-name="RepChat tenant t_${T} read-only"

  # 2. Grant it dataViewer on ITS OWN dataset ONLY (dataset-level, never project-level).
  #    This single scoping is the whole backstop — do not widen it.
  bq add-iam-policy-binding \
    --member="serviceAccount:${SA}" \
    --role="roles/bigquery.dataViewer" \
    "${PROJECT}:t_${T}"

  # 3. Let it CREATE query jobs (billing/execution). jobUser grants no data access by itself.
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/bigquery.jobUser" \
    --condition=None

  # 4. Let YOUR identity impersonate this SA (mint tokens as it).
  gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT" \
    --member="$RUNTIME" \
    --role="roles/iam.serviceAccountTokenCreator"
done
```

> IAM changes can take up to a minute or two to propagate. If the first run shows a denial on
> a SA's *own* dataset, wait and re-run.

## Run the verifier

```bash
node spikes/executor-d1-backstop/verify.mjs
```

Expected: **5 passed, 0 failed** — each SA reads its own dataset, each is **denied** the
other (binder bypassed), and the runtime's own identity can read both (the contrast that
shows why the connection principal must be impersonated, not ambient).

## Teardown (optional)

```bash
PROJECT="${GOOGLE_CLOUD_PROJECT:?export GOOGLE_CLOUD_PROJECT to your GCP project id}"
for T in alpha bravo; do
  gcloud iam service-accounts delete "t-${T}-reader@${PROJECT}.iam.gserviceaccount.com" \
    --project="$PROJECT" --quiet
done
```

## What this does and does not prove

- **Proves**: the ③ data-layer backstop now exists for BigQuery — a bound query that names
  another tenant's dataset is denied by IAM, independent of our SQL rewriting. Parity with
  what RLS gives the control plane (LOG-0032).
- **Does not cover**: the ② *row* scope (same-tenant store filter). IAM is dataset-grained;
  row scope has no data-layer backstop and relies on the binder's structural self-check
  (LOG-0042). Unchanged here.

## Known limit

One SA per tenant hits GCP's default quota of ~100 service accounts per project. Fine for
early scale; sharding across projects or a quota increase is the path beyond that
(recorded, LOG-0044).

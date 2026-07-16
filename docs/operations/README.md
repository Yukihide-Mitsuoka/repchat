---
id: operations-docs
title: Operations Documentation
---

# Operations

Keeping the system healthy day-to-day: observability, SLOs, alerts, maintenance.

**Update triggers (DOC-030):** new critical path (needs metrics + alert), new alert,
changed SLO, new scheduled maintenance task, post-incident action items.

## Structure

| File | Content |
|------|---------|
| `observability.md` | Where logs/metrics/traces go; how to query them; correlation IDs |
| `slo.md` | SLIs and SLO targets per critical path; error budget policy |
| `alerts.md` | Alert catalog: condition → severity → runbook link. Every alert MUST link a runbook entry |
| `maintenance.md` | Recurring tasks (rotation, cleanup, upgrades) with schedule and owner |

## Baseline rules

- Logs are structured (JSON) to stdout (ARC-010), with request/correlation IDs; no PII,
  no secrets (SEC-011, GR-003).
- Every user-critical path gets: a latency/error-rate metric, an SLO, and an alert
  wired to a runbook entry. An alert without a runbook link fails review (REV-REL).
- Alert severity: `page` (human now) vs `ticket` (next business day). Default new
  alerts to `ticket` until proven page-worthy — alert fatigue is an outage risk.

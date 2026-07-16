---
id: deployment-docs
title: Deployment Documentation
---

# Deployment

How this system reaches each environment. All infrastructure is code (IaC) — manual
console changes are configuration drift and get reverted.

**Update triggers (DOC-030):** new environment variable (also `.env.example`), new
environment, changed deploy procedure, new infrastructure component, changed rollback
procedure.

## Structure

| File | Content |
|------|---------|
| `environments.md` | Environment matrix: name, purpose, URL, who may deploy, data class allowed (SEC-011) |
| `procedure.md` | Deploy pipeline: trigger → stages → verification → rollback; who/what approves (REL-010) |
| `configuration.md` | Every config variable: name, purpose, per-env source (secret manager path — never values, GR-001) |
| `provisioning.md` | How to create/modify infrastructure via IaC (`infra/`), state management, review flow |

## Baseline rules

- Environments: at minimum `staging` (production-like, safe for DAST) and `production`.
- Production deploys happen only from tagged releases built by CI (REL-010) — never
  from a developer machine.
- Every deploy is verified by the smoke checks in [../runbook/](../runbook/) and is
  reversible (REL-040); an unverifiable deploy is a failed deploy.
- Secrets flow: platform secret manager → runtime env vars; never files in the image,
  never CI logs (GR-001/003).

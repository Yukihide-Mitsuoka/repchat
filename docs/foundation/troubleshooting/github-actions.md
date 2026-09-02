---
id: github-actions-troubleshooting
title: GitHub Actions Troubleshooting
---

# GitHub Actions Troubleshooting

This guide diagnoses reusable workflow authentication failures. Project-specific
workflow failures belong in the project-owned `docs/troubleshooting/` path.

## Checkout reports `Repository not found` in a private repository

**Symptom:** `actions/checkout` fails with `Repository not found`, while the same
workflow succeeds when the repository is public.

**Cause:** the job declares a `permissions` mapping but omits `contents`. GitHub sets
every omitted permission to `none`; job-level permissions replace the workflow-level
default for that job instead of extending it. Public checkout can mask the defect by
reading anonymously.

**Fix:** declare the minimum required contents permission in the affected job. Keep its
other least-privilege permissions unchanged.

```yaml
jobs:
  example:
    permissions:
      contents: read
      issues: write
```

Use `contents: write` only when the job must change repository content. A job that uses
`actions/checkout` or a repository-local `./` action needs read access because local
actions are loaded from the checked-out repository.

**Verification:** rerun the affected workflow in a private repository. `make doctor`
also checks every Foundation workflow for this effective-permission requirement.

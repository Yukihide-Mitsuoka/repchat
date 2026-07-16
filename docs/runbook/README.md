---
id: runbook-index
title: Runbooks
---

# Runbooks

Step-by-step procedures executable under stress — by a human at 3am or by an AI agent
with operational access. Written so that **no judgment calls are needed**: every step
has an expected result and a "if not, then" branch.

**Update triggers (DOC-030):** new alert (every alert links here), new failure mode
discovered in an incident, changed deploy/rollback procedure, risky release (REL-040).

## Entry format (`<slug>.md`)

```markdown
---
id: runbook-<slug>
title: <symptom or task name>
severity: page | ticket
last-verified: YYYY-MM-DD
---

# <Symptom or task>

**Trigger:** <the alert or situation that brings you here>
**Impact if unhandled:** <what breaks, for whom>
**Safe to execute by agent:** yes / no — <destructive steps require human per GR-031>

## Steps
1. <action — exact command or console path>
   - Expect: <observable result>
   - If not: <next step or escalate to X>
2. ...

## Verification
<how to confirm resolution — exact check>

## Escalation
<who/what, with contact/channel, when steps are exhausted>
```

## Rules

- Exact commands, no placeholders that require guessing; parameterize with env vars.
- Steps marked destructive require explicit human approval before an agent runs them
  (GR-031).
- Each runbook is re-verified after any related procedure change; stale runbooks are
  worse than none — `last-verified` is mandatory.

## Index

<!-- | Runbook | Trigger | Severity | -->
<!-- populate as runbooks are added -->

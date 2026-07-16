---
name: bugfix
description: Diagnose and fix incorrect behavior with a regression test that pins the fix
triggers: [bug, defect, incorrect behavior, crash, regression, バグ修正, 不具合修正, バグ, 障害]
reads: [.ai/workflow.md, .ai/testing.md]
---

# Skill: Bug Fix

## Purpose
Remove a defect at its root cause, prove the fix with a regression test that fails on
the old code, and prevent recurrence.

## Inputs
- Reproduction: exact steps/input → observed vs expected behavior. If not reproducible,
  reproduction **is** the first task — do not patch symptoms of a bug you cannot trigger.
- The issue ID; the module(s) involved (`MODULE.md`).

## Process
1. Reproduce the bug locally; capture the exact failing observation.
2. Write the regression test that encodes the *expected* behavior. Run it — it MUST
   fail, and fail for the right reason. Commit it first (`test(scope): reproduce #N`).
3. Diagnose the root cause: trace from symptom to cause; state the cause in one
   sentence. If you can't, you're not ready to fix.
4. Fix at the cause, not the symptom. Minimal diff — resist drive-by refactoring
   (COD-021); file follow-up issues instead.
5. Run the regression test (now green) + the module's full suite + `make test`.
6. Sweep for siblings: search for the same pattern elsewhere in the codebase; fix in
   the same PR only if identical and small, otherwise open issues.
7. Update `docs/troubleshooting/` if users could hit this; runbook if ops action exists.
8. PR with `fix(scope):` title; description includes root cause + why this fix.

## Decision criteria
- **Symptom vs cause?** If your fix adds a null-check/try-catch without explaining why
  the value can be invalid, you are patching a symptom — keep digging.
- **Hotfix?** Production-impacting → REL-050: minimal diff, expedited but real review.
- **Can't find root cause after 3 approaches?** Escalate with findings (CLAUDE.md §13).
- **Fix reveals a design flaw?** Fix the instance now; propose ADR for the design.

## Outputs
- PR: regression test (committed failing-first) + minimal fix + doc updates.
- Root-cause statement in the PR description.
- Follow-up issues for siblings/refactoring found along the way.

## Checklist
- [ ] Regression test demonstrably failed before the fix (show the failing run)
- [ ] Root cause stated in one sentence in the PR
- [ ] Diff is minimal; no mixed refactoring (COD-021)
- [ ] Sibling occurrences searched; results reported
- [ ] Full test suite green; troubleshooting docs updated if user-visible

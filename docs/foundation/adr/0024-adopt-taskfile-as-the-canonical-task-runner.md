---
id: adr-0024
title: ADR-0024 — Adopt Taskfile as the canonical task runner
status: accepted
updated: 2026-09-27
---

# ADR-0024: Adopt Taskfile as the canonical task runner

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-09-27 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | On completion, supersedes the Make-specific command contract in ADR-0023; otherwise extends ADR-0004 and ADR-0014 |

## Context

The owner wants `Taskfile.yml`, not `Makefile`, as the repository's task interface.
The current root Makefile defines the canonical commands, while inherited instructions,
the Make-target contract, `scripts/makefile_profile.py`, CI, pre-commit hooks, and
post-edit hooks call or validate `make`. Descendants protect their own root Makefile
and several workflow files. A Foundation-only rename would therefore break callers
or give descendants an unreviewed command mismatch. The target commands must retain
their behavior and security checks, and direct-parent Template Sync must remain the
only automatic propagation path.

## Options considered

### Option 1: Keep Make as the standard

No new runtime or migration cost, and existing checks stay intact. It does not meet
the owner's chosen interface or simplify reading task dependencies.

### Option 2: Replace Make immediately throughout the Foundation

This reaches one standard quickly but leaves protected child callers on `make`.
Template Sync cannot update those files, so active descendants may fail before a
reviewed port. Rollback would also require coordinated changes across the fleet.

### Option 3: Stage one-way migration to Taskfile

Publish a Taskfile contract and equivalent tasks, then port each protected caller
and direct child through reviewed PRs. A temporary Make shim may delegate to Task
within a repository while its callers migrate; it MUST NOT contain an independent
task implementation. Remove the shim after that repository's callers and downstream
compatibility are verified. This adds a short-lived dependency but preserves green
checkpoints and ends with one standard.

### Option 4: Keep Make and Taskfile permanently

Both tools remain available, but two public entry points and validators invite drift
and impose duplicate documentation and CI maintenance on every new consumer.

## Decision

Adopt Option 3. The eventual canonical entry point is the repository-owned root
`Taskfile.yml`; the canonical command is `task <name>`. Retain the current task names
and observable behavior unless a separate reviewed decision changes them. A
Foundation-owned inherited contract under `.ai/contracts/foundation/` specifies
required task semantics, while each descendant owns its Taskfile and protected
callers. Update each child's manifest and `.templatesyncignore` to protect its root
Taskfile before sync can reach it. The Foundation MUST NOT distribute a second
executable copy of a child's task definitions or silently change inheritance
ownership to force the migration.
The transitional Make shim, if needed, is forwarding-only and has an explicit removal
condition; permanent dual operation is not the destination.

## Consequences

**Positive:** Task definitions have an explicit YAML interface and named task calls;
the final state has one task runner. A child can adapt its own commands without losing
the inherited semantics or the reviewed direct-parent boundary.

**Negative:** Task becomes a required local and CI tool. Installation cannot depend
on `task setup` before Task is installed. Pin a tested Task version in CI and document
local installation; keep any setup action SHA-pinned. [Task's `deps` run
concurrently](https://taskfile.dev/docs/guide),
so sequential Make prerequisites MUST be translated to ordered task calls when order
matters. Shell portability and platform-specific commands still need explicit tests.
The temporary shim adds complexity and must not outlive migration.

Migrate in expand–verify–contract stages. First add the root Taskfile, contract,
contract tests, and installation instructions without removing Make. Translate the
current targets, including `doctor`, and run both interfaces against equivalent
checks. Then update Foundation CI, pre-commit, hooks, instructions, and validator; use
a forwarding shim only where callers remain. Port active descendants through reviewed
direct-parent hops, including protected workflows and local task definitions; verify
one direct child and one multi-level child before removing compatibility. Optional
copied `profiles/*/Makefile` examples may be converted or removed by their owner, but
MUST NOT be moved into inherited `docs/foundation/`. Paused descendants are not
silently changed. Rollback is a normal reviewed PR restoring the last working entry
point, not a second sync path.

**Follow-ups:** After approval, implement the Foundation transition with regression
tests, record the active-fleet migration checklist, and update inherited guidance.

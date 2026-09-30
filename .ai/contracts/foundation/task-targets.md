---
id: foundation-task-targets
title: Canonical Task Target Contract
authority: 4
read_when: [taskfile, tooling]
---

# Canonical Task Target Contract

Every repository owns a root `Taskfile.yml` exposing the tasks below. Install the
Task CLI before invoking `task setup`; CI pins its version. An inapplicable task MUST
report an honest repository-owned no-op. Projects MAY add tasks, but inherited
semantics and safety checks MUST remain intact. The `profiles/` Makefiles are optional
historical examples, not inherited task definitions.

| Task | Semantics | Mutates files? | Called by |
|------|-----------|----------------|-----------|
| `setup` | install toolchain, plugins, git hooks — idempotent | env only | CI, humans |
| `format` | auto-format; honors optional `FILE=<path>` | **yes** | post-edit hook |
| `lint` | **check-only**, zero warnings (COD-001); never fixes | **never** | post-edit hook, pre-commit, CI |
| `test` | full suite (unit + integration) | no | CI, release gate |
| `test-unit` | fast suite, seconds not minutes | no | pre-push hook |
| `test-integration` | slower, real adapters allowed | no | CI |
| `coverage` | tests + coverage report (TST-003 ratchet) | report only | CI |
| `build` | produce/validate the deployable artifact without credentials | artifact only | CI, release |
| `run` | run locally (IaC profiles: alias to plan) | — | humans/agents |
| `security-scan` | local sweep: secrets + deps/misconfig | no | agents, pre-release |
| `sbom` | SBOM into `dist/` (SPDX + CycloneDX) | dist/ only | release, audits |
| `clean` | remove caches/artifacts **inside the workspace only** (GR-031) | yes | humans/agents |
| `doctor` | foundation self-check: metadata invariants + guard-hook tests | no | CI, agents |

## Taskfile rules

1. **`lint` never auto-fixes.** Fixing belongs in `format`; `lint` fails on
   unformatted code (COD-001).
2. **Unknown tasks fail.** Do not add a catch-all task or mask a misspelled task.
   Pass arguments as Task variables, for example `task format FILE=src/main.py`.
3. **Destructive tasks follow GR-031.** Require explicit opt-in, label them
   DANGEROUS in `desc`, and obtain per-command human approval when an agent runs them.
4. **Network access belongs in `setup`,** not `lint` or `test`; keep the inner loop
   offline-safe.
5. **Ordered work uses ordered `cmds`.** Task `deps` may run concurrently; do not use
   them where a later command requires an earlier result (ADR-0024).
6. **`help` lists task descriptions.** Keep each `desc` beside its task definition,
   and do not emit unjustified next-step prompts from successful tasks.

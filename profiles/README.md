---
id: profiles
title: Makefile Profiles — Canonical Command Contract
---

# profiles/ — Makefile Reference Implementations

The root [Makefile](../Makefile) ships as no-op placeholders. A **profile** is a
reference implementation for a concrete stack: copy the profile's Makefile to the repo
root, adjust paths, delete the placeholders — hooks, pre-commit, and CI start working
unchanged.

## The canonical target contract (binding)

Hooks and CI call these targets and depend on these exact semantics. A profile MUST
implement them (or leave an honest no-op with a message); project-specific targets may
be added freely below them.

| Target | Semantics | Mutates files? | Called by |
|--------|-----------|----------------|-----------|
| `setup` | install toolchain, plugins, git hooks — idempotent | env only | CI (every job), humans |
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
| `doctor` | foundation self-check: metadata invariants + guard-hook tests (stack-independent; keep as-is) | no | CI, agents |

## Profile rules (learned from real-world Makefiles)

1. **`lint` never auto-fixes.** A lint that "helpfully" formats and exits 0 lets CI go
   green on unformatted code and hides the failure from the agent. Fixing is `format`'s
   job; `lint` fails loudly (COD-001).
2. **No catch-all `%:` target.** A `%: @:` pattern makes every typo (`make lnit`) exit
   0 silently — it breaks the feedback loop agents depend on (GR-042 in spirit). Pass
   extra arguments via variables instead (`make destroy DESTROY_ARGS="--from-layer=3"`),
   never via `$(MAKECMDGOALS)`.
3. **Destructive targets follow GR-031**: guarded by an explicit opt-in flag (config
   value or variable), documented as DANGEROUS in `help`, and still require per-command
   human approval when an agent runs them.
4. **Network access belongs in `setup`**, not in `lint`/`test` (e.g. `tflint --init`,
   plugin downloads) — keeps the inner loop fast and offline-safe.
5. **No next-step nudges in output.** Tool output like "✅ passed! Next: run make
   deploy" actively steers agents toward actions the result does not justify. State
   the result; let rules decide the next step.
6. **`help` is generated from `##` comments** so it cannot drift from reality.

## Available profiles

| Profile | Stack | Source |
|---------|-------|--------|
| [terraform-gcp/](terraform-gcp/) | Terraform (GCP foundations, layered), Python tooling via uv, OPA policies, Excel SSoT generator | adapted 2026-07-02 from a production foundations project |
| [typescript-node/](typescript-node/) | Node.js + pnpm + Prettier + ESLint + tsc + Vitest | authored 2026-07-02 |
| [python-uv/](python-uv/) | Python + uv + Ruff + mypy + pytest | authored 2026-07-02 |

## Creating a new profile

1. Copy the closest existing profile directory.
2. Reimplement the canonical targets for the stack; keep semantics per the table.
3. Keep project-specific targets in the clearly marked "extensions" section.
4. Verify: `make lint` on dirty code fails; `make format` fixes it; `make nonexistent`
   fails; `make test-unit` finishes in seconds.

---
id: foundation-make-targets
title: Canonical Make Target Contract
authority: 4
read_when: [makefile, tooling]
---

# Canonical Make Target Contract

Every repository exposes these targets through its root `Makefile`. Hooks, CI, and
agents depend on the semantics below. A target that does not apply MUST report an
honest repository-owned no-op; a project MAY add other targets. Stack-specific
reference implementations are optional copies under `profiles/` in the Foundation
template, not part of this inherited contract.

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

## Profile rules

1. **`lint` never auto-fixes.** A lint that formats and exits 0 lets CI pass on
   unformatted code and hides the failure. Fixing is `format`'s job; `lint` fails
   (COD-001).
2. **No catch-all `%:` target.** A `%: @:` pattern makes a typo such as `make lnit`
   exit 0. Pass extra arguments through variables instead, such as
   `make destroy DESTROY_ARGS="--from-layer=3"`; never use `$(MAKECMDGOALS)`.
3. **Destructive targets follow GR-031.** Guard them with an explicit opt-in flag,
   document them as DANGEROUS in `help`, and require per-command human approval when
   an agent runs them.
4. **Network access belongs in `setup`,** not in `lint` or `test` (for example,
   `tflint --init` or plugin downloads), so the inner loop remains offline-safe.
5. **No next-step nudges in output.** A successful target states its result; it does
   not direct agents toward an action that the result cannot justify.
6. **Generate `help` from `##` comments** so the help text cannot drift from targets.

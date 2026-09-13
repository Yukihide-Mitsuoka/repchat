---
id: testing
title: Testing Policy
authority: 4
read_when: [feature, bugfix, refactor, test, review]
---

# Testing Policy

Canonical commands: `make test` (all), `make test-unit` (fast suite), `make coverage`.

## TST-001: Test pyramid

| Level | Location | Scope | Speed budget | Share |
|-------|----------|-------|--------------|-------|
| Unit | `tests/modules/<ctx>/unit/` | one class/function, no I/O | < 100ms each | ~70% |
| Integration | `tests/modules/<ctx>/integration/` | module + real adapter (DB, HTTP) | < 5s each | ~25% |
| E2E | `tests/e2e/` | user-visible flow through real stack | minutes | ~5%, critical paths only |

Tests mirror `src/` structure exactly so the test for any file is findable mechanically.

## TST-002: What must be tested

Every PR that changes behavior MUST include (GR-021):
- Happy path for each new/changed public function of a module.
- Error paths: invalid input, dependency failure, boundary values (empty, max, zero, null).
- For bug fixes: a regression test that **fails on the pre-fix code** (see
  `.skills/bugfix.skill.md` — write the failing test first, then fix).

Do not test: private functions directly, framework behavior, generated code.

## TST-003: Coverage gate

Line coverage MUST NOT decrease on `main` (ratchet). New modules target ≥ 80% for
`domain/` and `application/`. Coverage is a floor detector, not a goal — 100% coverage
with weak assertions violates GR-040 in spirit.

## TST-010: Test quality rules

- **Deterministic**: no real network, no real clock, no shared mutable state, no
  order-dependence. Inject time and randomness.
- **Arrange-Act-Assert** with one behavioral assertion focus per test.
- **Name = specification**: `test_expired_token_is_rejected`, not `test_token_2`.
  A failing test's name alone should identify the broken behavior.
- **Independent fixtures**: builders/factories over shared fixtures; a test must be
  readable without opening other files.
- **Flaky tests** are quarantined with a linked issue within one day — never retried
  into green (GR-040).

## TST-011: Conditional test-driven development

Use test-driven development when the task defines concrete observable behavior, a
stable observable seam exists, and expected results have an independent basis: an
accepted requirement, external standard, known-good example, or invariant. Select an
existing stable seam yourself; ask the human only when a new seam would materially
change the public design.

Work one behavior slice at a time: make its test fail for the intended reason, add the
smallest complete behavior that makes it pass, then start the next slice. Test through a
stable public boundary, and MUST NOT calculate the expected result with the same logic as
the implementation. While the relevant tests remain green, cleanup MAY restructure only
code introduced within the current behavior slice. Restructuring pre-existing code or
unrelated responsibilities belongs in a separate refactor PR under COD-021.

TDD is not required for documentation-only changes, mechanical configuration changes,
investigation, generated artifacts, or explicitly disposable prototypes. If a behavior
change appears suitable but TDD is skipped because no stable seam or independent oracle
exists, state why in the PR. GR-021 and all other test gates still apply.

## TST-020: Doubles policy

- Mock only at port boundaries (the interfaces defined in `application/`). Never mock
  the domain layer.
- Prefer fakes (in-memory implementations) over mocks for repositories.
- Integration tests use real infrastructure via containers, not mocks.

## TST-030: AI agent test protocol

1. Run `make test-unit` before starting work to confirm a green baseline. If the
   baseline is red, report it; do not build on a broken baseline.
2. Run affected tests after every meaningful change; run `make test` before opening a PR.
3. Report results verbatim — full failure output, never a summary of what you expected
   (GR-042).
4. When tests fail, fix the code, not the test — unless the test itself is proven wrong,
   which must be stated explicitly in the commit message.

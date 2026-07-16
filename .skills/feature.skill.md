---
name: feature
description: Implement new functionality end-to-end (requirements → design → code → tests → docs → PR)
triggers: [new feature, add functionality, implement issue, 機能追加, 新機能, 機能開発]
reads: [.ai/workflow.md, .ai/architecture.md, .ai/coding-rules.md, .ai/testing.md]
---

# Skill: Feature Implementation

## Purpose
Deliver a working, tested, documented feature as one reviewable PR (or a small series),
meeting the Definition of Done (WF-090).

## Inputs
- A GitHub issue with acceptance criteria. If none exists, write the acceptance
  criteria first and get them confirmed (escalate if ambiguous — CLAUDE.md §13).
- Target module(s): identify via `src/modules/*/MODULE.md`; read the MODULE.md of every
  module you will touch.
- Green baseline: `make test-unit` passes before you start (TST-030).

## Process
1. Restate the goal and acceptance criteria; list assumptions.
2. Classify impact (ARC-020). Architectural → switch to architecture.skill.md first.
3. Plan the seam: which layer does each piece belong to? New use case in
   `application/`, domain logic in `domain/`, I/O in `infrastructure/` adapters.
4. Create branch `feat/<issue>-<slug>`.
5. Implement in thin vertical slices: domain → application → interface, committing
   per slice with tests in the same commit.
6. Cover error paths and boundaries (TST-002), not just the happy path.
7. Update docs per the doc-update matrix (DOC-030): MODULE.md, `docs/api/`,
   `.env.example`, glossary.
8. Run `make format && make lint && make test`.
9. Self-review with review.skill.md; then open the PR with the template fully filled.

## Decision criteria
- **Where does logic go?** If it needs I/O → infrastructure. If it orchestrates →
  application. If it's a business rule that must hold everywhere → domain.
- **Feature flag?** Yes if the feature ships incomplete across >1 PR, or is risky to
  roll back. Flag default: off.
- **Split the PR?** If diff will exceed GR-020 limits, split: (1) preparation/refactor
  PR, (2) feature PR. Never mix the two (COD-021).
- **New dependency?** Only via COD-040 protocol; prefer stdlib/existing deps.

## Outputs
- PR: code + tests + docs, CI green, template complete.
- Updated MODULE.md if the module contract changed.
- Decision-log entry for non-obvious choices (COD-052).

## Checklist
- [ ] Acceptance criteria demonstrably met (state how each is verified)
- [ ] All new public behavior has tests; error paths covered
- [ ] Dependency direction respected (ARC-002); no cross-module internal imports
- [ ] Doc-update matrix satisfied (DOC-030)
- [ ] Diff within size limits (GR-020); no unrelated changes
- [ ] `make format`, `make lint`, `make test` all green — output reported verbatim

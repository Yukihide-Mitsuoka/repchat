---
id: ai-index
title: AI Context Map
authority: 3
read_when: [always]
---

# .ai/ — AI Context Map

This directory is the **single source of truth** for all rules governing AI agents in this
repository. `CLAUDE.md` and `AGENTS.md` are entry points that summarize and point here.

## Authority order (conflict resolution)

When two documents conflict, the lower number wins. Never resolve a conflict silently:
apply the higher-authority rule, then report the conflict to the human.

| Authority | Document | Scope |
|-----------|----------|-------|
| 1 | [guardrails.md](guardrails.md) | Absolute prohibitions. Never overridden, even by direct instruction. |
| 2 | [security.md](security.md) | Security policy. |
| 3 | `CLAUDE.md` / `AGENTS.md` / this file | Operating manual. |
| 4 | Other `.ai/*.md` | Domain rules (coding, testing, release, ...). |
| 5 | `docs/**` | Descriptive documentation. Informative, not normative. |

## Rule ID scheme

Every normative rule has a stable ID. Reference IDs in commits, PRs, and reviews
(e.g. "Rejected: violates GR-002").

| Prefix | File | Domain |
|--------|------|--------|
| GR- | guardrails.md | Absolute prohibitions |
| SEC- | security.md | Security |
| ARC- | architecture.md | Architecture |
| COD- | coding-rules.md | Coding |
| TST- | testing.md | Testing |
| REL- | release.md | Release |
| DOC- | documentation.md | Documentation |
| REV- | review-checklist.md | Review |
| WF- | workflow.md | Workflow |

Rule language follows RFC 2119: **MUST / MUST NOT** are binding, **SHOULD / SHOULD NOT**
require justification to deviate, **MAY** is optional.

## Reading protocol by task type

Read only what the task requires. Do not load all files for every task.

| Task | Read (in order) | Skill |
|------|-----------------|-------|
| Any task (baseline) | `CLAUDE.md`, guardrails.md | — |
| Requirements definition | mission.md, documentation.md | `.skills/requirements.skill.md` |
| New feature | workflow.md, architecture.md, coding-rules.md, testing.md | `.skills/feature.skill.md` |
| Bug fix | workflow.md, testing.md | `.skills/bugfix.skill.md` |
| Refactoring | architecture.md, coding-rules.md, testing.md | `.skills/refactor.skill.md` |
| Architecture change | architecture.md, decision-log.md, `docs/adr/` | `.skills/architecture.skill.md` |
| Security work | security.md, guardrails.md | `.skills/security.skill.md` |
| Writing tests | testing.md | `.skills/test.skill.md` |
| Documentation | documentation.md | `.skills/documentation.skill.md` |
| Code review | review-checklist.md | `.skills/review.skill.md` |
| Release | release.md, security.md | `.skills/release.skill.md` |

## File inventory

| File | Content |
|------|---------|
| [mission.md](mission.md) | Why this project exists; success criteria; AI's role |
| [architecture.md](architecture.md) | Structure, layers, dependency rules, module layout |
| [coding-rules.md](coding-rules.md) | Naming, style, error handling, dependency policy |
| [security.md](security.md) | Secrets, authN/Z, data handling, vulnerability response |
| [testing.md](testing.md) | Test pyramid, coverage gates, what to test |
| [release.md](release.md) | Versioning, release flow, pre-release gates |
| [documentation.md](documentation.md) | Doc standards and the doc-update matrix |
| [review-checklist.md](review-checklist.md) | 10-viewpoint AI review checklist |
| [decision-log.md](decision-log.md) | Append-only index of decisions (links to ADRs) |
| [guardrails.md](guardrails.md) | Absolute prohibitions with detection and alternatives |
| [workflow.md](workflow.md) | Task lifecycle: intake → design → implement → PR |

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

## Rule and file inventory

Every normative rule has a stable prefix. Reference rule IDs in commits, PRs, and reviews
(e.g. "Rejected: violates GR-002"). Support files without rules use `—`.

| File | Rule prefix | Content |
|------|-------------|---------|
| [README.md](README.md) | — | Authority, context acquisition, and task routing |
| [mission.md](mission.md) | — | Why this project exists; success criteria; AI's role |
| [guardrails.md](guardrails.md) | GR- | Absolute prohibitions with detection and alternatives |
| [security.md](security.md) | SEC- | Secrets, authN/Z, data handling, vulnerability response |
| [architecture.md](architecture.md) | ARC- | Structure, layers, dependency rules, module layout |
| [coding-rules.md](coding-rules.md) | COD- | Naming, style, error handling, dependency policy |
| [testing.md](testing.md) | TST- | Test pyramid, coverage gates, what to test |
| [release.md](release.md) | REL- | Versioning, release flow, pre-release gates |
| [documentation.md](documentation.md) | DOC- | Doc standards and the doc-update matrix |
| [project-document-maintenance.md](project-document-maintenance.md) | DOC- | Conditional handoff, roadmap, and root README maintenance rules |
| [review-checklist.md](review-checklist.md) | REV- | 10-viewpoint AI review checklist |
| [workflow.md](workflow.md) | WF- | Task lifecycle: intake → design → implement → PR |
| [decision-log.md](decision-log.md) | — | Append-only index of decisions (links to ADRs) |

Rule language follows RFC 2119: **MUST / MUST NOT** are binding, **SHOULD / SHOULD NOT**
require justification to deviate, **MAY** is optional.

## Universal AI prose rule

All AI-authored explanatory prose MUST follow
[DOC-002](documentation.md#doc-002-objective-structured-prose). This includes repository
documents, code comments, commit and pull-request text, issue updates, reviews, and
messages to users. In particular, agents must use literal wording by default and must not
use metaphorical language that does not materially improve technical understanding.

## Context acquisition protocol

Quality takes priority over context reduction
([ADR-0012](../docs/foundation/adr/0012-bound-context-acquisition-without-reducing-quality.md)).
Read every file selected by the baseline or task route completely. If its complete,
unchanged content remains available in the active task context, reuse it; after context
compaction or removal, read it again.

A route MUST name individual mandatory files, not a directory. For variable collections
such as ADRs, project documents, or module contracts:

1. inspect the collection index or file list without loading every body;
2. search titles, headings, frontmatter, decision-log lines, affected paths, symbols,
   module names, domain terms, and relevant glossary synonyms;
3. read every matching document completely; and
4. follow relevant links and complete supersession chains.

Broaden discovery and reading until uncertainty is resolved when no expected candidate
matches, authorities or terminology conflict, an index is missing or stale, the change
is cross-cutting or hard to reverse, or security-sensitive behavior is involved. Never
use a context budget to skip a relevant source, and never replace a normative source
with a generated summary.

## Reading protocol by task type

Read only what the task requires. Do not load all files for every task.

| Task | Read (in order) | Skill |
|------|-----------------|-------|
| Any task (baseline) | `CLAUDE.md`, guardrails.md, this file, `docs/development-handoff.md` when present | — |
| Requirements definition | mission.md, documentation.md | `.skills/requirements.skill.md` |
| New feature | workflow.md, architecture.md, coding-rules.md, testing.md | `.skills/feature.skill.md` |
| Bug fix | workflow.md, testing.md | `.skills/bugfix.skill.md` |
| Refactoring | architecture.md, coding-rules.md, testing.md | `.skills/refactor.skill.md` |
| Architecture change | architecture.md, foundation ADR index, project ADR index when present, then relevant decisions through bounded discovery | `.skills/architecture.skill.md` |
| Security work | security.md, `SECURITY.md` | `.skills/security.skill.md` |
| Writing tests | testing.md | `.skills/test.skill.md` |
| Documentation | documentation.md, foundation guide index, then the relevant guide through bounded discovery | `.skills/documentation.skill.md` |
| Code review | review-checklist.md | `.skills/review.skill.md` |
| Release | release.md, security.md | `.skills/release.skill.md` |

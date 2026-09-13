---
id: adr-0022
title: ADR-0022 — Integrate documented discovery and conditional TDD into existing task routes
status: accepted
updated: 2026-09-13
---

# ADR-0022: Integrate documented discovery and conditional TDD into existing task routes

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-09-13 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | Extends ADR-0012 and ADR-0017; supersedes none |

## Context

The requirements procedure already provides the useful behavior adapted from
`grill-me`: resolve material decisions through guided questions, investigate facts
instead of asking the human, and offer a recommended answer for correction. It does not
define an optional way to preserve confirmed terminology and consequential decisions
while that discovery is in progress.

The Foundation also requires tests for behavior changes and failing-first regression
tests for bugs. It does not consistently state three test-quality constraints across
feature work: exercise a stable observable seam, build one red/green behavior slice at
a time when test-driven development applies, and derive expected results independently
of the implementation.

The public Matt Pocock skills were evaluated at commit
`3cca18b368ae95cdbdebbff572ccafa662551015`. At that revision,
`grill-with-docs` delegates to separate grilling and domain-modeling skills,
`implement` delegates to TDD and code review, and TDD includes additional reference
documents. Importing that chain would duplicate existing Foundation procedures and
introduce another documentation convention through `CONTEXT.md`.

The change must preserve ADR-0012 context budgets, existing project document ownership,
the GR-022 human decision gate, and the current feature and bug-fix routes. It must not
make test-first work mandatory where no stable behavioral oracle exists.

## Options considered

### Option 1: Keep the current procedures

Continue using the requirements interview, documentation matrix, architecture skill,
and current testing policy without changes.

This adds no context or migration cost. Confirmed terminology can remain only in a
conversation, feature tests can be written in a horizontal batch, and an assertion can
repeat the implementation's calculation without an explicit policy rejecting it.

### Option 2: Import the upstream skill chain

Add `grill-with-docs`, its delegated skills, `implement`, TDD, and their supporting
documents using the upstream file layout.

This provides a recognizable external workflow. It duplicates requirements, feature,
architecture, review, and test responsibilities; adds cross-skill dependencies; creates
a competing `CONTEXT.md` namespace; increases routed context; and makes local behavior
depend on future upstream changes or a maintained fork.

### Option 3: Add standalone local discovery and TDD skills

Adapt the ideas into new vendor-neutral Foundation skills while retaining existing
procedures.

This keeps local ownership but creates overlapping routes. Agents would need to choose
between requirements and discovery, feature and implement, or testing and TDD. New
wrappers and inherited paths would also increase propagation and review work.

### Option 4: Extend existing procedures with bounded conditional behavior

Make confirmed-term capture an explicit part of requirements and architecture discovery,
using the existing glossary and ADR paths. Add conditional TDD rules to the existing
testing authority and feature, bug-fix, and test procedures. Do not add a new skill or
document namespace.

This preserves one route per task and limits context growth. It requires careful
applicability rules so documentation is not committed prematurely and TDD does not
become a universal ceremony.

## Decision

Adopt Option 4.

Requirements and architecture discovery MUST retain one-material-fork-at-a-time
questioning and MUST investigate repository facts before asking the human. When that
work establishes a new or changed canonical term, the applicable procedure MUST record
it at a bounded checkpoint after the human confirms both the term and its meaning. A
reusable Foundation term belongs in `docs/foundation/glossary.md`; a repository-specific
domain term belongs in `docs/glossary.md`, as DOC-030 already requires. Proposed,
contradictory, incidental, or unresolved vocabulary MUST NOT be written as established
terminology. The Foundation MUST NOT introduce `CONTEXT.md` or a second glossary
convention.

Every decision in GR-022's architectural scope MUST use the existing architecture
procedure regardless of reversibility or familiarity. For a decision outside GR-022,
the architecture procedure offers an ADR only when the choice is hard to reverse,
surprising without its context, and the result of a real trade-off; smaller durable
choices use COD-052 instead. Drafting an ADR does not authorize implementation, and
GR-022 human approval remains mandatory. Requirements discovery MUST NOT modify
implementation code or transition into feature work without a separate explicit
instruction.

Conditional TDD applies when the task defines concrete observable behavior, a stable
test seam exists or can be resolved without speculative architecture, and expected
results have an independent basis such as an accepted requirement, external standard,
known-good example, or invariant. Existing stable seams are selected by the agent. The
human is asked only when choosing a new seam would materially change the public design.

When conditional TDD applies, implementation SHOULD proceed as one behavior slice at a
time: demonstrate red for the intended reason, add the smallest complete behavior that
makes the slice green, then continue. Tests MUST exercise observable behavior through a
stable public boundary and MUST NOT compute the expected result through the same logic
as the implementation. While the relevant tests are green, local cleanup MAY restructure
only code introduced within the current behavior slice. Restructuring pre-existing code
or unrelated responsibilities remains a separate refactor PR under COD-021.

TDD is not required for documentation-only changes, mechanical configuration changes,
investigation, generated artifacts, or explicitly disposable prototypes. A task may
also use the existing test-after implementation path when no stable oracle or seam
exists; the PR states why when the behavior change would otherwise appear suitable for
TDD. GR-021 and all existing test gates still apply.

No standalone `implement`, documented-discovery, or TDD skill is added. Implementation
continues through the existing feature, bug-fix, refactor, and review procedures. The
Foundation uses original wording and does not copy or synchronize upstream skill files.

## Consequences

**Positive:** confirmed domain language and consequential decisions can survive the
conversation in existing authoritative locations; DOC-030 becomes explicit at the
discovery point; feature tests gain stronger failure signals; routing remains
unambiguous; and ordinary tasks do not load a new skill chain.

**Negative:** the requirements, architecture, and testing routes grow slightly;
determining whether a seam and independent oracle are stable requires judgment;
confirmed-term capture performs additional repository checks and writes; and strict
vertical cycles can take longer than a batch for some simple changes.

**Migration and rollback:** add the conditional clauses and focused contract tests in
one implementation PR. Measure context budgets and keep all existing task entry points.
Rollback removes those clauses and tests; no project document migration or external
dependency removal is required.

**Follow-ups:** implement and verify the changes under
[Issue #226](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/226), then
propagate the accepted Foundation files through the existing reviewed Template Sync
process.

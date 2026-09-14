---
name: architecture
description: Design or change structure, boundaries, or technology — always through an ADR
triggers: [new module, change boundaries, replace technology, redesign, public API shape, 設計変更, アーキテクチャ, ADR作成, モジュール追加]
reads: [.ai/architecture.md, docs/foundation/adr/README.md]
---

# Skill: Architecture Change

## Purpose
Make structural decisions deliberately: analyzed, recorded as an ADR, approved by a
human, then implemented incrementally.

## Inputs
- The forcing problem: what concrete pain or requirement makes the current structure
  insufficient? (No forcing problem → no architecture change; COD-051.)
- Current state: read `.ai/architecture.md`, affected `MODULE.md` files, and the
  foundation ADR index. Inspect `docs/adr/README.md` when present; otherwise list project
  ADR filenames and headings. Search `.ai/decision-log.md` and both ADR collections by
  affected path, symbol, module, domain term, and index scope. Read every match and
  supersession chain completely. Apply the broader fallback in `.ai/README.md` whenever
  relevance is uncertain (someone may have decided this before — superseding requires
  saying so).

## Process
1. Write the problem statement and constraints (performance, cost, team, compliance).
2. Confirm the bounded decision discovery above is complete, then identify 2–4 realistic
   options **including "do nothing"**. Prototype only if a
   critical unknown blocks comparison (timebox it).
3. Compare options against: simplicity, blast radius (ARC-020), reversibility,
   operational cost, security posture (GR-030), vendor lock-in.
4. At a bounded checkpoint, record a new canonical term only after the human confirms
   both the term and its meaning. Reusable Foundation terms belong in
   `docs/foundation/glossary.md`; project domain terms belong in `docs/glossary.md`.
   Leave proposed, contradictory, incidental, and unresolved vocabulary out.
5. Draft the ADR from `docs/foundation/templates/adr.md`: context, decision, consequences
   (including negative ones — an ADR without downsides is not credible).
6. Open the ADR as its own PR (or the first commit of the change PR). **Human approval
   of the ADR is the gate** (GR-022) — do not implement past it.
7. Implement incrementally: expand → migrate → contract. Every intermediate state green
   and releasable. Update `.ai/architecture.md`, MODULE.md files, `docs/architecture/`.
8. Append the decision to `.ai/decision-log.md`.

## Decision criteria
- **Is it architectural?** Every decision in GR-022's scope — layers, module
  boundaries, storage technology, public API shape, or cross-cutting patterns — MUST
  use this procedure regardless of reversibility or familiarity.
- **Smaller decision?** For a choice outside GR-022, use an ADR only when it is hard to
  reverse, surprising without its context, and the result of a real trade-off. When any
  condition is absent, use a COD-052 decision-log entry or why-comment instead.
- **Choosing between options**: prefer the one that is easiest to undo. When two are
  close, pick the one an unfamiliar agent can understand fastest.
- **Extract a service?** Only with a proven scaling/isolation need — modular monolith
  is the default (`.ai/architecture.md`).
- **Big rewrite?** Rejected by default. Strangler-fig migration or a very persuasive ADR.

## Outputs
- Accepted ADR in `docs/adr/` (numbered, statused).
- Implementation PR series, each within GR-020.
- Updated `.ai/architecture.md`, MODULE.md, `docs/architecture/`, decision log.

## Checklist
- [ ] Forcing problem stated; "do nothing" evaluated
- [ ] ADR approved by a human before implementation
- [ ] Consequences section lists real downsides and the migration/rollback path
- [ ] Every implementation step green and releasable (expand→migrate→contract)
- [ ] All architecture docs and MODULE.md files consistent with the new reality
- [ ] Confirmed canonical terms recorded in the appropriate glossary; unresolved terms omitted

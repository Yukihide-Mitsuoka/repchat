---
name: documentation
description: Create or maintain documentation optimized for AI readers
triggers: [write docs, update README, document API, stale docs, ADR writing help, ドキュメント作成, ドキュメント, ドキュメント更新, README更新]
reads: [.ai/documentation.md, docs/]
---

# Skill: Documentation

## Purpose
Produce documentation that lets an agent (or human) act correctly without asking —
current, unambiguous, in the right place, and no larger than needed.

## Inputs
- The trigger: doc-update matrix obligation (DOC-030), stale doc found (DOC-040), or an
  explicit documentation task.
- The authoritative source: the code/behavior being described. Verify claims against
  the code — never document from memory or assumption (GR-042).

## Process
1. Locate the correct home using the inventory (DOC-010). One fact, one place — if the
   fact exists elsewhere, link to it instead of restating (DOC-001).
2. Check the doc type's own README for structure and update triggers; follow it.
3. Write for a reader with zero conversation context: purpose first, frontmatter set,
   tables/lists over prose, absolute dates, runnable examples with fake credentials.
4. For APIs: document contract (inputs, outputs, errors, auth) not implementation;
   keep OpenAPI/schema files as the source, prose as commentary.
5. Verify every command/example by running it; every link by resolving it.
6. Delete or fix anything you found stale along the way (DOC-040) — in the same PR if
   small, else file an issue.
7. `docs:` PR, or fold into the change PR when fulfilling DOC-030.

## Decision criteria
- **Where?** Binding rule → `.ai/` (requires careful review). Decision → ADR.
  Description of the system → `docs/`. Module contract → MODULE.md. Front door → README.
- **How long?** As short as completeness allows. If a section needs >2 screens,
  split by reader task, not by topic.
- **Diagram?** Use Mermaid in Markdown (renders on GitHub, diffable, AI-writable) —
  never binary images for structural diagrams.
- **Doc contradicts code?** Behavior → trust code; intent → trust doc; then fix the
  wrong one and note it (DOC-040).

## Outputs
- Updated/created docs in the correct location, links resolving, examples verified.
- Removed stale content (or issues filed for larger cleanups).

## Checklist
- [ ] Facts verified against code; commands and links tested
- [ ] One-fact-one-place respected; no near-duplicate content created
- [ ] Frontmatter, structure, and style per DOC-001
- [ ] Doc-update matrix fully satisfied for the triggering change
- [ ] An agent with no context could act on this doc alone

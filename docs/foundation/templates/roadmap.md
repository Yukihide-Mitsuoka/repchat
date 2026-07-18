---
id: roadmap-template
title: Roadmap — {{PROJECT_NAME}}
updated: {{YYYY-MM-DD}}
---

# Roadmap

<!--
  FOUNDATION TEMPLATE. Copy to docs/roadmap.md, replace every {{...}}, and delete this
  guidance comment. After template instantiation, translate every heading and fill the
  project-specific document in Japanese unless the repository owner or an external
  contract explicitly requires another language. Keep this template in English
  (ADR-0005).
-->

Direction and sequencing. Agents use this to judge whether a proposed change aligns
with where the project is going (mission.md success criteria) — not as a work queue
(that's GitHub issues/milestones).

**Update triggers:** milestone completed, priorities re-ordered, scope added/dropped.
Keep `updated:` current; stale roadmaps mislead agents (DOC-040).

## Now (current milestone)

<!-- TEMPLATE: 1-3 outcomes being pursued right now, each linking a GitHub milestone.
- Outcome: ... (milestone: ...)  -->

## Next (1-2 milestones out)

<!-- Committed direction, not yet started. -->

## Later (intended, not committed)

<!-- Direction only. Agents MUST NOT build ahead for "Later" items (COD-051). -->

## Explicitly not planned

<!-- Rejected scope, with the reason or ADR link — prevents agents and contributors
     from re-proposing settled questions. -->

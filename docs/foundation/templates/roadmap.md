---
id: roadmap-template
title: Roadmap — {{PROJECT_NAME}}
updated: {{YYYY-MM-DD}}
last_reviewed: {{YYYY-MM-DD}}
review_cadence: weekly-while-active
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
with where the project is going (mission.md success criteria). GitHub issues and
milestones own the work queue and detailed completion checklists (DOC-013).

**Update triggers:** milestone completed, priorities re-ordered, scope added/dropped.
Review weekly while active unless this repository declares another cadence. Reconcile
linked milestone and checklist status at every review. Keep `last_reviewed:` current;
update `updated:` only when roadmap content changes. Stale roadmaps mislead agents
(DOC-040).

## Now (current milestone)

<!-- TEMPLATE: 1-3 outcomes being pursued right now. Each outcome links to the GitHub
milestone or tracking issue that owns its explicit completion checklist.

- Outcome: {{measurable result}}
  - Tracking and completion checklist: {{milestone or issue link}}
  - Completion evidence: {{link when complete, otherwise "pending"}}
-->

## Next (1-2 milestones out)

<!-- Committed direction, not yet started. -->

## Later (intended, not committed)

<!-- Direction only. Agents MUST NOT build ahead for "Later" items (COD-051). -->

## Recently completed

<!-- Keep milestone-level outcomes only, with an absolute completion date and evidence
link. Detailed completed tasks remain in GitHub and release records. Remove entries when
they no longer help roadmap decisions.

| Completed | Outcome | Evidence |
|-----------|---------|----------|
| {{YYYY-MM-DD}} | {{outcome}} | {{milestone, PR, release, or verification link}} |
-->

## Explicitly not planned

<!-- Rejected scope, with the reason or ADR link — prevents agents and contributors
     from re-proposing settled questions. -->

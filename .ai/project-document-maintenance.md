---
id: project-document-maintenance
title: Project Document Maintenance Rules
authority: 4
read_when: [development-handoff, roadmap, root-readme, onboarding, inheritance]
---

# Project Document Maintenance Rules

This authority defines conditional maintenance behavior for project state, direction,
and repository README ownership. Read it completely when
[`.ai/documentation.md`](documentation.md) routes the task here.

## DOC-012: Development handoff snapshot

An active project whose work continues across sessions or agents SHOULD maintain the
project-wide singleton `docs/development-handoff.md` from the foundation template
([ADR-0010](../docs/foundation/adr/0010-separate-roadmap-work-tracking-and-handoff.md)).
Every agent MUST read it during task intake when it exists.

The handoff MUST contain only information needed to resume safely: active issue and pull
request links, lifecycle phase, material progress since the previous handoff, blockers,
ordered next actions, last verified baseline and results, and required reading. GitHub
issues and milestones remain authoritative for task status and checklists; the roadmap
owns direction; ADRs and the decision log own durable decisions. Link to those sources
instead of copying their histories (DOC-001).

Update the handoff before transferring work and whenever the active issue, pull request,
blocker, next action, or verified baseline materially changes. Remove completed detail
once it no longer affects the next action. If the project stops maintaining the handoff,
delete it rather than leave a stale restart instruction (DOC-040).

## DOC-013: Roadmap completion and review

`docs/roadmap.md` MUST describe direction and milestone outcomes, not duplicate the live
task queue. Each current outcome SHOULD link to a GitHub milestone or tracking issue with
an explicit completion checklist. During active development, the repository SHOULD
declare and follow a review cadence; use weekly when no project-specific cadence is set.

At each review:

- reconcile roadmap outcomes with the linked issue or milestone status;
- record completed outcomes with an absolute completion date and evidence link;
- re-sequence `Now`, `Next`, and `Later` when priorities changed;
- remove stale or duplicated task detail; and
- update `last_reviewed` even when direction did not change, and `updated` when it did.

Also review immediately when a milestone completes or project scope, priority, or
direction changes. Detailed completed-task history remains in GitHub and release records.

## DOC-014: Root README ownership

The root `README.md` MUST describe the current repository and MUST contain exactly one
ownership marker:

```html
<!-- repository-readme-owner: owner/repository -->
```

The marker MUST match the current GitHub repository. When an agent reads or changes the
root README, onboarding documentation, or inheritance configuration, it MUST inspect
both the marker and the README subject. If either identifies an ancestor, the agent MUST
preserve the inherited README before replacing the root file.

Preserve each ancestor at
`docs/inheritance/readmes/<owner>/<repository>.md`, using lowercase path components.
The archive MUST retain the source language and substantive content, repair relative
links for its new location, and record `source-repository` plus the exact 40-character
`source-commit` in YAML frontmatter. If the commit cannot be established from inheritance
provenance, record `unknown`; never invent it (GR-042). Review an existing archive before
replacement and never discard a different ancestor version silently.

New repositories MUST establish current ownership during initialization. Existing
repositories migrate when the inspection trigger above exposes a mismatch. Repair it in
the same PR when the change remains within GR-020; otherwise open a migration issue.
Archived READMEs are historical records: agents MUST NOT load
`docs/inheritance/readmes/**` during routine intake or general documentation discovery.
Read a snapshot only while migrating or reviewing root README ownership, or when tracing
inheritance provenance. The local ownership audit examines only the marker for ownership
purposes and sends no README content to an AI.

[ADR-0011](../docs/foundation/adr/0011-own-the-root-readme-in-the-current-repository.md)
defines the rationale and migration boundary.

---
id: project-documentation-guide
title: Project Documentation Guide
---

# Project Documentation Guide

This guide defines where an instantiated repository stores project-owned documentation.
Binding rules live in [`.ai/`](../../../.ai/); inherited decisions live in the
[foundation ADRs](../adr/), project decisions live in `docs/adr/`, and writing rules live in
[`.ai/documentation.md`](../../../.ai/documentation.md).

| Directory | Content | Primary reader task |
|-----------|---------|---------------------|
| [docs/foundation/adr/](../adr/) | Synchronized foundation Architecture Decision Records (**normative** when accepted) | "why does the inherited foundation work this way?" |
| `docs/adr/` | Project Architecture Decision Records (**normative** when accepted) | "why is this project built this way?" |
| [docs/foundation/](../) | Synchronized foundation-owned guidance and document templates | use inherited documentation support |
| `docs/requirements.md`, `docs/requirements/` | Project-owned whole-project and initiative requirements | determine what must be built and why |
| `docs/architecture/` | System structure, C4 diagrams, data flows | understand before changing structure |
| `docs/domain/` | Domain model, bounded contexts, ubiquitous language | understand the business rules |
| `docs/api/` | API contracts (OpenAPI/schema + commentary) | integrate with or change an API |
| `docs/deployment/` | Environments, deploy procedure, configuration | ship it |
| `docs/operations/` | Monitoring, alerts, SLOs, maintenance | keep it running |
| `docs/runbook/` | Step-by-step incident/ops procedures | 3am emergency |
| `docs/troubleshooting/` | Known failure modes → diagnosis → fix | "it's broken, what now?" |
| `docs/roadmap.md` | Direction and planned milestones | prioritize work |
| `docs/glossary.md` | Project ubiquitous language dictionary | name things correctly |

Contribution guide: [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## Choose a project-owned path by scope

Use the singleton-and-collection rule from DOC-011 and
[ADR-0009](../adr/0009-place-project-document-singletons-and-collections.md):

| Question | Placement |
|----------|-----------|
| Is this the one authoritative document for the whole project? | `docs/<category>.md` |
| Can independently maintained documents repeat by initiative, component, audience, or operational subject? | `docs/<category>/<subject>.md` |
| Are both scopes needed? | Keep both; the singleton links to the subject documents without copying their facts |

For requirements, the resulting structure is:

```text
docs/
├── requirements.md
└── requirements/
    ├── account-recovery.md
    └── subscription-billing.md
```

`docs/requirements.md` owns the project purpose, overall scope, cross-initiative
constraints, and project-wide success criteria. Each file below `docs/requirements/`
owns requirements and acceptance criteria that can be reviewed independently for its
named initiative. The whole-project document links to those files and does not restate
their details.

This pairing is not required for every category. Keep unique cross-project documents
such as `docs/roadmap.md` and `docs/glossary.md` at the top level. Use categorized paths
such as `docs/architecture/data-flow.md` and `docs/runbook/credential-rotation.md` for
repeatable or task-specific documents. Do not add an empty directory or local index in
anticipation of future content.

The guides in this directory define structure and **update triggers** without placing
foundation-owned README files in project-owned paths. The doc-update matrix (DOC-030)
tells you which project directory a given change must touch.

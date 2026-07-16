---
id: docs-templates-index
title: Document Templates
---

# docs/templates/ — Document Templates

Reusable skeletons for standard project documents. Copy a template out of this directory,
fill it, and delete the guidance comments. Each template names the skill that drives it.

| Template | Produces | Driven by |
|----------|----------|-----------|
| [requirements.md](requirements.md) | A requirements definition document | [.skills/requirements.skill.md](../../.skills/requirements.skill.md) |

Templates follow the documentation rules ([.ai/documentation.md](../../.ai/documentation.md)),
especially the writing style in DOC-002. Fill instances in the project's working language;
the template files themselves stay in English (ADR-0002).

**Update trigger:** add a row here whenever a new template lands in this directory.

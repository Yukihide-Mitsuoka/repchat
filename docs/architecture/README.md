---
id: architecture-docs
title: Architecture Documentation
---

# Architecture Documentation

Describes the system as built. The *rules* live in [.ai/architecture.md](../../.ai/architecture.md);
decisions in [../adr/](../adr/). If this directory contradicts either, this directory is wrong.

**Update triggers (DOC-030):** new module, changed module boundary, new external
dependency/integration, changed data flow, new infrastructure component.

## Structure (create these files as the system grows)

| File | Content | Format |
|------|---------|--------|
| `c4-context.md` | System in its environment: users, external systems | Mermaid C4/flowchart |
| `c4-container.md` | Deployable units and their interactions | Mermaid |
| `modules.md` | Bounded-context map: every `src/modules/*` + one-line purpose + dependencies between them | Mermaid + table |
| `data-flow.md` | How data moves for the 3–5 most important flows | Mermaid sequence |
| `infrastructure.md` | Runtime topology: compute, storage, network | Mermaid + table |

## Conventions

- Diagrams are **Mermaid in Markdown** — diffable, renderable on GitHub, writable by
  agents. No binary diagram files (DOC-001).
- Every diagram is followed by a prose paragraph stating what an agent should conclude
  from it (diagrams alone are ambiguous).
- Module-level detail belongs in each module's `MODULE.md`, not here — here is the map,
  there is the territory.

<!-- TEMPLATE: this directory starts empty except this README. Create modules.md with
     the first real module. -->

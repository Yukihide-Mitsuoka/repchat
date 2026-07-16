---
id: domain-docs
title: Domain Model Documentation
---

# Domain Model

The business reality the software models (DDD). Source of the ubiquitous language —
code names MUST match terms defined here and in [../glossary.md](../glossary.md) (COD-002).

**Update triggers (DOC-030):** new domain concept, changed business rule, new bounded
context, changed context relationships, PII-bearing entity added (also SEC-011).

## Structure

| File | Content |
|------|---------|
| `context-map.md` | Bounded contexts and their relationships (partnership, customer-supplier, ACL...) — Mermaid |
| `<context>.md` | Per context: core entities, value objects, aggregates, invariants, domain events, state machines |

## Per-context file template

```markdown
---
id: domain-<context>
title: <Context> Domain
---

# <Context>

Purpose: <one paragraph — what business capability this context owns>

## Aggregates
| Aggregate | Root entity | Invariants (MUST always hold) |
|-----------|-------------|-------------------------------|

## Value objects
| Name | Definition | Validation rules |

## Domain events
| Event | Emitted when | Consumed by |

## Business rules
Numbered, testable statements. Each rule should map to at least one test (TST-002).

## Data classification (SEC-011)
| Entity/field | Class (Secret/PII/Internal/Public) | Handling notes |
```

<!-- TEMPLATE: create context-map.md with the first bounded context. -->

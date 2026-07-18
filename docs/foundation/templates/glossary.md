---
id: glossary-template
title: Glossary — {{PROJECT_NAME}}
updated: {{YYYY-MM-DD}}
---

<!--
  FOUNDATION TEMPLATE. Copy to docs/glossary.md, replace every {{...}}, and delete this
  guidance comment. After template instantiation, translate the headings and fill the
  project-specific document in Japanese unless the repository owner or an external
  contract explicitly requires another language. Keep this template in English
  (ADR-0005).
-->

# Glossary

The project-specific ubiquitous language. Code identifiers, documentation, and
conversation use one term per concept under COD-002. Check the reusable terms in
`docs/foundation/glossary.md` before adding a project term.

## Terms

| Term | Definition | Context | Avoid | Not to be confused with |
|------|------------|---------|-------|--------------------------|
| {{TERM}} | {{ONE_SENTENCE_DEFINITION}} | {{BOUNDED_CONTEXT}} | {{BANNED_SYNONYMS_OR_DASH}} | {{DISTINCTION_OR_DASH}} |

## Resolved ambiguities

Append-only log of naming collisions and their resolution: one word carrying two
meanings, or two words carrying one meaning. Move the surviving term into the table.

<!--
- "{{AMBIGUOUS_TERM}}" meant {{MEANING_A}} and {{MEANING_B}}; resolved
  {{YYYY-MM-DD}}: use "{{TERM_A}}" and "{{TERM_B}}".
-->

*None yet.*

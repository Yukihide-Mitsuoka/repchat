---
id: documentation
title: Documentation Rules
authority: 4
read_when: [documentation, feature, review]
---

# Documentation Rules

Documentation is code (Documentation as Code): versioned, reviewed in PRs, checked in CI,
and **optimized for AI readers** — explicit, structured, unambiguous.

## DOC-001: Writing style for AI readers

- One fact in one place; link (`[text](path)`) instead of repeating. Duplication causes
  contradiction drift.
- Match form to content: use tables and nested lists actively where the content is
  genuinely structured (comparisons, enumerations, mappings) and a table fits, and keep
  prose for reasoning; the caveat is overuse, not use — do not tabulate where a table does
  not fit (DOC-002). Absolute dates ("2026-07-02"), never "recently".
- Every doc starts with YAML frontmatter (`id`, `title`, plus `status`/`updated` where
  meaningful) and states its purpose in the first paragraph.
- Concrete examples for every rule or API. Fake credentials only (GR-002).
- English for all `.ai/` and `docs/` content (ADR-0002); user-facing docs may add
  localized versions as siblings (`README.ja.md`).
- Files use kebab-case names; headings form a strict hierarchy (one `#`, then `##`...).

## DOC-002: Objective, structured prose

Governs all prose in `.ai/` and `docs/`. `.skills/requirements.skill.md` and
`docs/templates/requirements.md` build on this rule.

- **Objective basis.** State each claim with its basis — a measurement, a cited source, a
  standard, or explicit reasoning. Separate established fact, inference, and open
  question; never present an impression as a conclusion.
- **No metaphor or decoration.** Name the thing directly. No analogies, no filler
  intensifiers ("powerful", "seamless"), no softening ("just", "simply", "a bit").
- **Conclusion first.** State the result, then its support. Remove roundabout lead-ins.
- **Structure carries meaning.** Semantic hierarchy → heading depth and nested-list
  indentation (as code uses indentation). Structured data (comparisons, attribute sets,
  mappings) → tables: use one actively wherever the content is genuinely structured and a
  table fits. The caveat is overuse, not use — do not tabulate where a table does not fit
  (a one-row table, or a table that restates a single sentence, is prose). Match the form
  to the content.
- **Define once, reference after.** Each term, assumption, and constraint is defined a
  single time, in a dedicated section near the top, then referenced by name. Restating a
  definition is a defect (this is DOC-001 applied to prose).

## DOC-010: Document inventory and ownership

| Location | Content | Normative? |
|----------|---------|-----------|
| `.ai/` | rules for agents | yes (authority table) |
| `CLAUDE.md`, `AGENTS.md` | agent entry points | yes |
| `docs/adr/` | decisions with context | yes (accepted ADRs) |
| `docs/architecture/` | diagrams, flows, C4 | descriptive |
| `docs/domain/` | domain model, ubiquitous language | descriptive |
| `docs/api/` | API contracts (OpenAPI etc.) | contract |
| `docs/deployment/`, `docs/operations/`, `docs/runbook/`, `docs/troubleshooting/` | ops | descriptive |
| `src/modules/*/MODULE.md` | module contracts | yes |
| `README.md` | project front door | descriptive |

## DOC-030: Doc-update matrix (binding — GR-024)

When a PR contains a change of type X, it MUST update the docs listed:

| Change | Must update |
|--------|-------------|
| New/changed public API | `docs/api/`, MODULE.md, README if user-facing |
| New module / boundary change | `docs/architecture/`, MODULE.md, ADR |
| New env var / config | `.env.example`, `docs/deployment/` |
| New dependency | PR justification (GR-023); `docs/architecture/` if structural |
| Behavior change visible to users | README, CHANGELOG (via commit type) |
| New error state / failure mode | `docs/troubleshooting/`, `docs/runbook/` if ops action needed |
| New domain term | `docs/glossary.md` |
| Decision that constrains the future | ADR + `.ai/decision-log.md` |
| Change to how AI should behave | `.ai/*` (via reviewed PR) |

## DOC-040: Freshness protocol

- If you read a doc that contradicts the code: the code is usually truth for *behavior*,
  the doc for *intent*. Investigate, fix the wrong one in the current PR, note it.
- Docs describing removed features are deleted, not marked "deprecated" forever.
- Each `docs/**/README.md` lists its own update triggers; obey them.

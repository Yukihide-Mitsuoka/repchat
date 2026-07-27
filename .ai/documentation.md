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
- Foundation-owned instructions and documentation remain English. The only Japanese
  foundation-document exceptions are the descriptive, human-facing
  `docs/foundation/guides/usage.ja.md` and
  `docs/foundation/guides/ai-instruction-files.ja.md`; they never override their English
  authorities, and another exception requires a superseding ADR (ADR-0008). After
  template instantiation, AI agents MUST write new project-specific documents under
  `docs/` in Japanese unless the repository owner or an external contract explicitly
  requires another language. Do not create another translated sibling solely to
  duplicate the same facts (ADR-0005).
- Files use kebab-case names; headings form a strict hierarchy (one `#`, then `##`...).

## DOC-002: Objective, structured prose

Governs all prose in `.ai/` and `docs/`. `.skills/requirements.skill.md` and
`docs/foundation/templates/requirements.md` build on this rule.

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
| `docs/foundation/adr/` | synchronized foundation decisions with context | yes (accepted ADRs) |
| `docs/foundation/` | other synchronized foundation-owned guidance and document templates | descriptive |
| `docs/adr/` | repository-specific decisions with context | yes (accepted ADRs) |
| `docs/requirements.md`, `docs/requirements/` | whole-project and initiative requirements | contract |
| `docs/glossary.md` | project-specific ubiquitous language | descriptive |
| `docs/roadmap.md` | project direction and sequencing | descriptive |
| `docs/architecture/` | diagrams, flows, C4 | descriptive |
| `docs/domain/` | domain model, ubiquitous language | descriptive |
| `docs/api/` | API contracts (OpenAPI etc.) | contract |
| `docs/deployment/`, `docs/operations/`, `docs/runbook/`, `docs/troubleshooting/` | ops | descriptive |
| `src/modules/*/MODULE.md` | module contracts | yes |
| `README.md` | project front door | descriptive |

The structure and update triggers for project-owned `docs/` paths are defined once in
[`docs/foundation/guides/`](../docs/foundation/guides/). A project-owned documentation
directory MUST NOT contain a foundation-owned placeholder README. A repository MAY add
a local README only when it describes actual project content and is maintained by that
repository.

## DOC-011: Project document singleton and collection placement

Choose a project-owned path by document scope
([ADR-0009](../docs/foundation/adr/0009-place-project-document-singletons-and-collections.md)):

| Scope | Required path | Example |
|-------|---------------|---------|
| One authoritative project-wide document | `docs/<category>.md` | `docs/requirements.md` |
| Independently maintained documents that repeat by subject | `docs/<category>/<subject>.md` | `docs/requirements/account-recovery.md` |
| Both project-wide and subject scopes | Use both paths, with distinct ownership | `docs/requirements.md` and `docs/requirements/account-recovery.md` |

The project-wide singleton MUST own cross-subject facts and link to narrower documents.
A subject document MUST own only its narrower facts. Authors MUST NOT repeat the same
fact between the singleton and collection (DOC-001). Create a project-owned directory or
local index only when it contains actual maintained project content; do not create empty
scaffolding or a foundation-owned placeholder in a project namespace.

## DOC-030: Doc-update matrix (binding — GR-024)

When a PR contains a change of type X, it MUST update the docs listed:

| Change | Must update |
|--------|-------------|
| New/changed project or initiative requirements | `docs/requirements.md` or `docs/requirements/<initiative>.md` |
| New/changed public API | `docs/api/`, MODULE.md, README if user-facing |
| New module / boundary change | `docs/architecture/`, MODULE.md, ADR |
| New env var / config | `.env.example`, `docs/deployment/` |
| New dependency | PR justification (GR-023); `docs/architecture/` if structural |
| Behavior change visible to users | README, CHANGELOG (via commit type) |
| New error state / failure mode | `docs/troubleshooting/`, `docs/runbook/` if ops action needed |
| New or changed reusable foundation term | `docs/foundation/glossary.md` |
| New domain term | `docs/glossary.md` |
| Decision that constrains the future | ADR + `.ai/decision-log.md` |
| Change to how AI should behave | `.ai/*` (via reviewed PR) |

## DOC-040: Freshness protocol

- If you read a doc that contradicts the code: the code is usually truth for *behavior*,
  the doc for *intent*. Investigate, fix the wrong one in the current PR, note it.
- Docs describing removed features are deleted, not marked "deprecated" forever.
- Use the matching `docs/foundation/guides/` entry for directory structure and update
  triggers. If a repository adds a project-owned README, obey its additional local
  triggers as well.

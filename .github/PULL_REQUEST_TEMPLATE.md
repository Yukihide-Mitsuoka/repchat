<!-- Title must be a Conventional Commit: type(scope): summary — it becomes the squash commit. -->

## What & why

<!-- 2-5 sentences: the change and the reason. Link the issue. -->

Refs: #

## Change classification (ARC-020)

- [ ] Local (inside one module, contract unchanged)
- [ ] Contract (MODULE.md public API / event changed — consumers updated in this PR)
- [ ] Architectural (ADR required — link: )

## Breaking change?

- [ ] No
- [ ] Yes — commit carries `!` + `BREAKING CHANGE:` footer; migration notes: <!-- link/inline -->

## Testing (GR-021 / TST-002)

<!-- What is covered, at which pyramid level. For bug fixes: link the failing-first regression test commit. -->

- How verified: <!-- paste the essential `make test` result -->
- Not verified (be honest — GR-042): <!-- e.g. "not tested on Windows" / "none" -->

## Dependencies (GR-023 / COD-040) — delete section if none added/upgraded-major

| Package | Purpose | Alternatives considered | License | Maintenance signal |
|---------|---------|------------------------|---------|--------------------|
|         |         |                        |         |                    |

## Documentation (DOC-030)

- [ ] Doc-update matrix checked; updated: <!-- list files, or "n/a — no matrix trigger" -->

## AI disclosure

- [ ] Authored by AI agent: <!-- agent/model name --> — self-review against `.ai/review-checklist.md` completed
- [ ] Authored by human
- Prompts/context notes (optional, helps reviewers):

## Self-review checklist (WF-090)

- [ ] `make format && make lint && make test` green — output reported above
- [ ] Diff within size limits (GR-020) and contains no unrelated changes
- [ ] No guardrail violated (`.ai/guardrails.md`)

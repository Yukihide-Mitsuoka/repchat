# Contributing

This project is developed **AI-first**: AI agents implement, humans direct and review.
The same rules bind both.

## Quick start (human or AI)

1. Read [CLAUDE.md](CLAUDE.md) — the operating manual (vendor-neutral despite the name;
   non-Claude agents enter via [AGENTS.md](AGENTS.md)).
2. Run `make setup`, then `pre-commit install --hook-type pre-commit --hook-type pre-push`.
3. Pick/create a GitHub issue; claim it (assign yourself / `status:in-progress` label).
4. Branch `<type>/<issue>-<slug>` → implement with tests → PR using the template.

## Non-negotiables

- All changes via PR; `main` is protected (GR-010).
- Conventional Commits (WF-020) — they drive versioning and changelog.
- Tests and docs land in the same PR as the code (GR-021, GR-024).
- PRs stay small (GR-020).
- The full prohibition list: [.ai/guardrails.md](.ai/guardrails.md).

## Review

Every PR needs one approving review against
[.ai/review-checklist.md](.ai/review-checklist.md). AI-generated changes must be
disclosed in the PR (template block) and receive human review before merge.

## Security

Never report vulnerabilities in public issues — see [SECURITY.md](SECURITY.md).

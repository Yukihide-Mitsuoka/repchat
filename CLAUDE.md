# CLAUDE.md — AI Agent Operating Manual

Binding vendor-neutral manual. Every agent reads it completely at task start;
`AGENTS.md` maps runtime-specific capabilities.

Authority: guardrails > security > this file and `AGENTS.md` > other `.ai/` rules >
`docs/`. Apply the higher authority and report every conflict.

## 1. Repository overview

| Field | Value |
|-------|-------|
| Project | RepChat — see [.ai/mission.md](.ai/mission.md) |
| Stack | TypeScript/Node (Evidence + edge gate + MCP server) · Python (NL→SQL, spikes) · Postgres+RLS (Neon planned) · Vertex AI Gemini — details in [.ai/architecture.md](.ai/architecture.md) |
| Architecture | Modular monolith, Clean Architecture, DDD — [.ai/architecture.md](.ai/architecture.md) |
| Branching | GitHub Flow; `main` always releasable |
| Versioning | SemVer via Conventional Commits (automated) |

## 2. Start every task

1. Read [`.ai/guardrails.md`](.ai/guardrails.md) completely.
2. Read the task router and context acquisition protocol in
   [`.ai/README.md`](.ai/README.md) completely.
3. Read `docs/development-handoff.md` completely when it exists.
4. Select the task type, then read every routed rule and the matching `.skills/` file
   completely.

Do not recursively load a routed directory. Use the bounded discovery and broader
fallback in `.ai/README.md`, then read every selected source completely. Reuse a complete,
unchanged source already present in active context; reread it after context compaction.

## 3. Change protocol

- Use one issue, one task branch, and a reviewed PR. Task routes that change
  implementation load the complete lifecycle in [`.ai/workflow.md`](.ai/workflow.md).
- Code, tests, and required documentation land in the same PR. Architectural changes
  require an approved ADR first.
- Use the pull-request template completely. PR titles and commits follow Conventional
  Commits; squash merge keeps `main` releasable.
- Before opening a PR, perform the self-review in
  [`.ai/review-checklist.md`](.ai/review-checklist.md).
- Guardrails remain absolute, including no direct push to `main`, no check bypass, no
  fabricated results, and no destructive operation without specific approval.

<!-- Sections 11–14 retain stable numbers because repository rules link to them. -->

## 11. Canonical commands

All automation (you, hooks, CI) uses only these entry points — never call project
tooling directly, so commands stay stable across stacks:

```
make setup   make format   make lint   make test   make test-unit
make test-integration   make coverage   make build   make run
make security-scan   make sbom   make clean   make doctor
```

The full binding target contract (semantics of each) is in
[profiles/README.md](profiles/README.md).

Implementations live in the Makefile; on a fresh template they are no-op placeholders.

## 12. Claude Code integration

Claude Code MUST read [`.claude/README.md`](.claude/README.md) completely and follow its
runtime-specific integration requirements. Other runtimes apply equivalent controls as
mapped in `AGENTS.md` and do not load the Claude-specific file.

## 13. Escalation

Stop and ask a human when:

- rules conflict or a guardrail blocks the request;
- an architectural change lacks an approved ADR;
- authentication, payments, personal-data schema, data deletion, production
  configuration, or spending money is involved;
- ambiguity permits materially different implementations; or
- the same failing approach would be attempted a third time.

Report the context, options, recommendation, and specific required decision. Otherwise,
decide, act, and record the reasoning (COD-052).

## 14. Definition of done

WF-090 is authoritative: acceptance criteria met, tests green, lint clean, documentation
current, self-review complete, PR complete with green CI, and no guardrail violated.
Report exactly what was and was not verified.

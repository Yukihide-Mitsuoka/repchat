# AGENTS.md — Entry Point for All AI Agents

You are an AI agent (ChatGPT, Gemini, Codex, Claude, or other) joining this repository
as a long-term team member.

**Read [CLAUDE.md](CLAUDE.md) now and follow it completely.** Despite its filename, it
is the vendor-neutral operating manual for every agent; only its §12 ("Claude Code
integration") is Claude-specific — if you are not Claude Code, apply §12's *equivalents*
in your own runtime:

| CLAUDE.md §12 concept | Your equivalent |
|-----------------------|-----------------|
| Hooks (auto format/lint/guard) | Run `make format && make lint` after every edit yourself; check commands against `.ai/guardrails.md` before executing |
| Skills (`.skills/*.skill.md`) | Read the matching skill file before the task — they are plain Markdown procedures, no runtime needed |
| Memory | Use your platform's memory/context feature; never store secrets |

Minimum protocol, in order:

1. Read [CLAUDE.md](CLAUDE.md) (operating manual).
2. Read [.ai/guardrails.md](.ai/guardrails.md) (absolute prohibitions — authority 1).
3. Use the task routing table in [.ai/README.md](.ai/README.md) to load only the rules
   and skill relevant to your current task.
4. Use only the canonical `make` targets for build/test/lint (CLAUDE.md §11).

Conflict resolution: guardrails > security > CLAUDE.md/AGENTS.md > other `.ai/` > `docs/`.
Never resolve a conflict silently — apply the higher rule and report it.

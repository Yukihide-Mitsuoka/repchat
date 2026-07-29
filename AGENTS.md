# AGENTS.md — Entry Point for All AI Agents

**Read [CLAUDE.md](CLAUDE.md) completely and follow it before acting.** Only §12 is
Claude Code-specific; other runtimes map it as follows:

| CLAUDE.md §12 concept | Your equivalent |
|-----------------------|-----------------|
| Hooks | Run `make format && make lint` after each edit; check `.ai/guardrails.md` before commands |
| Skills | Read the matching `.skills/*.skill.md` completely |
| Memory | Use runtime context; never store secrets |

`CLAUDE.md` solely defines task intake, authority, routing, canonical commands, change
protocol, and conflict handling.

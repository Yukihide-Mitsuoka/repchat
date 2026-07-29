---
id: claude-code-integration
title: Claude Code Integration
---

# Claude Code Integration

Claude Code reads this file when routed here by `CLAUDE.md` §12. It defines only
runtime-specific integration requirements; the vendor-neutral operating contract remains
in `CLAUDE.md`, `.ai/`, and `.skills/`.

## Required integration

- Hooks in `.claude/settings.json` enforce the command guard and post-edit quality
  checks. Fix hook failures; never bypass them.
- `.skills/*.skill.md` is the vendor-neutral skill source. `.claude/skills/` contains
  only native wrappers. Follow the wrapper maintenance contract in
  [`.skills/README.md`](../.skills/README.md).
- Store only durable, non-derivable, non-secret facts in runtime memory.
- Follow WF-040 for subagents and parallel work: one task, one branch, one agent.

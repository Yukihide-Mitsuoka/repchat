# Dev Container

Runs Claude Code (and any other AI agent) **inside a container** instead of on the host.
This is a policy requirement, not a convenience: host credentials (`~/.ssh`,
`~/.config/gcloud`, `~/.gemini`) never enter the container, so an agent cannot read or
exfiltrate them even if instructed to.

## What you get

- Ubuntu 24.04 base, `vscode` unprivileged user.
- Node LTS + GitHub CLI (Node also runs RepChat).
- Claude Code installed on create (`npm install -g @anthropic-ai/claude-code`).
- Task v3.53.1 is installed from the [official npm package](https://taskfile.dev/docs/installation#npm).
- `task doctor` runs after installation to verify the template's guard hooks and invariants.

## Customize per stack

This is stack-agnostic on purpose. Before real work:

1. Add the project's required toolchain to `features` in `devcontainer.json`.
2. Drop features you do not need.
3. Do **not** add SSH-agent forwarding or cloud-credential mounts. Keeping host secrets
   out of the container is the reason this file exists.

## Authentication

Log in from inside the container: run `claude` and follow the prompt. Confirm you are on
the organization's Team plan with `/status` (personal plans are not permitted for work).

## Guardrails still apply

`.claude/settings.json` (permission deny-list) and `.claude/hooks/guard-bash.sh` (Bash
guard, incl. GR-003 blocks on `cat .env` / `printenv`) run inside the container exactly as
on the host — the container is defense in depth on top of them, not a replacement.

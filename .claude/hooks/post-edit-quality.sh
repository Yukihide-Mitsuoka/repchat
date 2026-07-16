#!/usr/bin/env bash
# PostToolUse hook: after any Edit/Write, format and lint the touched file via the
# canonical interface (CLAUDE.md §11). Non-blocking on template (targets are no-ops
# until a project wires them); lint failures are surfaced to the agent as feedback.
# Contract: hook JSON on stdin; exit 0 = ok; exit 2 = feed stderr back to the agent.

set -u

payload="$(cat)"
file_path=""
if command -v jq >/dev/null 2>&1; then
  file_path="$(echo "$payload" | jq -r '.tool_input.file_path // empty')"
fi
[ -z "$file_path" ] && exit 0

# Skip non-code artifacts to keep the loop fast.
case "$file_path" in
  *.md|*.txt|*.json|*.yml|*.yaml|*.toml|*.lock) exit 0 ;;
esac

command -v make >/dev/null 2>&1 || exit 0

make --no-print-directory format FILE="$file_path" >/dev/null 2>&1

lint_output="$(make --no-print-directory lint FILE="$file_path" 2>&1)"
if [ $? -ne 0 ]; then
  echo "Lint failed for $file_path (COD-001 — fix before proceeding):" >&2
  echo "$lint_output" | tail -n 30 >&2
  exit 2
fi

exit 0

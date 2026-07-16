#!/usr/bin/env bash
# Template self-check ("make doctor"): fast, dependency-free validation that the
# foundation's own metadata invariants hold. Automates what a manual/agent audit would
# otherwise catch. Exits non-zero on any violation. Add checks here as invariants grow.
#
# Currently verifies:
#   1. Every .ai/*.md and .skills/*.skill.md begins with a valid YAML frontmatter block
#      (`---` ... `---`) — the metadata the routing/authority system depends on.
#   2. No file carries the "collapsed frontmatter" signature a non-frontmatter-aware
#      formatter produces (guards against the LOG-0007 regression recurring).
#   3. GitHub governance inheritance rejects invalid or weakening policy.

set -u
cd "$(dirname "$0")/.." || exit 9

errors=0
err() { echo "  DOCTOR: $1"; errors=$((errors + 1)); }

# 1. Frontmatter present and closed in rule/skill files.
while IFS= read -r f; do
  first="$(head -n 1 "$f")"
  if [ "$first" != "---" ]; then
    err "$f: missing opening YAML frontmatter (first line is not '---')"
    continue
  fi
  # A closing --- must exist on lines 2..30.
  if ! tail -n +2 "$f" | head -n 30 | grep -qx -- '---'; then
    err "$f: opening '---' has no closing '---' in the first 30 lines"
  fi
done < <(find .ai .skills -type f -name '*.md' 2>/dev/null | sort)

# 2. Collapsed-frontmatter signature (what a frontmatter-unaware mdformat run produces:
#    the YAML keys mashed into a single heading like "## id: x title: y ...").
if grep -rlnE '^## (id|name): .+ (title|description): ' .ai .skills docs CLAUDE.md AGENTS.md 2>/dev/null; then
  err "^ file(s) above contain collapsed YAML frontmatter — run mdformat with mdformat-frontmatter (see LOG-0007)"
fi

# 3. Foundation-level governance policy contract tests (ADR-0003).
python3 -m unittest discover -s scripts/tests -p 'test_*.py' || err "GitHub governance policy tests failed"
python3 scripts/github_governance.py validate --root . >/dev/null || err "GitHub governance policy is invalid"

if [ "$errors" -eq 0 ]; then
  echo "doctor: OK — template invariants hold"
else
  echo "doctor: $errors problem(s) found"
fi
[ "$errors" -eq 0 ]

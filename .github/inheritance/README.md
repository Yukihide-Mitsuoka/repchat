---
id: template-inheritance-contract
title: Template Inheritance Contract
---

# Template Inheritance Contract

This directory defines the child-owned, direct-parent contract from [ADR-0004](../../docs/adr/0004-harden-multi-level-template-inheritance.md).
Validation and local history planning are read-only; materialization remains a follow-up.

## Schema version 1

`.github/inheritance/manifest.json` declares intent:

```json
{
  "schema_version": 1,
  "parent": {"repository": "acme/parent-template", "branch": "main"},
  "lock_file": ".github/inheritance/lock.json",
  "inherited_paths": [".ai/", "scripts/template_inheritance.py"],
  "protected_paths": [".gitignore", ".github/governance/repository.json", ".github/inheritance/lock.json", ".github/inheritance/manifest.json", ".github/workflows/template-sync.yml", ".templatesyncignore"]
}
```

The lock records the exact accepted parent commit:

```json
{"schema_version": 1, "parent": {"repository": "acme/parent-template", "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
```

An ownership root is either a literal file or a directory prefix ending in `/`. Globs,
absolute paths, traversal, `.git`, duplicates, and overlap within or across ownership
classes are invalid. Protected roots must cover the manifest, selected lock file,
`.gitignore`, `.templatesyncignore`, local governance policy, and sync workflow.

## Validate

```bash
python3 scripts/template_inheritance.py validate --root .
```

Exit `0` prints deterministic JSON; exit `2` reports invalid input on stderr. The command
performs no network request, file write, deletion, Git operation, or GitHub API call.

## Plan the next parent commit

```bash
python3 scripts/template_inheritance.py plan --root . --parent-root ../parent-template
```

`--parent-root` must be the top level of a local Git worktree whose credential-free
GitHub `origin` matches the manifest. The local `origin/<branch>` ref must already be
available. Plan never fetches, checks out, writes, deletes, or calls GitHub.

Plan verifies that the lock is on that ref's first-parent history and selects only the
commit immediately after it. The report classifies that commit's paths:

| Field | Meaning |
|-------|---------|
| `add` | Inherited parent file is absent in the child |
| `modify` | Inherited content or executable mode differs |
| `candidate_delete` | Parent removed an inherited file; no deletion is performed |
| `already_current` | Child already matches the candidate state |
| `protected` | Child-owned path is reported and skipped |
| `unowned` | Path is outside both ownership lists and is skipped |

Exit `0` prints the deterministic plan, including candidate and branch-head commits.
Exit `2` reports invalid metadata, parent identity/history, Git state, or child path.
See [template inheritance troubleshooting](../../docs/troubleshooting/template-inheritance.md).

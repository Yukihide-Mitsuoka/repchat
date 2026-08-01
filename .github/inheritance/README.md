---
id: template-inheritance-contract
title: Template Inheritance Contract
---

# Template Inheritance Contract

This directory defines the child-owned, direct-parent contract from
[ADR-0004](../../docs/foundation/adr/0004-harden-multi-level-template-inheritance.md)
and the bounded legacy transport from
[ADR-0007](../../docs/foundation/adr/0007-constrain-transitional-template-sync.md).
ADR-0014 adds ordered agent-contract validation. Validation and local history planning
are read-only; materialization remains a follow-up.

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

Schema version 1 remains valid during migration and has no agent profile.

## Schema version 2 agent profile

Manifest version 2 keeps the version 1 fields and requires the protected file
`.github/inheritance/agent-profile.json`:

```json
{
  "schema_version": 1,
  "authority_policy": "strengthen-only",
  "inputs": [
    {"layer": "foundation", "repository": "acme/ai-foundation", "path": ".ai/contracts/foundation/agent-entry.md"},
    {"layer": "template", "repository": "acme/stack-template", "path": ".ai/contracts/templates/acme/stack-template/agent-overlay.md"},
    {"layer": "project", "repository": "acme/product", "path": ".ai/project/agent-overlay.md"}
  ]
}
```

The loader order is exactly one foundation input, zero or more template inputs in
parent-to-child order, then exactly one project input. Foundation and template files
must be inherited; the project file and profile must be protected. Template paths are
owner-qualified, and the last template repository must be the direct parent unless the
foundation itself is the direct parent. Every reference is a bounded, existing,
non-symlink file. `strengthen-only` prohibits later layers from weakening foundation
MUST, guardrail, or security controls.

Validation proves the declared policy, layer order, bounded references, and ownership;
it does not claim to decide whether arbitrary natural-language statements are
semantically equivalent. Guardrails therefore keep one authority body under
`.ai/contracts/foundation/guardrails.md`, and `.ai/guardrails.md` is a stable entry
adapter. Higher authority wins and a semantic conflict in an overlay fails closed for
human review.

An ownership root is either a literal file or a directory prefix ending in `/`. Globs,
absolute paths, traversal, `.git`, duplicates, and overlap within or across ownership
classes are invalid. Protected roots must cover the manifest, selected lock file,
`.gitignore`, `.templatesyncignore`, local governance policy, and sync workflow.

During the transitional Template Sync period, `.templatesyncignore` must also:

- cover every manifest `protected_paths` root;
- contain `.github/workflows/**`; and
- contain no `:!` exception that re-includes a protected root or workflow.

Entries ending in `/**` are treated as directory roots. The `:!` prefix is a Git
pathspec exclusion used by `actions-template-sync`, not `.gitignore` negation. The
intentional `:!docs/foundation/**` exception permits only the inherited foundation
documentation namespace.

`actions-template-sync@v2` exposes an abbreviated source hash even though its action
metadata calls the value a Git hash. The workflow must expand that exact abbreviation
through the GitHub commits API and validate the resulting 40-character commit before
writing PR provenance. Resolving only the current parent branch head is insufficient
because the parent can move while synchronization runs.

## Validate

```bash
python3 scripts/template_inheritance.py validate --root .
```

Exit `0` prints deterministic JSON; exit `2` reports invalid input on stderr. The command
performs no network request, file write, deletion, Git operation, or GitHub API call.
`make doctor` runs this validation automatically when the repository contains a child
manifest; the foundation root has no manifest and skips only this child-specific check.

## Propagate a parent change

Apply each row in order. Do not prepare a grandchild from an unmerged intermediate
template.

The transitional workflow is scheduled daily at 07:17 UTC and may also be started with
`workflow_dispatch`. A schedule shared by every repository does not collapse
multiple inheritance hops: a grandchild run at the same time still sees the previously
merged intermediate parent. After the intermediate template PR merges, either start its
children manually or wait for their next daily schedule. Every resulting PR remains a
separate review and must not auto-merge.

| Step | Required evidence |
|------|-------------------|
| 1. Update a direct child | Template Sync PR names the direct parent and the exact 40-character source commit |
| 2. Review inherited files | Accepted lock-to-source range reviewed; no protected path changed by transport |
| 3. Port workflows | Separate maintainer-authenticated PR verified against the same direct-parent source commit |
| 4. Advance the lock | Lock changes only in a reviewed PR after the complete parent delta is accepted |
| 5. Merge and continue | Only the merged child commit becomes the source for its direct children |

Template Sync must never auto-merge or apply repository governance. If validation fails,
disable `TEMPLATE_SYNC_ENABLED` until the manifest and local ignore contract agree.

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
See [template inheritance troubleshooting](../../docs/foundation/troubleshooting/template-inheritance.md).

## Report fleet propagation boundaries

Run `fleet-report` against explicit local child/parent worktree pairs. Repeat
`--repository` for each child; the command never discovers repositories recursively.

```bash
python3 scripts/template_inheritance.py fleet-report \
  --repository acme/terraform-template ../terraform-template ../foundation \
  --repository acme/product ../product ../terraform-template
```

The command reuses validation and one-first-parent planning for every pair, compares
protected child content with the selected parent candidate, and emits deterministic
JSON. At most 32 unique children are accepted. The reported child repository name comes
from the explicit argument and is labeled `repository_source: explicit-argument`; the
command validates its `OWNER/REPOSITORY` shape but does not call GitHub to verify it.

| Category | Meaning |
|----------|---------|
| `synchronized` | Inherited child content equals the selected candidate or current parent target |
| `pending_sync` | Inherited content is missing or differs and can synchronize through the reviewed parent PR |
| `pending_manual_port` | Inherited content differs but the transitional transport intentionally excludes it; each item reports the manual-port reason |
| `manually_ported` | Content at a manual transport or protected boundary equals the selected candidate or current parent target exactly |
| `protected_review` | Protected child content differs; the reported reason identifies the manual boundary |
| `ownership_review` | The path is unowned and needs an explicit ownership decision |
| `deletion_review` | The parent deleted inherited content; the read-only tool never deletes it |

An inherited path excluded by `.templatesyncignore` is reported as `pending_manual_port`
instead of `pending_sync`; an exact child copy is reported as `manually_ported`.
`workflow-security-boundary` means maintainer authentication and a separate reviewed PR
are required. Manual boundaries are intentional. Protected workflow callers retain local events,
permissions, secrets, and environment selection. Project overlays and profiles retain
repository identity and semantics. Manifests, locks, and ignore files retain accepted
provenance and ownership. Other protected paths remain repository-owned unless a
reviewed contract change moves their ownership. Unowned paths require a reviewed
ownership decision before synchronization.

Target comparison recognizes content accepted ahead of its lock during a reviewed
mechanical sync. The report does not advance provenance: every intermediate
first-parent checkpoint still requires its own reviewed lock update.

Fleet reporting performs no fetch, checkout, file write, deletion, GitHub API call, or
network request. Refresh each local `origin/<branch>` explicitly before the report when
current remote state is required.

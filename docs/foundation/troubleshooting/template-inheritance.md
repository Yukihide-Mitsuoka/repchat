---
id: template-inheritance-troubleshooting
title: Template Inheritance Troubleshooting
updated: 2026-08-08
---

# Template Inheritance Troubleshooting

This guide diagnoses inheritance validation, planning, and finalization failures. A
write still requires the finalizer's explicit repository and source confirmations; the
tool never fetches, deletes, commits, pushes, or merges.

## `parent origin does not match manifest.parent.repository`

**Affects:** `scripts/template_inheritance.py plan`

**Cause:** `--parent-root` points to a different GitHub repository than the manifest's
direct parent.

**Fix:** Select the declared parent's local checkout. If the manifest is wrong, change
it only through a reviewed child-repository PR.

**Refs:** #32, ADR-0004

## `protected review is required`

**Affects:** `scripts/template_inheritance.py finalize-sync --apply`

**Cause:** The sync branch changes a manifest-protected child path relative to the
child's local `origin/HEAD`. Parent-only changes to protected paths do not cause this
error because protected content remains child-owned.

**Fix:** Refresh the child remote refs, inspect the reported path, and remove an
unintended transport change. If the protected child contract must change, review that
change explicitly instead of making the finalizer copy the parent's file. The
inheritance lock is the only protected path that the finalizer may update.

**Refs:** #159, ADR-0015

## `locked commit is not on the remote branch first-parent history`

**Affects:** `scripts/template_inheritance.py plan`

**Cause:** The lock is not on the local `origin/<branch>` first-parent chain, or the
local parent checkout lacks the required history.

**Fix:** Confirm the parent and branch from the manifest, then explicitly refresh the
local parent checkout. Do not replace the lock merely to silence this error; investigate
whether upstream history changed or the wrong parent was selected.

**Refs:** #32, ADR-0004

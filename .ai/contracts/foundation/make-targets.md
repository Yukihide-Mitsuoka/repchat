---
id: foundation-make-targets-compatibility
title: Legacy Make Target Compatibility
authority: 4
read_when: [makefile, tooling]
---

# Legacy Make Target Compatibility

The [Task target contract](task-targets.md) owns binding command semantics. Existing
`make <name>` callers remain temporary compatibility paths during ADR-0024 migration;
this file defines no independent target behavior. Do not add new Make-only behavior.
Convert a repository's Makefile to forwarding-only after its protected callers have
moved to Task, then remove it after downstream compatibility is verified.

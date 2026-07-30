---
id: foundation-agent-contract-namespace
title: Foundation Agent Contract Namespace
authority: 4
read_when: [agent-contract-migration]
---

# Foundation Agent Contract Namespace

This inherited directory owns foundation agent instructions introduced by ADR-0014.
Child manifests inherit the directory root so a new contract file does not require a
new path entry in every child manifest.

The identity-free foundation entry contract is
[`agent-entry.md`](agent-entry.md). The foundation root activates it through the
checked-in agent profile and thin `CLAUDE.md` / `AGENTS.md` adapters. Each descendant
activates its own reviewed profile and adapters when its manifest migrates to schema
version 2; transport alone must not overwrite those child-owned protected files.

The profile is the composition source of truth. It preserves commands, escalation
conditions, and completion rules while allowing owner-qualified template overlays and
one project-owned overlay to add facts or strengthen controls without duplicating the
foundation contract.

Template exports use
`.ai/contracts/templates/<owner>/<repository>/`. Project-owned instructions use the
protected `.ai/project/` root. The exact ordered files are declared in the protected
agent profile documented by the
[inheritance contract](../../../.github/inheritance/README.md).

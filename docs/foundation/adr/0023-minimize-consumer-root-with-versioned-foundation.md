---
id: adr-0023
title: ADR-0023 — Minimize the consumer root while keeping a versioned Foundation
status: proposed
updated: 2026-09-23
---

# ADR-0023: Minimize the consumer root while keeping a versioned Foundation

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-09-23 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | Extends ADR-0004, ADR-0007, ADR-0014, and ADR-0015; supersedes none |

## Context

The Foundation already separates reusable agent contracts from protected project
overlays (ADR-0014). Nevertheless, a new repository copies Foundation files into its
root beside project-owned files. A reader cannot reliably identify ownership or
whether a file is active from its location. The Foundation currently has 208 tracked
files, about 1.5 MiB of current file content, and 24 tracked root entries. Storage is
secondary to root readability, but every copied file also adds review and maintenance
surface to descendants.

The same repository may be used under an organization-managed AI or GitHub policy.
Some Foundation defaults, such as release and branch procedures, can differ from that
policy. Task-specific skills already load conditionally, while local hooks and some
workflows may run without a task-specific choice. The current `strengthen-only`
profile does not prove semantic compatibility with external policy.

The solution must retain reviewed direct-parent propagation, a versioned local
contract, existing security controls, and reproducible CI. A clone may be placed in
any directory or run by another agent, so no required rule may depend on an ancestor
`CLAUDE.md`, a user's home directory, or a mutable remote download.

The inheritance manifest protects `profiles/`, `src/`, and `tests/` in descendants.
Their copied reference Makefiles and catalog example are optional child-owned material,
not synchronized contracts. Moving those examples into inherited `docs/foundation/`
would make them mandatory in every descendant. Conversely, inherited guidance currently
links to child-owned `profiles/README.md`, `src/README.md`, and `tests/README.md`.
Removing optional copies in a child can therefore break its required link check.

## Options considered

### Option 1: Keep the current layout

This preserves stable paths and has no migration risk. Root ownership remains hard to
read, and optional features remain visually mixed with the consumer's own files.

### Option 2: Put the complete Foundation in an ancestor or user directory

This makes a local checkout sparse, but instruction loading depends on machine layout
and agent runtime. CI, GitHub review, and another user's clone do not receive a pinned
copy. It is suitable for personal or organization-managed additions, not the shared
source of truth.

### Option 3: Fetch a versioned Foundation at runtime

An immutable package or commit could reduce copied files. Every local agent and CI job
would then need installation, authentication, availability, and integrity checks.
Private parents add a credential boundary. This is disproportionate to the measured
storage and would add another delivery path beside Template Sync.

### Option 4: Keep reviewed local inheritance and reduce its root surface

Keep repository-local, versioned contracts. Retain root paths only for a consumer's
own files or verified tool discovery requirements. Move binding Foundation content
into inherited contract paths, while leaving removable examples outside inherited
paths. Make task and product capabilities explicit. This requires a staged contract
migration and repository-owned cleanup, with a small residual root surface.

## Decision

Adopt Option 4. The following ownership and activation rules govern new Foundation
paths and migrations:

1. A consumer root path MUST be either repository-owned or required at that location
   by a documented tool contract. Thin `CLAUDE.md` and `AGENTS.md` entry adapters,
   project `README.md`, and tool-discovered configuration may remain. Binding
   Foundation-only bodies SHOULD use inherited owned namespaces such as
   `.ai/contracts/foundation/`; descriptive guidance MAY use `docs/foundation/`.
   Optional examples MUST NOT move into an inherited path merely to clear the root:
   that would change a child-removable copy into a required synchronized payload.
   Avoid a second generic `.foundation/` tree with duplicate authorities.
2. Each root entry MUST be inventoried before migration with its owner, discovery
   constraint, direct-parent inheritance class, and activation condition. The inventory
   MUST distinguish protected project paths from synchronized Foundation paths.
   `CHANGELOG.md`, `README.md`, `Makefile`, `.env.example`, `src/`, and project `tests/`
   remain project-owned in descendants. Existing tool entry points MUST keep working
   until a replacement is verified in a direct child.
3. Always-on safety controls, task-routed skills, and optional product or runtime
   capabilities MUST be identified separately. A feature is not considered optional
   merely because its documentation is read on demand: its hook, workflow, or required
   check must also be inactive until the consumer explicitly enables it. Existing
   descendants retain their current checks and triggers until each change is reviewed.
   No classification may silently remove or weaken a security control (GR-030).
4. Organization-managed controls are external constraints. An onboarding review MUST
   identify conflicts with Foundation requirements before activation. Neither an
   overlay nor an agent may silently weaken a Foundation MUST, and the validator MUST
   NOT claim to understand arbitrary natural-language policy. An unresolved conflict
   blocks adoption until a reviewed policy decision reconciles it.
5. The direct-parent manifest, lock, Template Sync PR, `finalize-sync`, and human
   review remain the automatic propagation path. Protected child-owned paths still
   require their existing reviewed manual port. No ancestor-directory file or remote
   runtime fetch becomes a required source. Root-path moves MUST be staged with
   updated references, tests, ownership metadata, and rollback before an old path is
   removed. Propagation proceeds one merged parent hop at a time.
6. An inherited contract or guide MUST NOT require a file in a protected, removable
   child-owned path. Extract the binding Make target semantics and profile rules from
   `profiles/README.md` into `.ai/contracts/foundation/make-targets.md`; keep
   `profiles/README.md` as a non-normative reference to that contract and retain the
   reference Makefiles under protected `profiles/`. Update inherited references to
   the new authority. Treat `src/README.md` and `tests/README.md` as optional local
   copies: where a guide needs their binding layout rule, link to the inherited
   `.ai/architecture.md` or `.ai/testing.md`; otherwise mention the optional path
   without a local-file link. Do not move the catalog example or profile Makefiles
   into `docs/foundation/`.

The first inventory will classify paths by these concrete examples; it will not move
them merely because they appear here:

| Class | Examples | Initial treatment |
|-------|----------|-------------------|
| Fixed tool entry | `CLAUDE.md`, `AGENTS.md`, `.github/` | Keep the required path; minimize its Foundation-owned body where safe. |
| Consumer-owned | `README.md`, `Makefile`, `src/`, project `tests/` | Keep at the consumer's normal location and protect from parent overwrite. |
| Foundation-owned | `.ai/contracts/foundation/`, `docs/foundation/`, inherited `scripts/` | Group internal implementation under declared owned paths when callers and inheritance metadata can migrate together. |
| Optional copied examples | `profiles/*/Makefile`, `src/modules/catalog/`, `tests/modules/catalog/` | Keep outside inherited roots; a child may remove them after reviewing local references. |
| Conditional candidate | `.skills/`, `.devcontainer/`, capability-specific workflows | Audit actual triggers and security dependencies before declaring any part optional. |

## Consequences

**Positive:** consumers can identify their own root files, optional features have an
explicit activation boundary, and teams can inspect a versioned policy without relying
on a developer's directory layout. Existing review and security boundaries remain.
Children can remove unused copied examples without losing the inherited Make contract.

**Negative:** tool-required root files cannot disappear. The Foundation source keeps
some reference examples at its root so newly instantiated repositories can copy them;
the parent and mature children need not have identical trees. Contract migration
changes references and requires protected child ports. Capability classification adds
a small onboarding decision. Real organization-policy conflicts still require human
review; they cannot be resolved by a path move or text validator.

Migration is expand, verify, then contract. First publish the root ownership and
activation inventory. Add the inherited Make contract and update its contract tests,
the Foundation `CLAUDE.md`, the agent entry, and every inherited guide that links to
protected `profiles/README.md`, `src/README.md`, or `tests/README.md`. Review commands
that assume `profiles/*` exists:
onboarding-only copy instructions must say so and must not be an ongoing child
requirement. Add a regression check for inherited links to removable protected paths.
Keep the original copies during this expansion. After a direct child and
a multi-level child accept the new contract through reviewed parent hops, each child
MAY separately remove unused protected copies and repair its own `CLAUDE.md`, Makefile,
project documents, and historical links. Run the offline link check and doctor before
each deletion; leave product code untouched. Remove obsolete paths only in separately
reviewable, explicitly scoped changes. Rollback retains or restores the protected copy
through a normal child PR; the accepted parent lock remains the source of provenance.

**Follow-ups:** Track implementation and fleet evidence in
[Issue #230](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/230).

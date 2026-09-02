---
id: adr-0019
title: ADR-0019 — Adopt the foundation into existing repositories
status: proposed
updated: 2026-09-02
---

# ADR-0019: Adopt the foundation into existing repositories

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-09-02 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | Extends ADR-0004, ADR-0014, ADR-0015, and GR-020; supersedes ADR-0008 only by adding one named Japanese guide exception |

## Context

`Use this template` creates a child whose inherited files match one exact parent commit.
The existing `bootstrap-child` command verifies that condition before it writes the
manifest, lock, agent profile, ignore contract, and reviewed child-owned payloads. An
existing repository does not satisfy that precondition: parent-owned paths can be
missing or different, and project-owned paths can use names the parent export does not
yet classify.

Operators can copy files manually, but that does not prove complete ownership,
executable modes, direct-parent provenance, or repeatability. Recreating the repository
from a template would discard or rewrite useful history. Adding another long-running
template transport would duplicate the existing reviewed Template Sync path and increase
approval and drift risk.

The adoption mechanism must preserve existing history and project content, fail closed
on ownership ambiguity, and join the current inheritance model only after the complete
inherited tree matches one exact parent commit. It must not claim an accepted lock while
inherited content is incomplete, use a local copy as a second inheritance transport, or
add routine AI context. A normal parent export exceeds GR-020, so the design must also
bound the one unavoidable initial import without creating many manually copied PRs. The
repository owner requires the operator guide to be written in Japanese as a narrowly
named human-facing exception to ADR-0008.

## Options considered

### Option 1: Keep manual adoption

Document file-copy and metadata-editing steps without a reconciler. This adds no code,
but omissions and accidental overwrites remain dependent on operator inspection. The
result cannot be proven idempotent before review.

### Option 2: Recreate the repository from the template

Create a new templated repository and replay the existing project into it. The bootstrap
path remains unchanged, but repository history, settings, open work, and integrations
must be migrated. The disruption is disproportionate to adding a bounded adoption path.

### Option 3: Adopt an external template updater

Use a second tool such as a subtree or general template reapplication system. This can
copy files into an existing repository, but it does not share the current manifest,
protected-path, direct-parent, agent-profile, or single-flight review contracts. Keeping
it after adoption would create two inheritance transports.

### Option 4: Copy and activate the complete contract in one adoption PR

Add a distinct `adopt-child` operation to `template_inheritance.py`. It uses the direct
parent's existing export and exact commit, reports every ownership or content conflict
before writing, and copies the inherited tree plus activation metadata in one PR. This
is atomic, but a normal parent export commonly exceeds GR-020. A broad bot or adoption
exception would weaken the shared review boundary, while splitting the PR after writing
the accepted lock would leave a misleading partial contract.

### Option 5: Prepare transport only, then activate the initial sync PR

Use one local `adopt-child` operation with separate preparation and activation phases.
Preparation writes only a temporary child-owned adoption marker, generated ignore
contract, and protected Template Sync caller. Reviewed Template Sync creates the initial
import PR. Activation updates that same PR only after every inherited path matches the
recorded parent commit; it then removes the marker and writes the normal metadata and
reviewed child-owned boundary payload. Template Sync is the only transport of
parent-owned content during and after adoption.

## Decision

Adopt Option 5.

`adopt-child` MUST be a one-time, local, idempotent operation distinct from strict
template-copy bootstrap. Its default mode MUST be read-only. The operator MUST select
the closest currently applicable maintained parent by the repository's primary
deliverable and MUST NOT skip an applicable intermediate template. The plan MUST require
a clean non-default child branch, credential-free GitHub origins for the child and
direct parent, an exact full parent commit on that parent's declared first-parent branch,
and the parent's validated inheritance export. The planned commit establishes ownership
and preparation inputs; the exact commit actually transported is recorded by the initial
Template Sync PR and becomes the activation source.

The plan MUST classify the complete adoption surface at least as:

- inherited content already identical to the exact parent;
- missing inherited content that can be added byte-for-byte with its executable mode;
- conflicting inherited content that requires human resolution;
- existing or required child-owned content that remains protected; and
- tracked content with no declared owner that requires an ownership decision.

An adoption payload MAY add existing project-owned paths to the parent's protected-path
baseline. It MUST NOT remove a protected baseline path, reclassify a parent-owned
inherited path, overlap owners, or leave tracked content implicitly protected. A
conflicting inherited path must be made identical to the parent in the reviewed branch,
or the adoption remains blocked. Choosing another direct parent or declining adoption
remains valid.

The plan MUST derive every protected workflow and other manual boundary from the parent
export and ignore contract. Each boundary must be reported with a required decision:
retain the child implementation, port the parent control, or block activation. A path
cannot be both inherited and protected. Protecting an existing conflicting file therefore
means declining future inheritance for that path and is valid only when the parent export
already assigns that path to the protected baseline.

Preparation apply MUST require the exact child repository, direct parent, and planned
parent commit to be repeated. It MAY write only:

- a bounded `.github/inheritance/adoption.json` marker that identifies the child, direct
  parent, branch, and planned export commit without asserting acceptance;
- a generated `.templatesyncignore` that protects the marker, every existing tracked
  child path, and every protected or manual boundary from the planned parent export; and
- a protected `.github/workflows/template-sync.yml` adoption caller that validates the
  marker inline before obtaining source credentials and invoking the existing pinned
  Template Sync action.

Preparation MUST NOT write any parent-owned file, manifest, lock, agent profile, project
overlay, README archive, or ordinary activation payload. The normal
`template_sync_auth.py` remains manifest-only; the temporary caller MUST NOT weaken that
steady-state validator or create a second reusable authentication implementation. The
preparation PR MUST remain within GR-020 and repeated preparation of the same valid state
MUST make no change.

After the preparation PR merges, the operator configures private-parent credentials when
required, sets `TEMPLATE_SYNC_ENABLED=true`, and manually starts Template Sync. The
single-flight workflow creates one initial import PR and records the exact full parent
commit reported by the pinned action. The generated ignore contract prevents the
transport from modifying content that existed before preparation. If the parent moves
during the action, later exact-source validation MUST fail closed; the PR is not accepted
until its content and recorded source converge.

Activation runs locally on that existing Template Sync PR branch. It MUST require exact
child, parent, source, and adoption-marker removal confirmations. It MUST verify that all
parent-owned paths at the recorded source match the child by presence, bytes, and
executable mode; that no pre-adoption protected content changed; and that every conflict,
unowned path, README ownership requirement, and manual boundary has an explicit valid
result. It MUST block unexpected parent content, source races, candidate deletions,
symlinks, and unresolved boundaries.

Only after complete convergence MAY activation remove the exact temporary marker and
write the existing manifest, lock, agent-profile, README-archive, project-overlay, final
Template Sync exclusion and caller, and other reviewed child-owned payloads. Supported
protected workflow ports SHOULD be completed on the same PR under ADR-0015; every other
workflow receives an explicit retain, port, or block result. The completed PR MUST pass
the normal inheritance validator and repository checks. Human-authored preparation and
activation prose is Japanese under ADR-0020; the initial Template Sync PR body SHOULD
also be Japanese even though its exact trusted Bot identity is exempt.

Preparation and activation MUST NOT overwrite a non-identical child file, follow a
symlink, fetch, alter history or remotes, commit, push, create or merge a PR, call GitHub,
or apply repository governance. Activation MAY delete only the exact adoption marker
after explicit path confirmation. A repeated activation with the same accepted state
MUST make no change.

GR-020 MUST gain no general Bot exemption. Its only adoption exception is the initial
Template Sync PR when the activation report proves that all oversized parent-owned
changes are an exact mechanical import from one recorded commit, all non-import changes
remain within the ordinary limit, and a human reviews the report before merge. A target
repository whose existing required checks reject that PR needs its own reviewed policy
decision; adoption MUST NOT disable or bypass those checks.

After the completed import PR merges, operators separately apply GitHub governance. All
later parent changes use the existing direct-parent reviewed propagation path. A
repository adopted without separately publishing a validated child export is a leaf;
making it an inheritable template is a separate reviewed architecture decision.

Add one descriptive Japanese exception at
`docs/foundation/guides/adopt-existing-repository.ja.md`. The guide MUST link to the
English inheritance contract and this ADR, MUST NOT define normative behavior, and MUST
not enter baseline or general task routing. Update the exact localized-file allowlist so
all other Foundation documentation remains English under ADR-0008.

## Consequences

**Positive:**

- Existing repositories retain their history, identity, and project-owned content.
- A deterministic plan exposes missing files, conflicts, and unowned paths before any
  write.
- The small preparation PR never claims that an incomplete inheritance contract is active.
- The initial tree uses the existing reviewed Template Sync transport instead of manual
  copy PRs.
- Activation and lock acceptance occur on the same import PR after exact-source proof.
- Adoption adds no second continuing transport or recurring approval path.
- The Japanese procedure is available for the operator without increasing routine AI
  context.

**Negative:**

- Adoption is more work than template initialization because every pre-existing
  ownership conflict needs a human decision.
- The inheritance reconciler gains another bounded command and additional fixtures.
- The initial import PR is necessarily large and relies on exact-source mechanical proof
  plus human review instead of ordinary size-based reviewability.
- Adoption needs a temporary marker and specialized protected caller that must be removed
  during activation.
- A parent movement during synchronization can require closing the unaccepted import PR
  and repeating the initial sync.
- The third Japanese guide must be maintained against its English authorities.

Migration is expand-only: add failing-first planner tests, implement read-only
classification, add the child-owned preparation payload, add the exact-source activation
gate and narrow PR-size proof, then publish the Japanese guide and allowlist update. Prove
one non-production existing repository from preparation through post-activation Template
Sync before recommending the path generally. Before activation, rollback disables
Template Sync, closes the unaccepted import PR, and reverts the preparation PR; after
activation, rollback is a normal reviewed child PR and lock change, not a history rewrite.

**Follow-ups:** implement `adopt-child` and bounded fixtures in
[Issue #211](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/211); add the
Japanese operator guide outside default AI routes; update the language allowlist and
inheritance index; and record pilot evidence before closing the implementation issue.

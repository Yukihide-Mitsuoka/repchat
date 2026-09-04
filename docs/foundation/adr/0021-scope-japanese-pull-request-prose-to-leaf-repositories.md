---
id: adr-0021
title: ADR-0021 — Scope Japanese pull request prose to leaf repositories
status: accepted
updated: 2026-09-03
---

# ADR-0021: Scope Japanese pull request prose to leaf repositories

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-09-02 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | Supersedes ADR-0020 only for repository applicability; retains its validator, Bot, technical-text, and exception boundaries |

## Context

ADR-0020 was intended to make pull request explanations Japanese in repositories that
consume `ai-dev-foundation` or an inheritable child template. Its accepted wording and
expand-phase implementation instead apply Japanese to every repository, including the
Foundation and intermediate templates. PR #218 consequently translated the Foundation's
own pull request template and made its protected `.ai/workflow.md` rule unconditional.

That scope conflicts with the established ownership boundary: reusable Foundation and
template instructions are maintained in English, while project-owned output in an
instantiated consumer uses Japanese. The correction must identify repository role
without a mutable external setting, preserve automatic inheritance for future leaves,
and avoid separate Japanese and English copies of the same template.

## Options considered

### Option 1: Keep Japanese in every repository

This preserves ADR-0020 as implemented and requires no migration. It does not match the
repository owner's requirement and makes reusable template maintenance an unintended
Japanese-language exception.

### Option 2: Select language through a repository variable

Each repository can set `PR_PROSE_LANGUAGE=en|ja`. This is simple for CI but creates
mutable configuration outside the reviewed inheritance contract. Missing or stale
variables can silently select the wrong policy.

### Option 3: Derive producer or consumer role from the inheritance contract

Treat the current repository as a producer when it publishes one validated inheritance
export whose repository identity matches `GITHUB_REPOSITORY`; this covers the Foundation
and intermediate templates. Treat a repository with a valid parent manifest but no
self-owned export as a consumer leaf. Use English for producers and Japanese for
consumers. The same inherited validator and template then work at every layer.

### Option 4: Maintain separate English and Japanese PR templates

This makes each language visually explicit but adds selection, duplicated fields, and
drift. GitHub cannot automatically select the correct template from inheritance role.

## Decision

Adopt Option 3.

The repository roles and PR prose defaults are:

| Role | Machine evidence | Required explanatory prose |
|------|------------------|----------------------------|
| Producer | One validated self-owned Foundation or template inheritance export matches the current repository identity | English |
| Consumer | A valid child manifest exists and no validated self-owned export matches the current repository identity | Japanese |

The Foundation and every inheritable intermediate template MUST use English PR titles,
descriptions, and maintained PR-template text by default. A consumer leaf MUST use
Japanese explanatory prose under the remaining ADR-0020 rules. Conventional Commit
prefixes, technical identifiers, code, commands, URLs, product names, quoted evidence,
exact trusted Bot exemptions, and human-approved language exceptions remain unchanged.

The synchronized language validator MUST derive role locally from
`GITHUB_REPOSITORY`, the child manifest when present, and validated owner-qualified
inheritance exports. It MUST fail closed on malformed, duplicate, or contradictory role
evidence. It MUST NOT use a repository variable, repository name pattern, parent name,
or branch name as authority. Publishing or removing a self-owned export changes whether
the repository is inheritable and therefore requires an ADR and reviewed migration.

The single inherited `.github/PULL_REQUEST_TEMPLATE.md` MUST remain English and explain
the role boundary in an HTML comment. Consumer authors fill its explanatory fields in
Japanese; headings and fixed controls are not authored prose and do not need translation.
Do not create a synchronized Japanese sibling. The inherited Foundation entry contract
and repository-local workflow rule MUST point to this role decision rather than impose
one language unconditionally.

The protected `pr-quality` caller MUST invoke the same synchronized validator in both
producers and consumers. Role resolution selects English or Japanese checks without a
per-repository workflow fork. Existing protected callers still require one reviewed
parent-first port; after that port, script and policy changes follow the inherited path.

## Consequences

**Positive:**

- Foundation and template maintenance returns to its intended English default.
- Consumer leaf PRs remain deterministically enforced in Japanese.
- One validator, caller shape, and English template serve every inheritance layer.
- Role follows reviewed inheritance capability instead of mutable repository settings.

**Negative:**

- The validator must safely parse both the Foundation and owner-qualified template
  export locations.
- A repository changing between leaf and template roles changes its PR language policy
  and needs an explicit architecture migration.
- Existing repositories still need a one-time protected CI caller port.

Migration is expand-first. Add role-resolution tests and conditional validation, restore
the inherited PR template to English with one role comment, and replace the unconditional
workflow rule with the producer/consumer boundary. Then port the protected caller from
the Foundation through active templates to their leaves. Historical Japanese PRs and
PR #218 remain unchanged. Rollback can disable the caller invocation while retaining the
role-aware instructions; it must not restore the over-broad ADR-0020 wording.

**Follow-ups:** update Issue #216 acceptance criteria after approval; implement
producer/consumer fixtures and attempted-role-spoof tests; update the protected caller;
and audit each active inheritance edge after parent-first propagation.

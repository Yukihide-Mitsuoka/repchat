---
id: adr-0020
title: ADR-0020 — Enforce Japanese pull request prose
status: accepted
updated: 2026-09-02
---

# ADR-0020: Enforce Japanese pull request prose

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-09-02 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | Extends ADR-0005 and ADR-0014 |

## Context

ADR-0005 requires project-owned documentation to use the repository owner's Japanese
working language, but the pull request contract does not select a language. Human and AI
authors therefore alternate between English and Japanese descriptions across the
Foundation fleet. Reviewers must repeatedly translate the rationale, verification
evidence, and remaining risk even though the owner reviews those facts in Japanese.

Instructions alone cannot prevent drift, and a pull request template only supplies
initial text. GitHub Rulesets cannot classify pull request prose, but they can require a
repository status check. The policy must retain Conventional Commit compatibility,
allow English technical identifiers, avoid an external language-classification service,
and keep Dependabot, Release Please, and Template Sync operational. It must not create a
new workflow for every later policy adjustment.

## Options considered

### Option 1: Do nothing

Leave language to each author. This adds no migration work, but preserves inconsistent
review input and provides no reusable default for newly instantiated repositories.

### Option 2: Add instructions and a Japanese template only

Require Japanese in the AI workflow and translate the pull request template. This makes
the intended behavior visible and usually guides authors correctly, but an omitted or
replaced template passes every required check.

### Option 3: Use an external natural-language classifier

Call a language-detection service or model from CI. It can estimate the language of
mixed prose, but adds credentials, network failure modes, cost, privacy exposure, and
nondeterminism for a policy that needs only a conservative repository-local signal.

### Option 4: Combine instructions, a template, and a deterministic required check

Keep the normative rule in the inherited workflow contract, provide a Japanese pull
request template, and run a standard-library validator from the existing
`pr-quality` job. The validator receives event metadata through environment variables,
recognizes sufficient Japanese script in the title summary and body, and exempts only
explicit trusted automation identities or a human-approved exception marker.

## Decision

Adopt Option 4.

Human- and AI-authored pull requests MUST write their explanatory prose in Japanese.
The title MUST retain its Conventional Commit type and optional scope, while the summary
after the prefix MUST contain Japanese. Code, commands, URLs, product names, identifiers,
and quoted evidence MAY remain in their original language.

The existing `pr-quality` job MUST invoke one synchronized, standard-library policy
script. The script MUST fail closed when required event inputs are absent, validate the
title and non-comment pull request body, and return actionable errors. It MUST use
bounded Japanese-script evidence rather than claim full natural-language
classification. Tests MUST cover empty bodies, English-only prose, valid mixed technical
prose, HTML comments, malformed inputs, trusted automation, and attempted automation
spoofing by branch name or body text.

Automation bypass MUST match an exact actor identity maintained in the policy. The
initial allowlist is limited to GitHub-hosted Dependabot and `github-actions[bot]`,
which owns this fleet's Release Please and Template Sync pull requests. Branch names,
commit authors, titles, and body text MUST NOT grant the bypass.

A non-automated language exception MUST carry a dedicated exception label and a visible
reason in the pull request body. Applying the label is a human review action; the
ordinary review and required-check rules remain in force. Repositories with a recurring
contractual need for another language SHOULD record a repository ADR instead of using
the per-pull-request exception repeatedly.

The pull request template and AI instructions MUST explain the same boundary. Existing
repositories adopt the protected `.github/workflows/ci.yml` caller once through a
reviewed manual port. After that port, validator, tests, template, and contract changes
propagate through the normal inherited path without further workflow edits.

## Consequences

**Positive:**

- Review rationale and verification evidence use the owner's working language.
- CI prevents silent drift while preserving technical English where it improves clarity.
- Exact actor matching keeps ordinary authors from imitating a Bot through branch names.
- A stable protected caller leaves future policy changes on the synchronized script path.
- The validator adds no dependency, credential, external request, or model cost.

**Negative:**

- Script detection can prove the presence of Japanese script, not semantic fluency or
  writing quality; human review remains necessary.
- Existing protected CI callers require one reviewed manual port per active inheritance
  family.
- Exact Bot identities must be maintained when automation ownership changes.
- A language-exception label is an intentional policy escape and needs reviewer
  discipline; repeated use indicates that the repository policy should be reconsidered.

Migration is expand-first: add the failing validator tests and script, translate the
template and contract, then update the protected Foundation caller. Port that caller
parent-first to active template families and their direct consumers. Rollback removes
the required invocation while retaining the Japanese template and instruction; it does
not require rewriting pull request history.

**Follow-ups:** implement and test the validator in
[Issue #216](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/216), add the
protected caller, and manually port that caller through the active inheritance graph.

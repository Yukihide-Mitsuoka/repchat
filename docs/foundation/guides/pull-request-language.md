---
id: pull-request-language
title: Pull request language checks
---

# Pull request language checks

Use this reference to prepare a PR, diagnose a language-check failure, or port the
protected caller. Policy is defined by
[ADR-0021](../adr/0021-scope-japanese-pull-request-prose-to-leaf-repositories.md).

## Authoring and failures

Producers write English; consumer leaves write Japanese. Fill the shared English
template without translating its headings. The deterministic check requires two
Japanese-script characters in a consumer title summary and 20 in its body, including
kana in the body. Producer summaries need two ASCII words; bodies need three words
and 20 ASCII letters, without Japanese script in authored prose. These bounded signals
do not guarantee fluency, completeness, or quality.

Comments, headings, checkboxes, tables, code, URLs and blockquotes do not supply body
evidence. Put the change and reason in ordinary prose. Keep technical identifiers
and original-language evidence in backticks, fenced code or blockquotes. An empty
template fails. Exact trusted bot authors are exempt from prose checks, not from
missing/malformed metadata. Human exceptions need the approved label and a visible
reason of at least ten letters or Japanese-script characters under
`## Language exception` or its approved Japanese-language equivalent; review remains
mandatory.

## Caller and propagation

First merge the inherited scripts, including `pr_repository_role.py`, into the child's
base branch. Then port the three language steps in the Foundation
[CI workflow](../../../.github/workflows/ci.yml), plus PR metadata event types, into
the child's protected `pr-quality` job. Preserve child-specific checks and permissions.
Do not add a fallback when the accepted base lacks role evidence or the resolver.

The caller checks out `pull_request.base.sha` separately and runs both role resolution
and `python3 -m scripts.pr_language_policy` there. It passes the role and event metadata
(`PR_ROLE`, `PR_TITLE`, `PR_BODY`, `PR_AUTHOR`, `PR_LABELS_JSON`) via environment
variables. PR-head changes cannot modify their own role or policy implementation.
This is not tamper-proof CI: validator/workflow changes still require code review.

Title/body/label edits rerun CI, including existing tests; they do not convert failing
required tests to skipped checks. This costs additional CI runs on metadata edits.
The existing concurrency setting cancels superseded runs. Invalid inputs exit 2,
language violations exit 1, and compliant/exempt prose exits 0. No external service,
new credential, automatic merge, or translation step is introduced.

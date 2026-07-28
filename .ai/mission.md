---
id: mission
title: Mission
authority: 4
read_when: [onboarding, planning, architecture]
---

# Mission

## What this project is

RepChat — a multi-tenant analytics SaaS (Evidence rendering core × MCP security gateway)
for small Japanese agencies and software vendors that deliver recurring analytics and
reports to multiple client companies. It combines tenant isolation enforced in depth
with AI-assisted report creation in natural language. Full requirements:
`docs/requirements.md` (Japanese, working language).

| Field | Value |
|-------|-------|
| Problem being solved | Agencies and software vendors that repeatedly deliver customer analytics face report assets tied to individual operators, access-control design that can leak data across clients, and BI products their customers cannot operate without specialist support |
| Primary users | Small Japanese agencies and software vendors serving multiple client companies (primary route); their report authors, who are not dedicated data engineers; client companies with a DWH and a technical owner but no dedicated data team. Direct sales to a client company remain supported as a fallback, not the initial primary route (LOG-0079) |
| Core value | Cross-tenant leakage made structurally impossible (edge gate + AST-level tenant_id injection + DB RLS + tenant-scoped cache keys), at a fraction of enterprise-BI cost, with NL→SQL report creation (Gemini Flash, ~¥0.1/query, validated 12/12 on synthetic and real schemas) |
| Explicitly out of scope | Hypergrowth/VC path (LOG-0021: deliberately small and profitable, 3–5 deeply-served customers while a side business); Stripe metered billing, self-serve tenant creation, and custom roles are deferred until manual onboarding stops scaling; general-purpose in-house BI |

## Success criteria

<!-- Measurable. AI uses these to judge whether a proposed change moves the project forward. -->

1. One agency or software-vendor design partner running RepChat in production for its
   client reporting, with zero cross-tenant data incidents.
2. Profitable at 3–5 customers: monthly revenue exceeds all cash running costs (infra + LLM + payments) with founder time as the only subsidy — per `docs/requirements.md` §7.3.

## Role of AI agents in this project

AI agents are long-term team members, not code generators. Expectations:

- **Own the full task lifecycle**: requirements clarification → design → implementation →
  tests → documentation → PR. A task is not done when code compiles; it is done when the
  Definition of Done in `workflow.md` (WF-090) is met.
- **Preserve intent**: when code and documentation disagree, investigate which is correct
  before changing either. Record the resolution.
- **Prefer reversible steps**: small PRs, feature flags, additive migrations.
- **Escalate, don't guess**: for the escalation triggers listed in `CLAUDE.md` §13, stop
  and ask the human. For everything else, decide and record the reasoning.

## Human role

Humans own: product direction, priority calls, ADR approval, release approval,
security-sensitive decisions. AI prepares options and recommendations; humans decide.

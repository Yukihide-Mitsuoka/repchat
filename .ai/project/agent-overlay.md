---
id: repchat-agent-overlay
title: RepChat Agent Overlay
authority: 3
read_when: [agent-entry]
---

# RepChat Agent Overlay

This protected project layer contains repository identity and stack facts only. The
explicit agent profile loads it after the inherited foundation contract.

- Repository: `Yukihide-Mitsuoka/repchat`.
- Role: multi-tenant analytics SaaS for Japanese agencies and software vendors serving
  multiple client companies.
- Stack: TypeScript on Node.js for the edge authorization gate and planned rendering and
  MCP layers; Python for NL-to-SQL and data tooling; PostgreSQL row-level security and
  tenant-scoped BigQuery datasets.
- Architecture: a modular monolith with Clean Architecture layers inside bounded
  contexts under `src/modules/`.
- Deployment target: Cloudflare Workers for the edge gate and CDN shell; Vertex AI for
  language-model inference.
- Execution model: cloud deployment, database provisioning or migration, and external
  service configuration are separate authenticated operations.

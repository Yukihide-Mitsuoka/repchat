---
id: docs-index
title: Documentation Index
---

# docs/ — Documentation Index

Descriptive documentation (authority level 5 — see `.ai/README.md`). Binding rules live
in `.ai/`; decisions in `docs/adr/`. Writing rules: `.ai/documentation.md`.

| Directory | Content | Primary reader task |
|-----------|---------|---------------------|
| [adr/](adr/) | Architecture Decision Records (**normative** when accepted) | "why is it built this way?" |
| [architecture/](architecture/) | System structure, C4 diagrams, data flows | understand before changing structure |
| [domain/](domain/) | Domain model, bounded contexts, ubiquitous language | understand the business rules |
| [api/](api/) | API contracts (OpenAPI/schema + commentary) | integrate with or change an API |
| [deployment/](deployment/) | Environments, deploy procedure, configuration | ship it |
| [operations/](operations/) | Monitoring, alerts, SLOs, maintenance | keep it running |
| [runbook/](runbook/) | Step-by-step incident/ops procedures | 3am emergency |
| [troubleshooting/](troubleshooting/) | Known failure modes → diagnosis → fix | "it's broken, what now?" |
| [templates/](templates/) | Reusable document templates (requirements, ...) | start a standard document |
| [roadmap.md](roadmap.md) | Direction and planned milestones | prioritize work |
| [glossary.md](glossary.md) | Ubiquitous language dictionary | name things correctly |
| [usage.md](usage.md) | Using the template on a new machine/account; new-project setup (日本語: [usage.ja.md](usage.ja.md)) | onboard a new environment |
| [ai-instruction-files.ja.md](ai-instruction-files.ja.md) | 日本語: AIへ指示を出す全ファイルの目的・利用シーン・利用例 | understand the AI-instruction file set |

Contribution guide: [/CONTRIBUTING.md](../CONTRIBUTING.md).

Each directory's README defines its own structure and **update triggers** — the doc-update
matrix (DOC-030) tells you which directory a given change must touch.

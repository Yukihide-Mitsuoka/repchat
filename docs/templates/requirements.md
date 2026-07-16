---
id: requirements-template
title: Requirements — {{PROJECT_OR_FEATURE_NAME}}
status: draft
updated: {{YYYY-MM-DD}}
---

<!--
  TEMPLATE. Copy to docs/requirements.md (whole project) or
  docs/requirements/<initiative>.md (one initiative), then replace every {{...}} and
  delete the guidance comments. Procedure and rationale: .skills/requirements.skill.md.
  Style is binding — DOC-002: objective, conclusion-first, structure carries meaning,
  define once and reference. Fill instances in the project's working language; keep this
  template file in English (ADR-0002).
-->

# Requirements — {{PROJECT_OR_FEATURE_NAME}}

One sentence: what this document specifies and for whom.

## 1. Terms

<!-- Define each term once here; reference it by name everywhere else (DOC-002). -->

| Term | Definition |
|------|------------|
| {{TERM}} | {{DEFINITION}} |

## 2. Assumptions and constraints

<!-- Defined once. Every requirement and cost figure below relies on these. -->

| ID | Type | Statement | Impact if wrong |
|----|------|-----------|-----------------|
| A-1 | assumption | {{...}} | {{...}} |
| C-1 | constraint | {{...}} | {{...}} |

## 3. Purpose and scope

- **Purpose (one sentence):** {{why this exists}}
- **Success metrics (measurable):**

  | Metric | Target | How measured |
  |--------|--------|--------------|
  | {{...}} | {{...}} | {{...}} |

- **In scope:** {{what this delivers}}
- **Non-scope (explicit exclusions):** {{what this deliberately does not deliver}}
- **Stakeholders:**

  | Role | Interest | Decision authority |
  |------|----------|--------------------|
  | {{...}} | {{...}} | {{...}} |

## 4. Functional requirements

<!-- One row per requirement. "Purpose served" = which §3 purpose or metric it traces to. -->

| ID | Requirement | Purpose served | Priority | Basis |
|----|-------------|----------------|----------|-------|
| FR-001 | The system shall {{...}} | {{metric/purpose}} | Must | {{...}} |

### 4.1 Use cases / user stories
### 4.2 Business rules
### 4.3 States and transitions
### 4.4 Roles and permissions
### 4.5 Error and exception handling

## 5. Non-functional requirements

<!-- Cover the ISO/IEC 25010 characteristics that apply. Every NFR needs a measurement
     method — a target you cannot verify is not a requirement. Delete unused rows. -->

| ID | Characteristic (ISO/IEC 25010) | Requirement | Target | Measurement method | Priority |
|----|-------------------------------|-------------|--------|--------------------|----------|
| NFR-001 | Performance efficiency | {{...}} | {{p95 < 300 ms}} | {{load test at N rps}} | Must |
| NFR-002 | Reliability (availability, RTO, RPO) | {{...}} | {{...}} | {{...}} | |
| NFR-003 | Security (authN/Z, encryption, audit) | {{...}} | {{...}} | {{...}} | |
| NFR-004 | Maintainability | {{...}} | {{...}} | {{...}} | |
| NFR-005 | Usability / accessibility | {{...}} | {{...}} | {{...}} | |
| NFR-006 | Observability (logs, metrics, traces) | {{...}} | {{...}} | {{...}} | |
| NFR-007 | Compatibility / portability | {{...}} | {{...}} | {{...}} | |
| NFR-008 | Compliance / data protection | {{...}} | {{...}} | {{...}} | |

## 6. Data requirements

| Aspect | Specification |
|--------|---------------|
| Data model (overview) | {{entities, key relationships}} |
| Expected volume | {{records, growth rate}} |
| Retention | {{period, deletion policy}} |
| PII classification | {{what PII, sensitivity level}} |
| Backup / recovery | {{cadence; link to the RPO in NFR-002}} |

## 7. External interfaces and dependencies

| System / API | Direction | Contract | SLA | Failure handling |
|--------------|-----------|----------|-----|------------------|
| {{...}} | in / out | {{schema, protocol}} | {{...}} | {{retry, fallback}} |

## 8. Infrastructure and cost estimate

<!-- A number without its assumptions is not usable. State them (they live in §2). -->

- **Architecture (overview):** {{components, hosting model}}
- **Cost assumptions:** region {{...}}; unit prices as of {{date/source}}; assumed
  traffic/volume {{...}}.

| Component | Fixed / month | Usage-based basis | Est. / month at baseline | Increment per {{scale unit}} |
|-----------|---------------|-------------------|--------------------------|------------------------------|
| {{...}} | {{...}} | {{...}} | {{...}} | {{...}} |

## 9. Operational requirements

| Aspect | Requirement |
|--------|-------------|
| Monitoring / alerting | {{link to NFR-006}} |
| Incident response | {{runbook reference}} |
| Deploy / rollback | {{procedure, rollback trigger}} |
| Migration | {{data/schema migration needs}} |

## 10. Acceptance criteria

<!-- Each becomes a Definition-of-Done item (WF-090) and maps to tests. Cite req IDs. -->

| ID | Criterion | Verifies (req IDs) | Verification method |
|----|-----------|--------------------|--------------------|
| AC-1 | {{...}} | FR-001, NFR-001 | {{test / demo}} |

## 11. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-1 | {{...}} | {{L/M/H}} | {{L/M/H}} | {{...}} |

## 12. Milestones

| Milestone | Scope (req IDs) | Target date |
|-----------|-----------------|-------------|
| {{...}} | {{...}} | {{...}} |

## 13. Open questions

<!-- Undecided items only. Keep these out of the requirement sections above. -->

| ID | Question | Blocks (req IDs) | Owner | Needed by |
|----|----------|------------------|-------|-----------|
| Q-1 | {{...}} | {{...}} | {{...}} | {{...}} |

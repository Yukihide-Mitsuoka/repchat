---
id: api-docs
title: API Documentation
---

# API Documentation

Contracts for every interface this system exposes (HTTP, events, CLI).

**Update triggers (DOC-030):** any change to a public endpoint, event schema, CLI
command, or error contract. Breaking contract changes additionally require the
`BREAKING CHANGE:` commit footer (WF-020) and consumer migration notes.

## Rules

- **Schema first**: the machine-readable contract (OpenAPI 3.x at `openapi.yaml`,
  AsyncAPI for events, JSON Schema for payloads) is the source of truth; prose
  commentary supplements, never contradicts.
- Contract tests verify implementation against the schema (TST-001 integration level);
  drift between schema and implementation is a CI failure, not a doc chore.
- Every endpoint documents: auth requirement (SEC-020), inputs with validation rules,
  outputs, **every error response** with its trigger condition, idempotency, rate limits.
- Examples use obviously fake credentials (GR-002) and realistic payloads.
- Versioning: breaking API changes follow expand→migrate→contract (REL-040); document
  deprecation windows here.

## Structure

| File | Content |
|------|---------|
| `openapi.yaml` | HTTP API contract (source of truth) |
| `events.md` / `asyncapi.yaml` | Published/consumed events |
| `errors.md` | Error catalog: code → meaning → caller action |
| `changelog.md` | Contract-level changes and deprecation schedule |

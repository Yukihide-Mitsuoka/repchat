---
id: guardrails-entry
title: Guardrails Entry Adapter
authority: 1
read_when: [always]
---

# Guardrails Entry Adapter

The canonical authority is
[`contracts/foundation/guardrails.md`](contracts/foundation/guardrails.md), stored at
`.ai/contracts/foundation/guardrails.md`. Read it completely before any task work. It
governs every `GR-*` rule.

This adapter is intentionally stable and MUST NOT duplicate guardrail rules. A
repository adds stricter local controls through its declared project overlay; it does
not edit or weaken the canonical foundation rules.

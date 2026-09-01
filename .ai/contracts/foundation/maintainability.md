---
id: foundation-maintainability
title: Foundation Maintainability Contract
authority: 4
read_when: [feature, bugfix, refactor, architecture-change, review]
---

# Maintainability Contract

## MNT-001: Optimize for local reasoning and safe change

Maintainable code is correct, locally understandable, safe to change, testable and
deletable through stable boundaries, and no more complex than the current requirement
needs.

Before implementation, state the component's responsibility, inputs, outputs,
invariants, failure modes, owning layer, dependencies, smallest viable design, and
expected size or decomposition. Give it one primary reason to change. Isolate I/O and
side effects, keep dependency direction explicit, and keep each function at one
abstraction level.

## MNT-002: Review complexity before it becomes structural debt

Responsibility and coupling are the primary evidence; line count is only an early
signal. Pause and review decomposition when:

- a handwritten source component approaches ~400 logical lines, or the planned change
  adds roughly that much behavior;
- one file or class has unrelated reasons to change, branching grows by mode, or a
  change requires shotgun edits across callers;
- hidden side effects or dependency direction prevent local reasoning; or
- tests must reach implementation details instead of a stable boundary.

At the checkpoint, either keep the component cohesive and state why, or decompose it by
responsibility, stable boundary, or independently testable policy. Do not add thin
wrappers, arbitrary partial files, or speculative interfaces merely to lower a count.
GR-025 governs continued growth beyond ~800 handwritten logical lines.

Generated/declarative code, schemas or configuration, migrations, fixtures, and static
lookup data are exempt from the numeric signals when size conceals no behavior. They
remain subject to correctness, security, testing, and review rules.

The existing `scripts/pr_size_policy.py` caller also emits advisory MNT-002 warnings
for changed source files above 800 nonblank lines in its checkout. This is an approximate
physical count, including comments, not proof of a logical-line or GR-025 violation.
Known generated headers, generated/vendor/fixture/migration/schema/data directories,
declaration/minified/config files, and non-source extensions are excluded. Other static
or declarative content needs reviewer judgment. An unreadable, unsafe, binary, or >2 MB
source is reported as not inspected. Warnings never alter GR-020's exit status.
No extra workflow or API is needed; downstream callers using different scripts need
an explicit reviewed adoption. `--source-root` may select the checkout; default is `.`.

## MNT-003: Refactor for evidence, not taste

Refactor when duplicated knowledge, long conditional logic, mixed responsibilities,
shotgun surgery, hidden side effects, wrong dependency direction, or tests coupled to
internals create a concrete maintenance cost. Preserve behavior with tests at every
step, keep refactoring separate from behavior changes, and delete obsolete paths. A new
boundary must own behavior or policy; pass-through layers fail this rule.

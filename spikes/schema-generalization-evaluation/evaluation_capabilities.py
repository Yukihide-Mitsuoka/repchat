"""Closed capability contract for post-run evaluation evidence."""

from __future__ import annotations

from typing import Any


REQUIRED_CAPABILITIES = frozenset({
    "nested_unnest",
    "multi_level_nesting",
    "join",
    "period_comparison",
    "window_function",
    "ordered_behavior",
})


class EvaluationCapabilityError(ValueError):
    """Reviewed evidence contains an unsupported capability assignment."""


def validate_case_capabilities(value: Any) -> tuple[str, ...]:
    """Return one non-empty, unique list from the closed capability set."""
    if (
        not isinstance(value, list)
        or not value
        or any(
            not isinstance(capability, str)
            or capability not in REQUIRED_CAPABILITIES
            for capability in value
        )
        or len(value) != len(set(value))
    ):
        raise EvaluationCapabilityError("case capabilities are invalid")
    return tuple(value)


def validate_schema_capabilities(cases: list[dict[str, Any]]) -> None:
    """Require every schema to cover the complete reviewed capability contract."""
    covered = {
        capability
        for case in cases
        for capability in validate_case_capabilities(case["capabilities"])
    }
    if covered != REQUIRED_CAPABILITIES:
        raise EvaluationCapabilityError(
            "each schema must cover every required capability"
        )

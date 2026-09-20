"""Validate the run set frozen before a schema-generalization evaluation."""

from __future__ import annotations

from typing import Any

from evaluate import EvaluationEvidenceError
from pipeline_artifacts import PIPELINE_ARTIFACT_NAMES


PLAN_KEYS = {"version", "reviewed_fixture_sha256", "pipeline", "runs"}
PLANNED_RUN_KEYS = {"schema_id", "case_id", "run_id"}


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def validate_evaluation_plan(
    plan: Any,
    expected_cases: set[tuple[Any, Any]],
    reviewed_fixture_sha256: str,
    pipeline_fingerprints: dict[str, str],
) -> set[tuple[str, str, str]]:
    """Return the exact planned run identities after validating all bindings."""
    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS:
        raise EvaluationEvidenceError(
            "evaluation plan must contain only version, fixture fingerprint, pipeline, and runs"
        )
    if type(plan["version"]) is not int or plan["version"] != 1:
        raise EvaluationEvidenceError("evaluation plan version must be 1")
    fixture_fingerprint = plan["reviewed_fixture_sha256"]
    if not _is_sha256(fixture_fingerprint):
        raise EvaluationEvidenceError(
            "reviewed fixture fingerprint must be a lowercase SHA-256 value"
        )
    if fixture_fingerprint != reviewed_fixture_sha256:
        raise EvaluationEvidenceError(
            "evaluation plan must bind to the exact reviewed fixture"
        )
    pipeline = plan["pipeline"]
    if (
        not isinstance(pipeline, dict)
        or set(pipeline) != set(PIPELINE_ARTIFACT_NAMES)
        or any(not _is_sha256(value) for value in pipeline.values())
        or pipeline != pipeline_fingerprints
    ):
        raise EvaluationEvidenceError(
            "evaluation plan must bind to the exact pipeline artifacts"
        )
    runs = plan["runs"]
    if not isinstance(runs, list):
        raise EvaluationEvidenceError("evaluation plan runs must be a list")

    planned: set[tuple[str, str, str]] = set()
    covered_cases: set[tuple[str, str]] = set()
    for run in runs:
        if not isinstance(run, dict) or set(run) != PLANNED_RUN_KEYS:
            raise EvaluationEvidenceError(
                "planned runs may contain only schema ID, case ID, and run ID"
            )
        values = (run["schema_id"], run["case_id"], run["run_id"])
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise EvaluationEvidenceError("planned run IDs must be non-empty strings")
        identity = values
        case = identity[:2]
        if case not in expected_cases or identity in planned:
            raise EvaluationEvidenceError(
                "evaluation plan must cover fixture cases with unique run IDs"
            )
        planned.add(identity)
        covered_cases.add(case)
    if covered_cases != expected_cases:
        raise EvaluationEvidenceError("evaluation plan must cover every fixture case")
    return planned

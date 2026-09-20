"""Validate planned evaluation recordings and derive required runtime artifacts."""

from __future__ import annotations

from typing import Any

from evaluate import EvaluationEvidenceError
from run_outcome import (
    FAILURE_STAGES,
    NO_FAILURE,
    PREFLIGHT_FAILURE_STAGES,
    SCOPE_DISCOVERY_FAILURE,
)


RECORDED_RUN_KEYS = {"schema_id", "case_id", "run"}


def _require_recorded_fields(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != RECORDED_RUN_KEYS:
        raise EvaluationEvidenceError(
            "recorded entries may contain only schema ID, case ID, and run"
        )
    return value


def _required_artifacts(
    recorded_runs: list[tuple[tuple[Any, Any], dict[str, Any]]],
) -> tuple[set[Any], set[tuple[Any, Any]]]:
    required_scope_schemas: set[Any] = set()
    required_contract_cases: set[tuple[Any, Any]] = set()
    for key, run in recorded_runs:
        failure_stage = run["failure_stage"]
        if failure_stage != SCOPE_DISCOVERY_FAILURE:
            required_scope_schemas.add(key[0])
        if failure_stage not in PREFLIGHT_FAILURE_STAGES:
            required_contract_cases.add(key)
    return required_scope_schemas, required_contract_cases


def validate_recordings(
    recordings: dict[str, Any],
    expected_cases: set[tuple[Any, Any]],
    pipeline_fingerprints: dict[str, str],
    planned_runs: set[tuple[str, str, str]],
) -> tuple[
    list[tuple[tuple[Any, Any], dict[str, Any]]],
    set[Any],
    set[tuple[Any, Any]],
]:
    """Bind every planned run to its case and pipeline, then derive artifact needs."""
    observed_runs: set[tuple[str, str, str]] = set()
    validated: list[tuple[tuple[Any, Any], dict[str, Any]]] = []
    for value in recordings["runs"]:
        recorded = _require_recorded_fields(value)
        key = (recorded["schema_id"], recorded["case_id"])
        if key not in expected_cases:
            raise EvaluationEvidenceError(
                "recorded run does not match a fixture schema and case"
            )
        run = recorded["run"]
        run_id = run.get("run_id") if isinstance(run, dict) else None
        identity = (*key, run_id)
        if identity not in planned_runs or identity in observed_runs:
            raise EvaluationEvidenceError(
                "recorded runs must match planned runs exactly"
            )
        observed_runs.add(identity)
        if not isinstance(run, dict) or any(
            run.get(name) != fingerprint
            for name, fingerprint in pipeline_fingerprints.items()
        ):
            raise EvaluationEvidenceError(
                "recorded runs must bind to the exact runtime, prompt, and configuration artifacts"
            )
        if run.get("failure_stage") not in {NO_FAILURE, *FAILURE_STAGES}:
            raise EvaluationEvidenceError("failure stage is unsupported")
        validated.append((key, run))

    if {key for key, _ in validated} != expected_cases:
        raise EvaluationEvidenceError("each fixture case must have recorded runs")
    if observed_runs != planned_runs:
        raise EvaluationEvidenceError("recorded runs must match planned runs exactly")
    required_scope_schemas, required_contract_cases = _required_artifacts(validated)
    return validated, required_scope_schemas, required_contract_cases

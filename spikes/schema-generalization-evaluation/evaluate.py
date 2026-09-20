#!/usr/bin/env python3
"""Validate and summarize target-independent schema evaluation evidence."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from run_outcome import (
    ANALYSIS_CONTRACT_GENERATION_FAILURE,
    FAILURE_STAGES,
    NO_FAILURE,
    PREFLIGHT_FAILURE_STAGES,
    SCOPE_DISCOVERY_FAILURE,
    RunOutcomeError,
    validate_run_outcome,
)


FINGERPRINT_KEYS = ("runtime", "prompt", "configuration")
FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}")
MINIMUM_RUNS_PER_CASE = 3
MINIMUM_RESULT_MATCH_RATE = 0.9
RUNTIME_INPUT_KEYS = {
    "scope_snapshot_fingerprint",
    "analysis_contract_fingerprint",
    "question",
}
REFERENCE_KEYS = {
    "sql",
    "expected_rows",
    "row_order",
    "author_id",
    "reviewer_id",
    "reviewed_at",
}
RUN_KEYS = {
    "run_id",
    *FINGERPRINT_KEYS,
    "runtime_input",
    "generated_sql",
    "failure_stage",
    "failure_code",
    "sql_execution_succeeded",
    "actual_rows",
    "unauthorized_reference",
    "dangerous_sql",
    "scan_limit_exceeded",
    "semantic_error",
    "render_succeeded",
    "bytes_processed",
    "cost_jpy",
}
RUN_BOOLEAN_KEYS = {
    "sql_execution_succeeded",
    "unauthorized_reference",
    "dangerous_sql",
    "scan_limit_exceeded",
    "semantic_error",
    "render_succeeded",
}


class EvaluationEvidenceError(ValueError):
    """The evaluation evidence cannot be scored safely."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _rows_match(reference: dict[str, Any], actual_rows: list[Any]) -> bool:
    expected_rows = reference["expected_rows"]
    if reference["row_order"] == "ordered":
        return _canonical_json(actual_rows) == _canonical_json(expected_rows)
    return sorted(map(_canonical_json, actual_rows)) == sorted(
        map(_canonical_json, expected_rows)
    )


def _rate(count: int, total: int) -> float:
    return round(count / total, 6) if total else 0.0


def _validate_version(bundle: dict[str, Any]) -> None:
    if not isinstance(bundle, dict):
        raise EvaluationEvidenceError("evidence root must be an object")
    if type(bundle.get("version")) is not int or bundle["version"] != 3:
        raise EvaluationEvidenceError("evidence version must be 3")


def _validate_structure(bundle: dict[str, Any]) -> None:
    schemas = bundle["schemas"]
    if not isinstance(schemas, list) or len(schemas) < 2:
        raise EvaluationEvidenceError("at least two distinct schemas are required")
    schema_ids: set[str] = set()
    scope_fingerprints: set[str] = set()
    for schema in schemas:
        schema_id = schema["schema_id"]
        scope_fingerprint = schema["scope_snapshot_fingerprint"]
        cases = schema["cases"]
        if not isinstance(schema_id, str) or not schema_id.strip():
            raise EvaluationEvidenceError("schema IDs must be non-empty strings")
        if not isinstance(scope_fingerprint, str):
            raise EvaluationEvidenceError("scope snapshot fingerprints must be strings")
        if not isinstance(cases, list) or not cases:
            raise EvaluationEvidenceError("each schema must contain at least one case")
        schema_ids.add(schema_id)
        scope_fingerprints.add(scope_fingerprint)
        case_ids: set[str] = set()
        for case in cases:
            case_id = case["case_id"]
            question = case["question"]
            if (
                not isinstance(case_id, str)
                or not case_id.strip()
                or case_id in case_ids
            ):
                raise EvaluationEvidenceError(
                    "case IDs must be non-empty and unique per schema"
                )
            if not isinstance(question, str) or not question.strip():
                raise EvaluationEvidenceError("case questions must be non-empty strings")
            if not isinstance(case["runs"], list):
                raise EvaluationEvidenceError("case runs must be a list")
            case_ids.add(case_id)
    if len(schema_ids) != len(schemas) or len(scope_fingerprints) != len(schemas):
        raise EvaluationEvidenceError("at least two distinct schemas are required")


def _validate_thresholds(bundle: dict[str, Any]) -> None:
    thresholds = bundle["thresholds"]
    minimum_runs = thresholds["minimum_runs_per_case"]
    minimum_match_rate = thresholds["minimum_result_match_rate"]
    if (
        type(minimum_runs) is not int
        or minimum_runs < MINIMUM_RUNS_PER_CASE
        or not isinstance(minimum_match_rate, (int, float))
        or isinstance(minimum_match_rate, bool)
        or minimum_match_rate < MINIMUM_RESULT_MATCH_RATE
        or minimum_match_rate > 1
    ):
        raise EvaluationEvidenceError(
            "thresholds cannot be lower than the fixed acceptance policy"
        )


def _validate_references(bundle: dict[str, Any]) -> None:
    for schema in bundle["schemas"]:
        for case in schema["cases"]:
            reference = case["reference"]
            if set(reference) != REFERENCE_KEYS:
                raise EvaluationEvidenceError(
                    "reference must contain SQL, expected rows, ordering, and review evidence"
                )
            if reference["row_order"] not in {"ordered", "unordered"}:
                raise EvaluationEvidenceError(
                    "reference row_order must be ordered or unordered"
                )
            if not isinstance(reference["expected_rows"], list):
                raise EvaluationEvidenceError("reference expected_rows must be a list")
            for key in ("sql", "author_id", "reviewer_id", "reviewed_at"):
                if not isinstance(reference[key], str) or not reference[key].strip():
                    raise EvaluationEvidenceError(f"reference {key} must be a non-empty string")


def _validate_runs(bundle: dict[str, Any]) -> None:
    for schema in bundle["schemas"]:
        for case in schema["cases"]:
            run_ids: set[str] = set()
            for run in case["runs"]:
                if set(run) != RUN_KEYS:
                    raise EvaluationEvidenceError("run contains unsupported or missing fields")
                run_id = run["run_id"]
                if not isinstance(run_id, str) or not run_id.strip() or run_id in run_ids:
                    raise EvaluationEvidenceError("run IDs must be non-empty and unique per case")
                run_ids.add(run_id)
                if not all(type(run[key]) is bool for key in RUN_BOOLEAN_KEYS):
                    raise EvaluationEvidenceError(
                        "run safety and outcome fields must be booleans"
                    )
                if not isinstance(run["generated_sql"], str) or not isinstance(
                    run["actual_rows"], list
                ):
                    raise EvaluationEvidenceError(
                        "generated_sql must be a string and actual_rows must be a list"
                    )
                if type(run["bytes_processed"]) is not int or run["bytes_processed"] < 0:
                    raise EvaluationEvidenceError(
                        "bytes_processed must be a non-negative integer"
                    )
                cost = run["cost_jpy"]
                if (
                    not isinstance(cost, (int, float))
                    or isinstance(cost, bool)
                    or not math.isfinite(cost)
                    or cost < 0
                ):
                    raise EvaluationEvidenceError("cost_jpy must be finite and non-negative")
                try:
                    validate_run_outcome(run)
                except RunOutcomeError as error:
                    raise EvaluationEvidenceError(str(error)) from None


def _validate_fingerprints(bundle: dict[str, Any]) -> None:
    observed: set[tuple[str, ...]] = set()
    for schema in bundle["schemas"]:
        for case in schema["cases"]:
            for run in case["runs"]:
                fingerprints = tuple(run[key] for key in FINGERPRINT_KEYS)
                if not all(
                    isinstance(value, str) and FINGERPRINT_PATTERN.fullmatch(value)
                    for value in fingerprints
                ):
                    raise EvaluationEvidenceError(
                        "run fingerprints must be lowercase SHA-256 values"
                    )
                observed.add(fingerprints)
    if len(observed) != 1:
        raise EvaluationEvidenceError(
            "all runs must use one runtime, prompt, and configuration fingerprint"
        )


def _validate_runtime_inputs(bundle: dict[str, Any]) -> None:
    for schema in bundle["schemas"]:
        scope_fingerprint = schema["scope_snapshot_fingerprint"]
        if not (
            isinstance(scope_fingerprint, str)
            and FINGERPRINT_PATTERN.fullmatch(scope_fingerprint)
        ):
            raise EvaluationEvidenceError(
                "scope snapshot fingerprints must be lowercase SHA-256 values"
            )
        for case in schema["cases"]:
            contract_fingerprints: set[str] = set()
            for run in case["runs"]:
                runtime_input = run["runtime_input"]
                if (
                    not isinstance(runtime_input, dict)
                    or set(runtime_input) != RUNTIME_INPUT_KEYS
                ):
                    raise EvaluationEvidenceError(
                        "runtime_input may contain only scope, contract, and question"
                    )
                failure_stage = run["failure_stage"]
                observed_scope = runtime_input["scope_snapshot_fingerprint"]
                contract_fingerprint = runtime_input["analysis_contract_fingerprint"]
                if runtime_input["question"] != case["question"]:
                    raise EvaluationEvidenceError(
                        "runtime_input must match its schema scope and case question"
                    )
                if failure_stage == SCOPE_DISCOVERY_FAILURE:
                    valid = observed_scope is None and contract_fingerprint is None
                elif failure_stage == ANALYSIS_CONTRACT_GENERATION_FAILURE:
                    valid = (
                        observed_scope == scope_fingerprint
                        and contract_fingerprint is None
                    )
                else:
                    valid = (
                        observed_scope == scope_fingerprint
                        and isinstance(contract_fingerprint, str)
                        and FINGERPRINT_PATTERN.fullmatch(contract_fingerprint) is not None
                    )
                if not valid:
                    raise EvaluationEvidenceError(
                        "runtime_input must match its failure stage and available fingerprints"
                    )
                if failure_stage not in PREFLIGHT_FAILURE_STAGES:
                    contract_fingerprints.add(contract_fingerprint)
            if len(contract_fingerprints) > 1:
                raise EvaluationEvidenceError(
                    "each case must reproduce one analysis contract fingerprint"
                )


def _summarize_schema(schema: dict[str, Any], thresholds: dict[str, Any]) -> dict[str, Any]:
    cases = schema["cases"]
    runs = [
        (case["reference"], run)
        for case in cases
        for run in case["runs"]
    ]
    run_count = len(runs)
    execution_successes = sum(run["sql_execution_succeeded"] for _, run in runs)
    result_matches = sum(
        run["sql_execution_succeeded"]
        and run["failure_stage"] != "result_validation"
        and _rows_match(reference, run["actual_rows"])
        for reference, run in runs
    )
    render_successes = sum(run["render_succeeded"] for _, run in runs)
    failure_stage_counts = {
        stage: sum(run["failure_stage"] == stage for _, run in runs)
        for stage in FAILURE_STAGES
        if any(run["failure_stage"] == stage for _, run in runs)
    }
    failure_count = sum(run["failure_stage"] != NO_FAILURE for _, run in runs)
    semantic_errors = sum(run["semantic_error"] for _, run in runs)
    unauthorized_references = sum(run["unauthorized_reference"] for _, run in runs)
    dangerous_sql = sum(run["dangerous_sql"] for _, run in runs)
    scan_limit_exceeded = sum(run["scan_limit_exceeded"] for _, run in runs)
    minimum_runs = thresholds["minimum_runs_per_case"]
    has_enough_runs = all(len(case["runs"]) >= minimum_runs for case in cases)
    independently_reviewed = all(
        case["reference"]["author_id"] != case["reference"]["reviewer_id"]
        and bool(case["reference"]["reviewed_at"])
        for case in cases
    )
    result_match_rate = _rate(result_matches, run_count)
    passed = (
        bool(cases)
        and has_enough_runs
        and independently_reviewed
        and result_match_rate >= thresholds["minimum_result_match_rate"]
        and semantic_errors == 0
        and unauthorized_references == 0
        and dangerous_sql == 0
        and scan_limit_exceeded == 0
    )
    return {
        "schema_id": schema["schema_id"],
        "case_count": len(cases),
        "run_count": run_count,
        "failure_count": failure_count,
        "failure_stage_counts": failure_stage_counts,
        "sql_execution_success_rate": _rate(execution_successes, run_count),
        "result_match_rate": result_match_rate,
        "render_success_rate": _rate(render_successes, run_count),
        "semantic_error_rate": _rate(semantic_errors, run_count),
        "unauthorized_reference_count": unauthorized_references,
        "dangerous_sql_count": dangerous_sql,
        "scan_limit_exceeded_count": scan_limit_exceeded,
        "total_bytes_processed": sum(run["bytes_processed"] for _, run in runs),
        "total_cost_jpy": round(sum(run["cost_jpy"] for _, run in runs), 6),
        "passed": passed,
    }


def evaluate_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return deterministic aggregate evidence without calling the analysis runtime."""
    _validate_version(bundle)
    _validate_structure(bundle)
    _validate_thresholds(bundle)
    _validate_references(bundle)
    _validate_runs(bundle)
    _validate_runtime_inputs(bundle)
    _validate_fingerprints(bundle)
    thresholds = bundle["thresholds"]
    schemas = [_summarize_schema(schema, thresholds) for schema in bundle["schemas"]]
    run_count = sum(schema["run_count"] for schema in schemas)
    matching_runs = sum(
        round(schema["result_match_rate"] * schema["run_count"])
        for schema in schemas
    )
    return {
        "version": bundle["version"],
        "schema_count": len(schemas),
        "run_count": run_count,
        "result_match_rate": _rate(matching_runs, run_count),
        "schemas": schemas,
        "passed": len(schemas) >= 2 and all(schema["passed"] for schema in schemas),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: evaluate.py <evidence-bundle.json>", file=sys.stderr)
        return 2
    try:
        bundle = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        report = evaluate_bundle(bundle)
    except (EvaluationEvidenceError, KeyError, TypeError, json.JSONDecodeError, OSError) as error:
        print(f"invalid evaluation evidence: {error}", file=sys.stderr)
        return 2
    print(_canonical_json(report))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

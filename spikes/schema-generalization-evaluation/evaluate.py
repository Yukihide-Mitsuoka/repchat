#!/usr/bin/env python3
"""Validate and summarize target-independent schema evaluation evidence."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


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
        and _rows_match(reference, run["actual_rows"])
        for reference, run in runs
    )
    render_successes = sum(run["render_succeeded"] for _, run in runs)
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
        and unauthorized_references == 0
        and dangerous_sql == 0
        and scan_limit_exceeded == 0
    )
    return {
        "schema_id": schema["schema_id"],
        "case_count": len(cases),
        "run_count": run_count,
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
    bundle = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    report = evaluate_bundle(bundle)
    print(_canonical_json(report))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

#!/usr/bin/env python3
"""Compare paired evaluation evidence without combining diagnostic and normal scores."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from evaluate import EvaluationEvidenceError, evaluate_bundle
from run_outcome import PREFLIGHT_FAILURE_STAGES


MAX_INPUT_BYTES = 16 * 1024 * 1024
PIPELINE_KEYS = ("runtime", "prompt", "configuration")


class EvidenceComparisonError(ValueError):
    """The two bundles cannot support a controlled contract comparison."""


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceComparisonError("duplicate JSON field")
        result[key] = value
    return result


def _read_bundle(path: str) -> dict[str, Any]:
    with Path(path).open("rb") as source:
        content = source.read(MAX_INPUT_BYTES + 1)
    if not content or len(content) > MAX_INPUT_BYTES:
        raise EvidenceComparisonError("evidence input size is invalid")
    return json.loads(content.decode("utf-8"), object_pairs_hook=_unique_pairs)


def _cases(bundle: dict[str, Any]) -> dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]]:
    return {
        (schema["schema_id"], case["case_id"]): (schema, case)
        for schema in bundle["schemas"]
        for case in schema["cases"]
    }


def _contract_fingerprint(case: dict[str, Any]) -> str | None:
    for run in case["runs"]:
        if run["failure_stage"] not in PREFLIGHT_FAILURE_STAGES:
            return run["runtime_input"]["analysis_contract_fingerprint"]
    return None


def _case_reports(report: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (schema["schema_id"], case["case_id"]): case
        for schema in report["schemas"]
        for case in schema["cases"]
    }


def _summary(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "passed": report["passed"],
        "result_match_rate": report["result_match_rate"],
        "total_bytes_processed": sum(
            schema["total_bytes_processed"] for schema in report["schemas"]
        ),
        "total_cost_jpy": round(
            sum(schema["total_cost_jpy"] for schema in report["schemas"]), 6
        ),
    }


def compare_bundles(
    baseline: dict[str, Any], diagnostic: dict[str, Any]
) -> dict[str, Any]:
    """Return separate scores for identical cases with a changed contract input."""
    baseline_report = evaluate_bundle(baseline)
    diagnostic_report = evaluate_bundle(diagnostic)
    if (
        baseline_report["infrastructure_failure_count"]
        or diagnostic_report["infrastructure_failure_count"]
    ):
        raise EvidenceComparisonError("infrastructure failures invalidate comparison")
    if baseline["thresholds"] != diagnostic["thresholds"]:
        raise EvidenceComparisonError("acceptance thresholds differ")

    baseline_cases = _cases(baseline)
    diagnostic_cases = _cases(diagnostic)
    if baseline_cases.keys() != diagnostic_cases.keys():
        raise EvidenceComparisonError("schema or case identities differ")

    baseline_run = next(iter(next(iter(baseline_cases.values()))[1]["runs"]))
    diagnostic_run = next(iter(next(iter(diagnostic_cases.values()))[1]["runs"]))
    if any(baseline_run[key] != diagnostic_run[key] for key in PIPELINE_KEYS):
        raise EvidenceComparisonError("runtime, prompt, or configuration differs")

    changed_count = 0
    baseline_rates = _case_reports(baseline_report)
    diagnostic_rates = _case_reports(diagnostic_report)
    cases = []
    for identity in sorted(baseline_cases):
        baseline_schema, baseline_case = baseline_cases[identity]
        diagnostic_schema, diagnostic_case = diagnostic_cases[identity]
        reference = baseline_case["reference"]
        if reference["author_id"].strip() == reference["reviewer_id"].strip():
            raise EvidenceComparisonError("reference lacks a distinct reviewer ID")
        if (
            baseline_schema["scope_snapshot_fingerprint"]
            != diagnostic_schema["scope_snapshot_fingerprint"]
            or any(
                baseline_case[key] != diagnostic_case[key]
                for key in ("question", "capabilities", "reference")
            )
            or {run["run_id"] for run in baseline_case["runs"]}
            != {run["run_id"] for run in diagnostic_case["runs"]}
        ):
            raise EvidenceComparisonError("paired fixture or planned runs differ")
        diagnostic_contract = _contract_fingerprint(diagnostic_case)
        if diagnostic_contract is None:
            raise EvidenceComparisonError("diagnostic contract was not recorded")
        changed = _contract_fingerprint(baseline_case) != diagnostic_contract
        changed_count += changed
        cases.append({
            "schema_id": identity[0],
            "case_id": identity[1],
            "contract_changed": changed,
            "baseline_result_match_rate": baseline_rates[identity]["result_match_rate"],
            "diagnostic_result_match_rate": diagnostic_rates[identity]["result_match_rate"],
        })
    if not changed_count:
        raise EvidenceComparisonError("no analysis contract changed")
    return {
        "version": 1,
        "contract_changed_case_count": changed_count,
        "baseline": _summary(baseline_report),
        "diagnostic": _summary(diagnostic_report),
        "cases": cases,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: compare_evidence.py <baseline.json> <diagnostic.json>", file=sys.stderr)
        return 2
    try:
        report = compare_bundles(_read_bundle(argv[1]), _read_bundle(argv[2]))
    except (
        EvidenceComparisonError, EvaluationEvidenceError, OSError, UnicodeError,
        json.JSONDecodeError, KeyError, TypeError, StopIteration,
    ) as error:
        print(f"invalid paired evidence: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

#!/usr/bin/env python3
"""Assemble reviewed references and separately recorded runtime runs."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

from evaluate import EvaluationEvidenceError, evaluate_bundle


FIXTURE_KEYS = {"version", "thresholds", "schemas"}
FIXTURE_SCHEMA_KEYS = {"schema_id", "scope_snapshot_fingerprint", "cases"}
FIXTURE_CASE_KEYS = {"case_id", "question", "reference"}
RECORDINGS_KEYS = {"version", "runs"}
RECORDED_RUN_KEYS = {"schema_id", "case_id", "run"}


def _require_fields(value: Any, expected: set[str], message: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise EvaluationEvidenceError(message)
    return value


def assemble_bundle(
    fixture: dict[str, Any], recordings: dict[str, Any]
) -> dict[str, Any]:
    """Join run records to reviewed cases without exposing references to runtime input."""
    _require_fields(
        fixture,
        FIXTURE_KEYS,
        "fixture must contain only version, thresholds, and schemas",
    )
    _require_fields(
        recordings,
        RECORDINGS_KEYS,
        "recordings must contain only version and runs",
    )
    if recordings["version"] != 1:
        raise EvaluationEvidenceError("recordings version must be 1")
    if not isinstance(fixture["schemas"], list):
        raise EvaluationEvidenceError("fixture schemas must be a list")
    if not isinstance(recordings["runs"], list):
        raise EvaluationEvidenceError("recordings runs must be a list")

    bundle = {
        "version": fixture["version"],
        "thresholds": copy.deepcopy(fixture["thresholds"]),
        "schemas": [],
    }
    cases: dict[tuple[Any, Any], dict[str, Any]] = {}
    for schema in fixture["schemas"]:
        schema = _require_fields(
            schema,
            FIXTURE_SCHEMA_KEYS,
            "fixture schemas may contain only ID, scope fingerprint, and cases",
        )
        if not isinstance(schema["cases"], list):
            raise EvaluationEvidenceError("fixture schema cases must be a list")
        assembled_schema = {
            "schema_id": schema["schema_id"],
            "scope_snapshot_fingerprint": schema["scope_snapshot_fingerprint"],
            "cases": [],
        }
        bundle["schemas"].append(assembled_schema)
        for fixture_case in schema["cases"]:
            fixture_case = _require_fields(
                fixture_case,
                FIXTURE_CASE_KEYS,
                "fixture cases may contain only ID, question, and reference",
            )
            key = (schema["schema_id"], fixture_case["case_id"])
            if key in cases:
                raise EvaluationEvidenceError(
                    "fixture schema and case IDs must form unique pairs"
                )
            assembled_case = {
                "case_id": fixture_case["case_id"],
                "question": fixture_case["question"],
                "reference": copy.deepcopy(fixture_case["reference"]),
                "runs": [],
            }
            assembled_schema["cases"].append(assembled_case)
            cases[key] = assembled_case

    for recorded in recordings["runs"]:
        recorded = _require_fields(
            recorded,
            RECORDED_RUN_KEYS,
            "recorded entries may contain only schema ID, case ID, and run",
        )
        key = (recorded["schema_id"], recorded["case_id"])
        if key not in cases:
            raise EvaluationEvidenceError(
                "recorded run does not match a fixture schema and case"
            )
        cases[key]["runs"].append(copy.deepcopy(recorded["run"]))

    if any(not assembled_case["runs"] for assembled_case in cases.values()):
        raise EvaluationEvidenceError("each fixture case must have recorded runs")
    evaluate_bundle(bundle)
    return bundle


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: assemble.py <reviewed-fixture.json> <recorded-runs.json>", file=sys.stderr)
        return 2
    try:
        fixture = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        recordings = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        bundle = assemble_bundle(fixture, recordings)
    except (EvaluationEvidenceError, KeyError, TypeError, json.JSONDecodeError, OSError) as error:
        print(f"invalid separated evaluation evidence: {error}", file=sys.stderr)
        return 2
    print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

#!/usr/bin/env python3
"""Project reviewed cases into a reference-free evaluation runtime manifest."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

from bigquery_scope_discovery import (  # noqa: E402 - sibling spike import
    AuthorizedScope,
    ScopeDiscoveryError,
)
from evaluate import (  # noqa: E402 - local import after path setup
    EvaluationEvidenceError,
    MINIMUM_RESULT_MATCH_RATE,
    MINIMUM_RUNS_PER_CASE,
)
from evaluation_capabilities import (  # noqa: E402 - local import after path setup
    EvaluationCapabilityError,
    validate_schema_capabilities,
)
from evaluation_plan import validate_evaluation_plan  # noqa: E402 - local import after path setup
from pipeline_artifacts import (  # noqa: E402 - local import after path setup
    fingerprint_pipeline_artifacts,
)


FIXTURE_KEYS = {"version", "thresholds", "schemas"}
FIXTURE_SCHEMA_KEYS = {"schema_id", "scope_snapshot_fingerprint", "cases"}
FIXTURE_CASE_KEYS = {"case_id", "question", "reference", "capabilities"}
REFERENCE_KEYS = {
    "sql",
    "expected_rows",
    "row_order",
    "author_id",
    "reviewer_id",
    "reviewed_at",
}
AUTHORIZATION_KEYS = {"version", "schemas"}
AUTHORIZATION_SCHEMA_KEYS = {"schema_id", "datasets", "tables"}


def _require_fields(value: Any, expected: set[str], message: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise EvaluationEvidenceError(message)
    return value


def _validate_reference(value: Any) -> None:
    reference = _require_fields(
        value, REFERENCE_KEYS, "fixture reference fields are invalid"
    )
    if (
        not isinstance(reference["expected_rows"], list)
        or reference["row_order"] not in ("ordered", "unordered")
        or any(
            not isinstance(reference[key], str) or not reference[key].strip()
            for key in ("sql", "author_id", "reviewer_id", "reviewed_at")
        )
    ):
        raise EvaluationEvidenceError("fixture reference values are invalid")
    if reference["author_id"].strip() == reference["reviewer_id"].strip():
        raise EvaluationEvidenceError(
            "fixture reference reviewer must differ from author"
        )


def _fixture_cases(fixture: Any) -> tuple[list[str], dict[tuple[str, str], str]]:
    fixture = _require_fields(
        fixture, FIXTURE_KEYS, "fixture must contain only version, thresholds, and schemas"
    )
    if type(fixture["version"]) is not int or fixture["version"] != 2:
        raise EvaluationEvidenceError("fixture version must be 2")
    thresholds = _require_fields(
        fixture["thresholds"],
        {"minimum_runs_per_case", "minimum_result_match_rate"},
        "fixture thresholds are invalid",
    )
    minimum_runs = thresholds["minimum_runs_per_case"]
    match_rate = thresholds["minimum_result_match_rate"]
    if (
        type(minimum_runs) is not int
        or minimum_runs < MINIMUM_RUNS_PER_CASE
        or isinstance(match_rate, bool)
        or not isinstance(match_rate, (int, float))
        or not MINIMUM_RESULT_MATCH_RATE <= match_rate <= 1
    ):
        raise EvaluationEvidenceError(
            "thresholds cannot be lower than the fixed acceptance policy"
        )
    if not isinstance(fixture["schemas"], list):
        raise EvaluationEvidenceError("fixture schemas must be a list")
    schema_ids: list[str] = []
    scope_fingerprints: set[str] = set()
    cases: dict[tuple[str, str], str] = {}
    for raw_schema in fixture["schemas"]:
        schema = _require_fields(raw_schema, FIXTURE_SCHEMA_KEYS, "fixture schema fields are invalid")
        schema_id = schema["schema_id"]
        fingerprint = schema["scope_snapshot_fingerprint"]
        if (
            not isinstance(schema_id, str)
            or not schema_id.strip()
            or schema_id in schema_ids
            or not isinstance(fingerprint, str)
            or len(fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in fingerprint)
            or not isinstance(schema["cases"], list)
            or not schema["cases"]
        ):
            raise EvaluationEvidenceError("fixture schema IDs and cases are invalid")
        schema_ids.append(schema_id)
        scope_fingerprints.add(fingerprint)
        for raw_case in schema["cases"]:
            case = _require_fields(raw_case, FIXTURE_CASE_KEYS, "fixture case fields are invalid")
            _validate_reference(case["reference"])
            key = (schema_id, case["case_id"])
            question = case["question"]
            if (
                not isinstance(key[1], str)
                or not key[1].strip()
                or key in cases
                or not isinstance(question, str)
                or not question.strip()
            ):
                raise EvaluationEvidenceError("fixture case IDs and questions are invalid")
            cases[key] = question
        try:
            validate_schema_capabilities(schema["cases"])
        except EvaluationCapabilityError:
            raise EvaluationEvidenceError(
                "each fixture schema must cover every required capability"
            ) from None
    if len(schema_ids) < 2 or len(scope_fingerprints) != len(schema_ids):
        raise EvaluationEvidenceError("at least two distinct schemas are required")
    return schema_ids, cases


def _authorized_scopes(authorization: Any) -> dict[str, AuthorizedScope]:
    authorization = _require_fields(
        authorization, AUTHORIZATION_KEYS, "authorization fields are invalid"
    )
    if type(authorization["version"]) is not int or authorization["version"] != 1:
        raise EvaluationEvidenceError("authorization version must be 1")
    if not isinstance(authorization["schemas"], list):
        raise EvaluationEvidenceError("authorization schemas must be a list")
    scopes: dict[str, AuthorizedScope] = {}
    for raw in authorization["schemas"]:
        item = _require_fields(
            raw, AUTHORIZATION_SCHEMA_KEYS, "authorization schema fields are invalid"
        )
        schema_id, datasets, tables = item["schema_id"], item["datasets"], item["tables"]
        if (
            not isinstance(schema_id, str)
            or not schema_id.strip()
            or schema_id in scopes
            or not isinstance(datasets, list)
            or not isinstance(tables, list)
            or len(datasets) != len(set(datasets))
            or len(tables) != len(set(tables))
        ):
            raise EvaluationEvidenceError("authorization schema scopes are invalid")
        try:
            scopes[schema_id] = AuthorizedScope(
                datasets=frozenset(datasets),
                tables=frozenset(tables),
            )
        except (ScopeDiscoveryError, TypeError):
            raise EvaluationEvidenceError("authorization schema scopes are invalid") from None
    return scopes


def build_execution_manifest(
    fixture: Any,
    evaluation_plan: Any,
    authorization: Any,
    reviewed_fixture_sha256: str,
    evaluation_plan_sha256: str,
    pipeline_fingerprints: dict[str, str],
) -> dict[str, Any]:
    """Return only the authorized inputs needed by the evaluation runtime."""
    schema_ids, fixture_cases = _fixture_cases(fixture)
    scopes = _authorized_scopes(authorization)
    if set(scopes) != set(schema_ids):
        raise EvaluationEvidenceError(
            "authorization scopes must match fixture schema IDs exactly"
        )
    pipeline = evaluation_plan.get("pipeline") if isinstance(evaluation_plan, dict) else None
    validate_evaluation_plan(
        evaluation_plan,
        set(fixture_cases),
        reviewed_fixture_sha256,
        pipeline_fingerprints,
    )
    run_ids: dict[tuple[str, str], list[str]] = {key: [] for key in fixture_cases}
    for run in evaluation_plan["runs"]:
        schema_id, case_id, run_id = (
            run["schema_id"],
            run["case_id"],
            run["run_id"],
        )
        run_ids[(schema_id, case_id)].append(run_id)
    if any(
        len(ids) < fixture["thresholds"]["minimum_runs_per_case"]
        for ids in run_ids.values()
    ):
        raise EvaluationEvidenceError(
            "at least the fixture minimum planned runs per case are required"
        )
    return {
        "version": 1,
        "evaluation_plan_sha256": evaluation_plan_sha256,
        "pipeline": dict(pipeline),
        "schemas": [
            {
                "schema_id": schema_id,
                "authorized_scope": {
                    "datasets": sorted(scopes[schema_id].datasets),
                    "tables": sorted(scopes[schema_id].tables),
                },
                "cases": [
                    {
                        "case_id": case_id,
                        "question": question,
                        "run_ids": run_ids[(schema_id, case_id)],
                    }
                    for (candidate_schema, case_id), question in fixture_cases.items()
                    if candidate_schema == schema_id
                ],
            }
            for schema_id in schema_ids
        ],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 8:
        print(
            "usage: execution_manifest.py <fixture> <plan> <authorization> "
            "<runtime-artifact> <prompt-artifact> <configuration-artifact> <output>",
            file=sys.stderr,
        )
        return 2
    try:
        fixture_bytes = Path(argv[1]).read_bytes()
        plan_bytes = Path(argv[2]).read_bytes()
        fixture = json.loads(fixture_bytes.decode("utf-8"))
        evaluation_plan = json.loads(plan_bytes.decode("utf-8"))
        authorization = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        try:
            pipeline_fingerprints = fingerprint_pipeline_artifacts(
                {
                    "runtime": Path(argv[4]),
                    "prompt": Path(argv[5]),
                    "configuration": Path(argv[6]),
                }
            )
        except OSError:
            raise EvaluationEvidenceError("pipeline artifact cannot be read") from None
        manifest = build_execution_manifest(
            fixture,
            evaluation_plan,
            authorization,
            hashlib.sha256(fixture_bytes).hexdigest(),
            hashlib.sha256(plan_bytes).hexdigest(),
            pipeline_fingerprints,
        )
        output = Path(argv[7])
        if output.resolve() in {Path(value).resolve() for value in argv[1:7]}:
            raise EvaluationEvidenceError("manifest output must not overwrite an input")
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(manifest, target, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except FileExistsError:
        print("invalid execution manifest: output already exists", file=sys.stderr)
        return 2
    except (EvaluationEvidenceError, KeyError, TypeError, UnicodeDecodeError,
            json.JSONDecodeError, OSError) as error:
        print(f"invalid execution manifest: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

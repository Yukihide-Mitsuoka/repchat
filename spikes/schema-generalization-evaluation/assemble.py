#!/usr/bin/env python3
"""Assemble reviewed references and separately recorded runtime runs."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from analysis_contract_artifact import validate_analysis_contracts
from evaluation_plan import validate_evaluation_plan
from evaluate import EvaluationEvidenceError, evaluate_bundle
from pipeline_artifacts import fingerprint_pipeline_artifacts


FIXTURE_KEYS = {"version", "thresholds", "schemas"}
FIXTURE_SCHEMA_KEYS = {"schema_id", "scope_snapshot_fingerprint", "cases"}
FIXTURE_CASE_KEYS = {"case_id", "question", "reference", "capabilities"}
RECORDINGS_KEYS = {"version", "evaluation_plan_sha256", "runs"}
RECORDED_RUN_KEYS = {"schema_id", "case_id", "run"}
SCOPE_SNAPSHOTS_KEYS = {"version", "snapshots"}
SCOPE_SNAPSHOT_KEYS = {"schema_id", "content_json", "retrieved_at"}
REQUIRED_CAPABILITIES = frozenset({
    "nested_unnest",
    "multi_level_nesting",
    "join",
    "period_comparison",
    "window_function",
    "ordered_behavior",
})


def _require_fields(value: Any, expected: set[str], message: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise EvaluationEvidenceError(message)
    return value


def _fingerprint_json(value: Any) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _assemble_fixture(
    fixture: dict[str, Any],
) -> tuple[dict[str, Any], dict[tuple[Any, Any], dict[str, Any]]]:
    bundle = {
        "version": 1,
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
        covered_capabilities: set[str] = set()
        for fixture_case in schema["cases"]:
            fixture_case = _require_fields(
                fixture_case,
                FIXTURE_CASE_KEYS,
                "fixture cases may contain only ID, question, and reference; capabilities are required",
            )
            capabilities = fixture_case["capabilities"]
            if (
                not isinstance(capabilities, list)
                or not capabilities
                or any(
                    not isinstance(value, str) or value not in REQUIRED_CAPABILITIES
                    for value in capabilities
                )
                or len(capabilities) != len(set(capabilities))
            ):
                raise EvaluationEvidenceError("fixture case capabilities are invalid")
            covered_capabilities.update(capabilities)
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
        if covered_capabilities != REQUIRED_CAPABILITIES:
            raise EvaluationEvidenceError(
                "each fixture schema must cover every required capability"
            )
    return bundle, cases


def _attach_recordings(
    recordings: dict[str, Any],
    cases: dict[tuple[Any, Any], dict[str, Any]],
    contract_fingerprints: dict[tuple[Any, Any], str],
    pipeline_fingerprints: dict[str, str],
    planned_runs: set[tuple[str, str, str]],
) -> None:
    observed_runs: set[tuple[str, str, str]] = set()
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
        run = recorded["run"]
        run_id = run.get("run_id") if isinstance(run, dict) else None
        run_identity = (recorded["schema_id"], recorded["case_id"], run_id)
        if run_identity not in planned_runs or run_identity in observed_runs:
            raise EvaluationEvidenceError(
                "recorded runs must match planned runs exactly"
            )
        observed_runs.add(run_identity)
        if not isinstance(run, dict) or any(
            run.get(name) != fingerprint
            for name, fingerprint in pipeline_fingerprints.items()
        ):
            raise EvaluationEvidenceError(
                "recorded runs must bind to the exact runtime, prompt, and configuration artifacts"
            )
        runtime_input = run.get("runtime_input") if isinstance(run, dict) else None
        if (
            not isinstance(runtime_input, dict)
            or runtime_input.get("analysis_contract_fingerprint")
            != contract_fingerprints[key]
        ):
            raise EvaluationEvidenceError(
                "analysis contract content must match recorded run fingerprint"
            )
        cases[key]["runs"].append(copy.deepcopy(run))

    if any(not assembled_case["runs"] for assembled_case in cases.values()):
        raise EvaluationEvidenceError("each fixture case must have recorded runs")
    if observed_runs != planned_runs:
        raise EvaluationEvidenceError("recorded runs must match planned runs exactly")


def _validate_scope_snapshots(
    scope_snapshots: dict[str, Any], bundle: dict[str, Any]
) -> dict[Any, dict[str, str]]:
    _require_fields(
        scope_snapshots,
        SCOPE_SNAPSHOTS_KEYS,
        "scope snapshots must contain only version and snapshots",
    )
    if type(scope_snapshots["version"]) is not int or scope_snapshots["version"] != 1:
        raise EvaluationEvidenceError("scope snapshots version must be 1")
    snapshots = scope_snapshots["snapshots"]
    if not isinstance(snapshots, list):
        raise EvaluationEvidenceError("scope snapshots must be a list")

    expected = {
        schema["schema_id"]: schema["scope_snapshot_fingerprint"]
        for schema in bundle["schemas"]
    }
    observed: dict[Any, dict[str, str]] = {}
    for snapshot in snapshots:
        snapshot = _require_fields(
            snapshot,
            SCOPE_SNAPSHOT_KEYS,
            "scope snapshot entries may contain only schema ID, content, and retrieval time",
        )
        schema_id = snapshot["schema_id"]
        if schema_id in observed:
            raise EvaluationEvidenceError(
                "scope snapshots must match fixture schema IDs exactly"
            )
        content_json = snapshot["content_json"]
        if not isinstance(content_json, str) or not content_json:
            raise EvaluationEvidenceError("scope snapshot content must be canonical JSON")
        try:
            content = json.loads(content_json)
        except (TypeError, json.JSONDecodeError):
            raise EvaluationEvidenceError(
                "scope snapshot content must be canonical JSON"
            ) from None
        canonical = json.dumps(
            content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        if content_json != canonical:
            raise EvaluationEvidenceError(
                "scope snapshot content must be canonical JSON"
            )
        retrieved_at = snapshot["retrieved_at"]
        try:
            retrieved = datetime.fromisoformat(retrieved_at)
        except (TypeError, ValueError):
            raise EvaluationEvidenceError(
                "scope snapshot retrieval time must include a timezone"
            ) from None
        if retrieved.tzinfo is None:
            raise EvaluationEvidenceError(
                "scope snapshot retrieval time must include a timezone"
            )
        fingerprint = hashlib.sha256(content_json.encode("utf-8")).hexdigest()
        if schema_id not in expected:
            raise EvaluationEvidenceError(
                "scope snapshots must match fixture schema IDs exactly"
            )
        if fingerprint != expected[schema_id]:
            raise EvaluationEvidenceError(
                "scope snapshot content must match its fixture fingerprint"
            )
        schema = content.get("schema") if isinstance(content, dict) else None
        schema_fingerprint = schema.get("fingerprint") if isinstance(schema, dict) else None
        schema_metadata = schema.get("metadata") if isinstance(schema, dict) else None
        if (
            not isinstance(schema_fingerprint, str)
            or not isinstance(schema_metadata, dict)
            or schema_fingerprint != _fingerprint_json(schema_metadata)
        ):
            raise EvaluationEvidenceError("scope snapshot schema observation is invalid")
        observed[schema_id] = {
            "fingerprint": fingerprint,
            "schema_fingerprint": schema_fingerprint,
            "retrieved_at": retrieved_at,
        }

    if set(observed) != set(expected) or len(observed) != len(bundle["schemas"]):
        raise EvaluationEvidenceError(
            "scope snapshots must match fixture schema IDs exactly"
        )
    if {
        schema_id: observation["fingerprint"]
        for schema_id, observation in observed.items()
    } != expected:
        raise EvaluationEvidenceError(
            "scope snapshot content must match its fixture fingerprint"
        )
    return observed


def assemble_bundle(
    fixture: dict[str, Any],
    evaluation_plan: dict[str, Any],
    recordings: dict[str, Any],
    scope_snapshots: dict[str, Any],
    analysis_contracts: dict[str, Any],
    reviewed_fixture_sha256: str,
    evaluation_plan_sha256: str,
    pipeline_fingerprints: dict[str, str],
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
        "recordings must contain only version, evaluation plan fingerprint, and runs",
    )
    if type(fixture["version"]) is not int or fixture["version"] != 2:
        raise EvaluationEvidenceError("fixture version must be 2")
    if type(recordings["version"]) is not int or recordings["version"] != 3:
        raise EvaluationEvidenceError("recordings version must be 3")
    if not isinstance(fixture["schemas"], list):
        raise EvaluationEvidenceError("fixture schemas must be a list")
    if not isinstance(recordings["runs"], list):
        raise EvaluationEvidenceError("recordings runs must be a list")

    bundle, cases = _assemble_fixture(fixture)
    recorded_plan_sha256 = recordings["evaluation_plan_sha256"]
    if not (
        isinstance(recorded_plan_sha256, str)
        and len(recorded_plan_sha256) == 64
        and all(character in "0123456789abcdef" for character in recorded_plan_sha256)
    ):
        raise EvaluationEvidenceError(
            "evaluation plan fingerprint must be a lowercase SHA-256 value"
        )
    if recorded_plan_sha256 != evaluation_plan_sha256:
        raise EvaluationEvidenceError("recordings must bind to the exact evaluation plan")
    planned_runs = validate_evaluation_plan(
        evaluation_plan,
        set(cases),
        reviewed_fixture_sha256,
        pipeline_fingerprints,
    )
    scope_observations = _validate_scope_snapshots(scope_snapshots, bundle)
    contract_fingerprints = validate_analysis_contracts(
        analysis_contracts,
        set(cases),
        scope_observations,
    )
    _attach_recordings(
        recordings,
        cases,
        contract_fingerprints,
        pipeline_fingerprints,
        planned_runs,
    )
    evaluate_bundle(bundle)
    return bundle


def main(argv: list[str]) -> int:
    if len(argv) != 10:
        print(
            "usage: assemble.py <reviewed-fixture.json> <evaluation-plan.json> "
            "<recorded-runs.json> "
            "<scope-snapshots.json> <analysis-contracts.json> "
            "<runtime-artifact> <prompt-artifact> <configuration-artifact> "
            "<evidence-output.json>",
            file=sys.stderr,
        )
        return 2
    try:
        fixture_bytes = Path(argv[1]).read_bytes()
        fixture = json.loads(fixture_bytes.decode("utf-8"))
        evaluation_plan_bytes = Path(argv[2]).read_bytes()
        evaluation_plan = json.loads(evaluation_plan_bytes.decode("utf-8"))
        recordings = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        scope_snapshots = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
        analysis_contracts = json.loads(Path(argv[5]).read_text(encoding="utf-8"))
        pipeline_paths = {
            "runtime": Path(argv[6]),
            "prompt": Path(argv[7]),
            "configuration": Path(argv[8]),
        }
        bundle = assemble_bundle(
            fixture,
            evaluation_plan,
            recordings,
            scope_snapshots,
            analysis_contracts,
            hashlib.sha256(fixture_bytes).hexdigest(),
            hashlib.sha256(evaluation_plan_bytes).hexdigest(),
            fingerprint_pipeline_artifacts(pipeline_paths),
        )
        output = Path(argv[9])
        if output.resolve() in {
            Path(argv[1]).resolve(),
            Path(argv[2]).resolve(),
            Path(argv[3]).resolve(),
            Path(argv[4]).resolve(),
            Path(argv[5]).resolve(),
            *(path.resolve() for path in pipeline_paths.values()),
        }:
            raise EvaluationEvidenceError("evidence output must not overwrite an input")
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(
                bundle,
                target,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
    except FileExistsError:
        print("invalid separated evaluation evidence: evidence output already exists", file=sys.stderr)
        return 2
    except (
        EvaluationEvidenceError,
        KeyError,
        TypeError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        OSError,
    ) as error:
        print(f"invalid separated evaluation evidence: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

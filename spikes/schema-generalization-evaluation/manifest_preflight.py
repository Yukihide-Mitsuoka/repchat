"""Run every planned preflight from a reference-free execution manifest."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

from bigquery_scope_discovery import (  # noqa: E402 - sibling spike import
    AuthorizedScope,
    ScopeDiscoveryError,
)
from pipeline_artifacts import (  # noqa: E402 - local import after path setup
    PIPELINE_ARTIFACT_NAMES,
)
from preflight import (  # noqa: E402 - local import after path setup
    PreflightResult,
    run_preflight,
)


MANIFEST_KEYS = {"version", "evaluation_plan_sha256", "pipeline", "schemas"}
SCHEMA_KEYS = {"schema_id", "authorized_scope", "cases"}
SCOPE_KEYS = {"datasets", "tables"}
CASE_KEYS = {"case_id", "question", "run_ids"}


class ExecutionManifestError(ValueError):
    """The runtime manifest does not satisfy the reference-free input contract."""


@dataclass(frozen=True)
class PlannedPreflightAttempt:
    """One planned identity bound to its exact pipeline and preflight result."""

    schema_id: str
    case_id: str
    run_id: str
    pipeline_fingerprints: Mapping[str, str]
    result: PreflightResult

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed preflight without allowing pipeline substitution."""
        return self.result.failure_recording(
            self.schema_id,
            self.case_id,
            self.run_id,
            self.pipeline_fingerprints,
            bytes_processed=bytes_processed,
            cost_jpy=cost_jpy,
        )


def _require_fields(value: Any, expected: set[str], message: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ExecutionManifestError(message)
    return value


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _validate_pipeline(value: Any) -> dict[str, str]:
    if (
        not isinstance(value, dict)
        or set(value) != set(PIPELINE_ARTIFACT_NAMES)
        or any(not _is_sha256(item) for item in value.values())
    ):
        raise ExecutionManifestError(
            "manifest pipeline must contain exact lowercase SHA-256 fingerprints"
        )
    return dict(value)


def _validate_scope(value: Any) -> AuthorizedScope:
    scope = _require_fields(
        value, SCOPE_KEYS, "manifest authorized scope fields are invalid"
    )
    datasets, tables = scope["datasets"], scope["tables"]
    if (
        not isinstance(datasets, list)
        or not isinstance(tables, list)
        or any(not isinstance(item, str) for item in datasets)
        or any(not isinstance(item, str) for item in tables)
        or len(datasets) != len(set(datasets))
        or len(tables) != len(set(tables))
    ):
        raise ExecutionManifestError("manifest authorized scope is invalid")
    try:
        return AuthorizedScope(
            datasets=frozenset(datasets),
            tables=frozenset(tables),
        )
    except (ScopeDiscoveryError, TypeError):
        raise ExecutionManifestError("manifest authorized scope is invalid") from None


def _validate_case(
    value: Any, schema_id: str, observed_cases: set[tuple[str, str]]
) -> tuple[str, str, list[str]]:
    case = _require_fields(value, CASE_KEYS, "manifest case fields are invalid")
    case_id, question, run_ids = case["case_id"], case["question"], case["run_ids"]
    identity = (schema_id, case_id)
    if (
        not isinstance(case_id, str)
        or not case_id.strip()
        or identity in observed_cases
        or not isinstance(question, str)
        or not question.strip()
        or not isinstance(run_ids, list)
        or not run_ids
        or any(not isinstance(run_id, str) or not run_id.strip() for run_id in run_ids)
        or len(run_ids) != len(set(run_ids))
    ):
        raise ExecutionManifestError("manifest case identities and runs are invalid")
    observed_cases.add(identity)
    return case_id, question, list(run_ids)


def _planned_inputs(
    manifest: Any,
) -> tuple[dict[str, str], list[tuple[str, str, str, AuthorizedScope, str]]]:
    manifest = _require_fields(
        manifest, MANIFEST_KEYS, "execution manifest fields are invalid"
    )
    if type(manifest["version"]) is not int or manifest["version"] != 1:
        raise ExecutionManifestError("execution manifest version must be 1")
    if not _is_sha256(manifest["evaluation_plan_sha256"]):
        raise ExecutionManifestError(
            "evaluation plan fingerprint must be a lowercase SHA-256 value"
        )
    pipeline = _validate_pipeline(manifest["pipeline"])
    schemas = manifest["schemas"]
    if not isinstance(schemas, list) or not schemas:
        raise ExecutionManifestError("execution manifest schemas must be a non-empty list")

    observed_schemas: set[str] = set()
    observed_cases: set[tuple[str, str]] = set()
    planned: list[tuple[str, str, str, AuthorizedScope, str]] = []
    for raw_schema in schemas:
        schema = _require_fields(raw_schema, SCHEMA_KEYS, "manifest schema fields are invalid")
        schema_id = schema["schema_id"]
        cases = schema["cases"]
        if (
            not isinstance(schema_id, str)
            or not schema_id.strip()
            or schema_id in observed_schemas
            or not isinstance(cases, list)
            or not cases
        ):
            raise ExecutionManifestError("manifest schema IDs and cases are invalid")
        observed_schemas.add(schema_id)
        scope = _validate_scope(schema["authorized_scope"])
        for raw_case in cases:
            case_id, question, run_ids = _validate_case(
                raw_case, schema_id, observed_cases
            )
            planned.extend(
                (schema_id, case_id, run_id, scope, question)
                for run_id in run_ids
            )
    return pipeline, planned


def run_manifest_preflights(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    preflight_runner: Callable[..., PreflightResult] = run_preflight,
) -> tuple[PlannedPreflightAttempt, ...]:
    """Run each planned preflight only after validating the complete manifest."""
    pipeline, planned = _planned_inputs(manifest)
    if not isinstance(model, str) or not model.strip() or not isinstance(as_of, date):
        raise ExecutionManifestError("runtime model and as-of date are required")
    attempts: list[PlannedPreflightAttempt] = []
    for schema_id, case_id, run_id, scope, question in planned:
        result = preflight_runner(
            bq,
            vertex,
            model,
            scope,
            question,
            as_of=as_of,
        )
        if not isinstance(result, PreflightResult):
            raise TypeError("preflight runner must return PreflightResult")
        attempts.append(
            PlannedPreflightAttempt(
                schema_id=schema_id,
                case_id=case_id,
                run_id=run_id,
                pipeline_fingerprints=MappingProxyType(dict(pipeline)),
                result=result,
            )
        )
    return tuple(attempts)

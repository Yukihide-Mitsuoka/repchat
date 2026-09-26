"""Prepare reviewed contracts for evaluation-only preflights."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime
from types import MappingProxyType
from typing import Any, Callable, Mapping

from analysis_contract import AnalysisContract, AnalysisContractError, compile_contract
from analysis_contract_artifact import validate_analysis_contracts
from bigquery_schema_snapshot import SchemaSnapshot
from bigquery_scope_discovery import AuthorizedScope, DiscoverySnapshot, discover_scope
from contract_review_binding import (
    ContractReviewBindingError,
    _unique_pairs,
    _validate_review_record,
)
from evaluate import EvaluationEvidenceError
from manifest_preflight import planned_inputs
from preflight import EMPTY_USAGE, PreflightResult


MAX_ARTIFACT_BYTES = 16 * 1024 * 1024


class DiagnosticPreflightError(ValueError):
    """Reviewed diagnostic input or a fresh authorized scope is inconsistent."""


def _reject_constant(_value: str) -> None:
    raise DiagnosticPreflightError("diagnostic artifact contains a non-finite value")


def _decode(content: bytes) -> Any:
    if not isinstance(content, bytes) or not content or len(content) > MAX_ARTIFACT_BYTES:
        raise DiagnosticPreflightError("diagnostic artifact size is invalid")
    try:
        return json.loads(
            content.decode("utf-8"), object_pairs_hook=_unique_pairs,
            parse_constant=_reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError, ContractReviewBindingError):
        raise DiagnosticPreflightError("diagnostic artifact JSON is invalid") from None


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _snapshots(
    artifact: Any, expected_schemas: set[str]
) -> tuple[dict[str, DiscoverySnapshot], dict[str, dict[str, str]]]:
    if (
        not isinstance(artifact, dict)
        or set(artifact) != {"version", "snapshots"}
        or type(artifact["version"]) is not int
        or artifact["version"] != 1
        or not isinstance(artifact["snapshots"], list)
    ):
        raise DiagnosticPreflightError("scope snapshot artifact is invalid")
    snapshots: dict[str, DiscoverySnapshot] = {}
    observations: dict[str, dict[str, str]] = {}
    for entry in artifact["snapshots"]:
        if not isinstance(entry, dict) or set(entry) != {
            "schema_id", "content_json", "retrieved_at"
        }:
            raise DiagnosticPreflightError("scope snapshot entry is invalid")
        schema_id, content_json = entry["schema_id"], entry["content_json"]
        if not isinstance(schema_id, str) or schema_id not in expected_schemas or schema_id in snapshots:
            raise DiagnosticPreflightError("scope snapshot identities differ from manifest")
        if not isinstance(content_json, str) or not content_json:
            raise DiagnosticPreflightError("scope snapshot content is invalid")
        try:
            content = json.loads(
                content_json, object_pairs_hook=_unique_pairs,
                parse_constant=_reject_constant,
            )
            retrieved = datetime.fromisoformat(entry["retrieved_at"])
        except (TypeError, ValueError, json.JSONDecodeError):
            raise DiagnosticPreflightError("scope snapshot content is invalid") from None
        if retrieved.tzinfo is None or _canonical(content) != content_json:
            raise DiagnosticPreflightError("scope snapshot content is not canonical")
        schema = content.get("schema") if isinstance(content, dict) else None
        metadata = schema.get("metadata") if isinstance(schema, dict) else None
        schema_fingerprint = schema.get("fingerprint") if isinstance(schema, dict) else None
        if (
            not isinstance(content, dict)
            or set(content) != {"version", "schema", "tables", "limits"}
            or content["version"] != 1
            or not isinstance(metadata, dict)
            or not isinstance(content["tables"], list)
            or not isinstance(content["limits"], dict)
            or schema_fingerprint != hashlib.sha256(_canonical(metadata).encode()).hexdigest()
        ):
            raise DiagnosticPreflightError("scope snapshot schema observation is invalid")
        fingerprint = hashlib.sha256(content_json.encode()).hexdigest()
        snapshots[schema_id] = DiscoverySnapshot(
            content_json, fingerprint, entry["retrieved_at"]
        )
        observations[schema_id] = {
            "fingerprint": fingerprint,
            "schema_fingerprint": schema_fingerprint,
            "retrieved_at": entry["retrieved_at"],
        }
    if set(snapshots) != expected_schemas:
        raise DiagnosticPreflightError("scope snapshots must match manifest schemas")
    return snapshots, observations


def _contracts(
    artifact: Any,
    expected_cases: set[tuple[str, str]],
    observations: dict[str, dict[str, str]],
) -> tuple[dict[tuple[str, str], AnalysisContract], dict[tuple[str, str], str]]:
    try:
        fingerprints = validate_analysis_contracts(
            artifact, expected_cases, observations
        )
        contracts: dict[tuple[str, str], AnalysisContract] = {}
        for entry in artifact["contracts"]:
            key = (entry["schema_id"], entry["case_id"])
            content = json.loads(entry["content_json"], parse_constant=_reject_constant)
            schema = content["schema"]
            metadata_json = _canonical(schema["metadata"])
            snapshot = SchemaSnapshot(
                metadata_json, schema["fingerprint"], schema["retrieved_at"]
            )
            compiled = compile_contract(
                snapshot, content["semantics"], content["period"], content["limits"]
            )
            if compiled.content_json != entry["content_json"] or compiled.fingerprint != fingerprints[key]:
                raise DiagnosticPreflightError("reviewed contract differs from compiled content")
            contracts[key] = compiled
    except (AnalysisContractError, EvaluationEvidenceError, KeyError, TypeError, ValueError):
        raise DiagnosticPreflightError("reviewed analysis contracts are invalid") from None
    return contracts, fingerprints


@dataclass(frozen=True)
class ReviewedDiagnosticCase:
    """One reviewed contract tied to an authorized manifest case and scope."""

    scope: AuthorizedScope
    question: str
    snapshot: DiscoverySnapshot
    contract: AnalysisContract

    def run(
        self,
        bq: Any,
        _vertex: Any,
        model: str,
        scope: AuthorizedScope,
        question: str,
        *,
        as_of: date,
        discoverer: Callable[..., DiscoverySnapshot] = discover_scope,
    ) -> PreflightResult:
        """Recheck the authorized scope before supplying the frozen contract."""
        if (
            scope != self.scope
            or question != self.question
            or not isinstance(model, str)
            or not model.strip()
            or not isinstance(as_of, date)
        ):
            raise DiagnosticPreflightError("diagnostic runtime inputs differ from manifest")
        fresh = discoverer(bq, scope)
        if (
            not isinstance(fresh, DiscoverySnapshot)
            or fresh.content_json != self.snapshot.content_json
            or fresh.fingerprint != self.snapshot.fingerprint
        ):
            raise DiagnosticPreflightError("fresh authorized scope differs from review")
        return PreflightResult(
            question, self.snapshot, self.contract, EMPTY_USAGE.copy()
        )


def prepare_diagnostic_preflights(
    manifest: Any,
    scope_snapshots_bytes: bytes,
    contracts_bytes: bytes,
    review_record_bytes: bytes,
) -> Mapping[tuple[str, str], ReviewedDiagnosticCase]:
    """Validate every reviewed artifact before the first provider call."""
    _, planned = planned_inputs(manifest)
    expected_schemas = {schema_id for schema_id, _, _, _, _ in planned}
    expected_cases = {(schema_id, case_id) for schema_id, case_id, _, _, _ in planned}
    snapshots, observations = _snapshots(
        _decode(scope_snapshots_bytes), expected_schemas
    )
    contracts, fingerprints = _contracts(
        _decode(contracts_bytes), expected_cases, observations
    )
    review = _decode(review_record_bytes)
    try:
        _validate_review_record(
            review,
            hashlib.sha256(scope_snapshots_bytes).hexdigest(),
            hashlib.sha256(contracts_bytes).hexdigest(),
            fingerprints,
        )
    except ValueError:
        raise DiagnosticPreflightError("contract review record is invalid") from None
    cases: dict[tuple[str, str], ReviewedDiagnosticCase] = {}
    for schema_id, case_id, _, scope, question in planned:
        key = (schema_id, case_id)
        cases[key] = ReviewedDiagnosticCase(
            scope, question, snapshots[schema_id], contracts[key]
        )
    return MappingProxyType(cases)

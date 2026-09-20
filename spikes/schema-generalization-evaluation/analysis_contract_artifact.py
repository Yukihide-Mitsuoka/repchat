"""Validate recorded analysis contracts against their scope observations."""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from evaluate import EvaluationEvidenceError


ANALYSIS_CONTRACTS_KEYS = {"version", "contracts"}
ANALYSIS_CONTRACT_KEYS = {"schema_id", "case_id", "content_json"}
ANALYSIS_CONTRACT_CONTENT_KEYS = {
    "version",
    "schema",
    "semantics",
    "period",
    "limits",
}


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


def _analysis_contract_fingerprint(content: dict[str, Any]) -> str:
    identity = copy.deepcopy(content)
    schema = identity.get("schema")
    if isinstance(schema, dict):
        schema.pop("retrieved_at", None)
    return _fingerprint_json(identity)


def validate_analysis_contracts(
    analysis_contracts: dict[str, Any],
    expected_cases: set[tuple[Any, Any]],
    scope_observations: dict[Any, dict[str, str]],
) -> dict[tuple[Any, Any], str]:
    """Return contract fingerprints after validating every fixture case."""
    _require_fields(
        analysis_contracts,
        ANALYSIS_CONTRACTS_KEYS,
        "analysis contracts must contain only version and contracts",
    )
    if type(analysis_contracts["version"]) is not int or analysis_contracts["version"] != 1:
        raise EvaluationEvidenceError("analysis contracts version must be 1")
    contracts = analysis_contracts["contracts"]
    if not isinstance(contracts, list):
        raise EvaluationEvidenceError("analysis contracts must be a list")

    observed: dict[tuple[Any, Any], str] = {}
    for contract in contracts:
        contract = _require_fields(
            contract,
            ANALYSIS_CONTRACT_KEYS,
            "analysis contract entries may contain only schema ID, case ID, and content",
        )
        key = (contract["schema_id"], contract["case_id"])
        if key in observed or key not in expected_cases:
            raise EvaluationEvidenceError(
                "analysis contracts must match fixture cases exactly"
            )
        content_json = contract["content_json"]
        if not isinstance(content_json, str) or not content_json:
            raise EvaluationEvidenceError(
                "analysis contract content must be canonical JSON"
            )
        try:
            content = json.loads(content_json)
        except (TypeError, json.JSONDecodeError):
            raise EvaluationEvidenceError(
                "analysis contract content must be canonical JSON"
            ) from None
        canonical = json.dumps(
            content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        if (
            not isinstance(content, dict)
            or set(content) != ANALYSIS_CONTRACT_CONTENT_KEYS
            or content.get("version") != 1
            or content_json != canonical
        ):
            raise EvaluationEvidenceError(
                "analysis contract content must be canonical JSON"
            )
        schema = content["schema"]
        observation = scope_observations.get(contract["schema_id"])
        if (
            not isinstance(schema, dict)
            or observation is None
            or not isinstance(schema.get("metadata"), dict)
            or schema.get("fingerprint") != _fingerprint_json(schema.get("metadata"))
            or schema.get("fingerprint") != observation["schema_fingerprint"]
            or schema.get("retrieved_at") != observation["retrieved_at"]
        ):
            raise EvaluationEvidenceError(
                "analysis contract must match its scope snapshot observation"
            )
        observed[key] = _analysis_contract_fingerprint(content)

    if set(observed) != expected_cases:
        raise EvaluationEvidenceError(
            "analysis contracts must match fixture cases exactly"
        )
    return observed

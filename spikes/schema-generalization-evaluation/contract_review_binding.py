#!/usr/bin/env python3
"""Bind declared contract reviews to private diagnostic evidence and artifacts."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from analysis_contract_artifact import validate_analysis_contracts
from assemble import _validate_scope_snapshots
from evaluate import EvaluationEvidenceError, evaluate_bundle
from run_outcome import PREFLIGHT_FAILURE_STAGES


MAX_INPUT_BYTES = 16 * 1024 * 1024
FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
REVIEW_KEYS = {
    "schema_id", "case_id", "contract_fingerprint", "author_id",
    "reviewer_id", "reviewed_at",
}


class ContractReviewBindingError(ValueError):
    """A declared review is incomplete or does not match diagnostic evidence."""


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ContractReviewBindingError("duplicate JSON field")
        result[key] = value
    return result


def _read_json(path: str) -> tuple[bytes, Any]:
    with Path(path).open("rb") as source:
        content = source.read(MAX_INPUT_BYTES + 1)
    if not content or len(content) > MAX_INPUT_BYTES:
        raise ContractReviewBindingError("input size is invalid")
    return content, json.loads(content.decode("utf-8"), object_pairs_hook=_unique_pairs)


def _validate_review_record(
    record: Any,
    snapshots_sha256: str,
    contracts_sha256: str,
    contract_fingerprints: dict[tuple[str, str], str],
) -> None:
    if (
        not isinstance(record, dict)
        or set(record) != {"version", "scope_snapshots_sha256", "analysis_contracts_sha256", "reviews"}
        or type(record["version"]) is not int
        or record["version"] != 2
        or record["scope_snapshots_sha256"] != snapshots_sha256
        or record["analysis_contracts_sha256"] != contracts_sha256
        or not isinstance(record["reviews"], list)
    ):
        raise ContractReviewBindingError("review record is invalid or bound to other bytes")
    observed: set[tuple[str, str]] = set()
    for review in record["reviews"]:
        if not isinstance(review, dict) or set(review) != REVIEW_KEYS:
            raise ContractReviewBindingError("contract review fields are invalid")
        key = (review["schema_id"], review["case_id"])
        if key not in contract_fingerprints or key in observed:
            raise ContractReviewBindingError("contract review identity is unexpected or duplicated")
        if (
            not isinstance(review["contract_fingerprint"], str)
            or not FINGERPRINT_PATTERN.fullmatch(review["contract_fingerprint"])
            or review["contract_fingerprint"] != contract_fingerprints[key]
        ):
            raise ContractReviewBindingError("contract review fingerprint differs")
        author, reviewer = review["author_id"], review["reviewer_id"]
        if (
            not isinstance(author, str)
            or not isinstance(reviewer, str)
            or not author.strip()
            or not reviewer.strip()
            or len(author) > 128
            or len(reviewer) > 128
            or author.strip() == reviewer.strip()
        ):
            raise ContractReviewBindingError("contract review actors are invalid")
        try:
            reviewed_at = datetime.fromisoformat(review["reviewed_at"])
        except (TypeError, ValueError):
            raise ContractReviewBindingError("contract review time is invalid") from None
        if reviewed_at.tzinfo is None:
            raise ContractReviewBindingError("contract review time needs a timezone")
        observed.add(key)
    if observed != set(contract_fingerprints):
        raise ContractReviewBindingError("every diagnostic contract needs one review")


def validate_contract_review_binding(
    evidence: Any,
    scope_snapshots_bytes: bytes,
    scope_snapshots: Any,
    contracts_bytes: bytes,
    contracts: Any,
    review_record: Any,
) -> dict[str, int]:
    """Validate artifact and declared review bindings without asserting reviewer identity."""
    evaluate_bundle(evidence)
    cases = {
        (schema["schema_id"], case["case_id"]): case
        for schema in evidence["schemas"]
        for case in schema["cases"]
    }
    if any(
        case["reference"]["author_id"].strip()
        == case["reference"]["reviewer_id"].strip()
        for case in cases.values()
    ):
        raise ContractReviewBindingError("reference lacks a distinct reviewer ID")
    if any(
        run["failure_stage"] in PREFLIGHT_FAILURE_STAGES
        for case in cases.values()
        for run in case["runs"]
    ):
        raise ContractReviewBindingError("diagnostic run lacks a recorded contract")
    scope_observations = _validate_scope_snapshots(
        scope_snapshots, evidence, {schema["schema_id"] for schema in evidence["schemas"]}
    )
    fingerprints = validate_analysis_contracts(contracts, set(cases), scope_observations)
    for key, case in cases.items():
        if any(
            run["runtime_input"]["analysis_contract_fingerprint"] != fingerprints[key]
            for run in case["runs"]
        ):
            raise ContractReviewBindingError("diagnostic run differs from contract artifact")
    _validate_review_record(
        review_record,
        hashlib.sha256(scope_snapshots_bytes).hexdigest(),
        hashlib.sha256(contracts_bytes).hexdigest(),
        fingerprints,
    )
    return {"version": 1, "reviewed_contract_count": len(fingerprints)}


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(
            "usage: contract_review_binding.py <diagnostic-evidence.json> "
            "<scope-snapshots.json> <analysis-contracts.json> <review-record.json>",
            file=sys.stderr,
        )
        return 2
    try:
        _, evidence = _read_json(argv[1])
        snapshots_bytes, snapshots = _read_json(argv[2])
        contracts_bytes, contracts = _read_json(argv[3])
        _, review = _read_json(argv[4])
        report = validate_contract_review_binding(
            evidence, snapshots_bytes, snapshots, contracts_bytes, contracts, review
        )
    except (
        ContractReviewBindingError, EvaluationEvidenceError, OSError, UnicodeError,
        json.JSONDecodeError, KeyError, TypeError,
    ) as error:
        print(f"invalid contract review binding: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

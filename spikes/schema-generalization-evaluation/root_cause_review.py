#!/usr/bin/env python3
"""Validate post-run root-cause annotations for evaluation mismatches."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from evaluate import EvaluationEvidenceError, evaluate_bundle, mismatched_quality_run_ids


MAX_INPUT_BYTES = 16 * 1024 * 1024
FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
CAUSES = frozenset({
    "schema_linking", "value_linking", "time_field", "join_path", "output_grain",
    "filter", "aggregation", "sql_dialect", "result_shape", "indeterminate",
})
BASIS = frozenset({
    "reviewed_reference", "generated_sql", "observed_rows", "analysis_contract",
    "scope_snapshot", "failure_diagnostic",
})
REVIEW_KEYS = {"schema_id", "case_id", "run_id", "cause", "reviewer_id", "basis"}


class RootCauseReviewError(ValueError):
    """Annotations do not cover exactly the observed quality discrepancies."""


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RootCauseReviewError("duplicate JSON field")
        result[key] = value
    return result


def _read_json(path: str) -> tuple[bytes, Any]:
    with Path(path).open("rb") as source:
        content = source.read(MAX_INPUT_BYTES + 1)
    if not content or len(content) > MAX_INPUT_BYTES:
        raise RootCauseReviewError("input size is invalid")
    return content, json.loads(content.decode("utf-8"), object_pairs_hook=_unique_pairs)


def _validate_review(review: Any) -> tuple[tuple[str, str, str], str]:
    if not isinstance(review, dict) or set(review) != REVIEW_KEYS:
        raise RootCauseReviewError("review fields are invalid")
    identity = tuple(review[key] for key in ("schema_id", "case_id", "run_id"))
    if not all(isinstance(value, str) and value.strip() for value in identity):
        raise RootCauseReviewError("review identity is invalid")
    if not isinstance(review["cause"], str) or review["cause"] not in CAUSES:
        raise RootCauseReviewError("root cause is not in the closed taxonomy")
    reviewer = review["reviewer_id"]
    if not isinstance(reviewer, str) or not reviewer.strip() or len(reviewer) > 128:
        raise RootCauseReviewError("reviewer ID is invalid")
    basis = review["basis"]
    if (
        not isinstance(basis, list)
        or not basis
        or len(basis) > len(BASIS)
        or any(not isinstance(item, str) or item not in BASIS for item in basis)
        or len(set(basis)) != len(basis)
    ):
        raise RootCauseReviewError("review basis is invalid")
    return identity, review["cause"]


def summarize_root_cause_review(
    evidence_bytes: bytes, evidence: Any, annotations: Any
) -> dict[str, Any]:
    """Count reviewer-assigned causes; never infer a semantic cause from a failure stage."""
    evaluate_bundle(evidence)
    if any(
        case["reference"]["author_id"] == case["reference"]["reviewer_id"]
        for schema in evidence["schemas"]
        for case in schema["cases"]
    ):
        raise RootCauseReviewError("reference lacks a distinct reviewer ID")
    if (
        not isinstance(annotations, dict)
        or set(annotations) != {"version", "evidence_sha256", "reviews"}
        or type(annotations["version"]) is not int
        or annotations["version"] != 1
        or not isinstance(annotations["evidence_sha256"], str)
        or not FINGERPRINT_PATTERN.fullmatch(annotations["evidence_sha256"])
        or annotations["evidence_sha256"] != hashlib.sha256(evidence_bytes).hexdigest()
        or not isinstance(annotations["reviews"], list)
    ):
        raise RootCauseReviewError("review artifact is invalid or bound to different evidence")

    expected = mismatched_quality_run_ids(evidence)
    observed: set[tuple[str, str, str]] = set()
    counts: Counter[str] = Counter()
    cases: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for review in annotations["reviews"]:
        identity, cause = _validate_review(review)
        if identity not in expected or identity in observed:
            raise RootCauseReviewError("review identity is unexpected or duplicated")
        observed.add(identity)
        counts[cause] += 1
        cases[cause].add(identity[:2])
    if observed != expected:
        raise RootCauseReviewError("every mismatched quality run needs one review")
    return {
        "version": 1,
        "reviewed_mismatch_count": len(expected),
        "cause_counts": dict(sorted(counts.items())),
        "cause_case_counts": {cause: len(cases[cause]) for cause in sorted(cases)},
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: root_cause_review.py <evidence.json> <review.json>", file=sys.stderr)
        return 2
    try:
        evidence_bytes, evidence = _read_json(argv[1])
        _, annotations = _read_json(argv[2])
        report = summarize_root_cause_review(evidence_bytes, evidence, annotations)
    except (RootCauseReviewError, EvaluationEvidenceError, OSError, UnicodeError,
            json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"invalid root-cause review: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

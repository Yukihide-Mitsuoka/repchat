#!/usr/bin/env python3
"""Validate one proposed evaluation execution without contacting providers."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Any

from execution_budget import BudgetLimits
from evaluate import EvaluationEvidenceError
from evaluation_plan import validate_evaluation_plan
from manifest_preflight import ExecutionManifestError, planned_inputs
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError


INTENT_KEYS = {
    "version",
    "evaluation_plan_sha256",
    "execution_manifest_sha256",
    "pricing_snapshot_sha256",
    "model",
    "region",
    "as_of",
    "execution_date",
    "output_directory",
    "vertex_budget_jpy",
    "bigquery_budget_jpy",
    "total_budget_jpy",
}
MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
MONEY_PATTERN = re.compile(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?\Z")


class ExecutionIntentError(ValueError):
    """The proposed execution is not bound to valid offline inputs."""


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, value in pairs:
        if name in result:
            raise ExecutionIntentError("artifact contains duplicate JSON fields")
        result[name] = value
    return result


def _read_artifact(path: str) -> tuple[bytes, Any]:
    try:
        with Path(path).open("rb") as source:
            content = source.read(MAX_ARTIFACT_BYTES + 1)
        if not content or len(content) > MAX_ARTIFACT_BYTES:
            raise ExecutionIntentError("artifact size is invalid")
        return content, json.loads(content.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ExecutionIntentError("artifact cannot be read as JSON") from error


def _date(value: Any, name: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ExecutionIntentError(f"{name} must be an ISO date")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ExecutionIntentError(f"{name} must be an ISO date") from error


def _money(value: Any, name: str) -> Decimal:
    if (
        not isinstance(value, str)
        or len(value) > 32
        or not MONEY_PATTERN.fullmatch(value)
    ):
        raise ExecutionIntentError(f"{name} must be a decimal JPY amount")
    amount = Decimal(value)
    if amount <= 0:
        raise ExecutionIntentError(f"{name} must be positive")
    return amount


def validate_execution_intent(
    intent: Any,
    plan_bytes: bytes,
    plan: Any,
    manifest_bytes: bytes,
    manifest: Any,
    pricing_bytes: bytes,
    *,
    model: str,
    region: str,
    as_of: date,
    execution_date: date,
    output_directory: str | Path,
) -> BudgetLimits:
    """Check exact artifacts and caller inputs before any execution is authorized."""
    if (
        not isinstance(intent, dict)
        or set(intent) != INTENT_KEYS
        or type(intent["version"]) is not int
        or intent["version"] != 1
    ):
        raise ExecutionIntentError("execution intent fields or version are invalid")
    for name, content in (
        ("evaluation_plan_sha256", plan_bytes),
        ("execution_manifest_sha256", manifest_bytes),
        ("pricing_snapshot_sha256", pricing_bytes),
    ):
        if intent[name] != hashlib.sha256(content).hexdigest():
            raise ExecutionIntentError("execution intent artifact fingerprint differs")
    if (
        not isinstance(model, str)
        or not model.strip()
        or not isinstance(region, str)
        or not region.strip()
        or intent["model"] != model
        or intent["region"] != region
        or _date(intent["as_of"], "as_of") != as_of
        or _date(intent["execution_date"], "execution_date") != execution_date
    ):
        raise ExecutionIntentError("execution intent model, region, or dates differ")
    output = Path(intent["output_directory"]) if isinstance(intent["output_directory"], str) else None
    if (
        output is None
        or not output.is_absolute()
        or ".." in output.parts
        or output == Path(output.anchor)
        or output != Path(output_directory)
    ):
        raise ExecutionIntentError("execution intent output directory differs or is unsafe")
    vertex = _money(intent["vertex_budget_jpy"], "vertex_budget_jpy")
    bigquery = _money(intent["bigquery_budget_jpy"], "bigquery_budget_jpy")
    total = _money(intent["total_budget_jpy"], "total_budget_jpy")
    with localcontext() as context:
        context.prec = 48
        if total > vertex + bigquery:
            raise ExecutionIntentError("total budget exceeds provider budgets")
    limits = BudgetLimits(vertex, bigquery, total)

    if not isinstance(plan, dict) or not isinstance(manifest, dict):
        raise ExecutionIntentError("plan and manifest must be objects")
    pipeline, planned_inputs_list = planned_inputs(manifest)
    if manifest["evaluation_plan_sha256"] != hashlib.sha256(plan_bytes).hexdigest():
        raise ExecutionIntentError("manifest is not bound to the supplied plan")
    cases = {(schema_id, case_id) for schema_id, case_id, *_ in planned_inputs_list}
    planned = validate_evaluation_plan(
        plan, cases, plan.get("reviewed_fixture_sha256"), pipeline
    )
    manifest_runs = {(schema_id, case_id, run_id) for schema_id, case_id, run_id, *_ in planned_inputs_list}
    if planned != manifest_runs:
        raise ExecutionIntentError("plan and manifest run identities differ")
    PricingSnapshot.from_bytes(pricing_bytes).pricing_for(model, region, execution_date)
    return limits


def main(argv: list[str]) -> int:
    if len(argv) != 10:
        print("invalid execution intent", file=sys.stderr)
        return 2
    try:
        _, intent = _read_artifact(argv[1])
        plan_bytes, plan = _read_artifact(argv[2])
        manifest_bytes, manifest = _read_artifact(argv[3])
        pricing_bytes, _ = _read_artifact(argv[4])
        validate_execution_intent(
            intent, plan_bytes, plan, manifest_bytes, manifest, pricing_bytes,
            model=argv[5], region=argv[6],
            as_of=_date(argv[7], "as_of"),
            execution_date=_date(argv[8], "execution_date"),
            output_directory=argv[9],
        )
    except (
        ExecutionIntentError, EvaluationEvidenceError,
        ExecutionManifestError, RuntimeMeasurementError,
    ):
        print("invalid execution intent", file=sys.stderr)
        return 2
    print("execution intent valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

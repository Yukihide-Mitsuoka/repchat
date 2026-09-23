"""Validate source-independent evaluation run outcome metadata."""

from __future__ import annotations

import re
from typing import Any


NO_FAILURE = "none"
QUALITY_FAILURE = "quality"
INFRASTRUCTURE_FAILURE = "infrastructure"
FAILURE_KINDS = frozenset({NO_FAILURE, QUALITY_FAILURE, INFRASTRUCTURE_FAILURE})
SCOPE_DISCOVERY_FAILURE = "scope_discovery"
ANALYSIS_CONTRACT_GENERATION_FAILURE = "analysis_contract_generation"
PREFLIGHT_FAILURE_STAGES = frozenset({
    SCOPE_DISCOVERY_FAILURE,
    ANALYSIS_CONTRACT_GENERATION_FAILURE,
})
FAILURE_STAGES = (
    SCOPE_DISCOVERY_FAILURE,
    ANALYSIS_CONTRACT_GENERATION_FAILURE,
    "planning",
    "sql_generation",
    "sql_validation",
    "dry_run",
    "execution",
    "result_validation",
    "rendering",
)
SAFE_FAILURE_CODE = re.compile(r"[a-z][a-z0-9_]{0,63}")
RENDERER_INFRASTRUCTURE_FAILURE_CODE = "renderer_infrastructure_failed"
SCOPE_DISCOVERY_INFRASTRUCTURE_FAILURE_CODE = (
    "scope_discovery_infrastructure_failed"
)
ANALYSIS_CONTRACT_GENERATION_INFRASTRUCTURE_FAILURE_CODE = (
    "analysis_contract_generation_infrastructure_failed"
)
TYPED_INFRASTRUCTURE_FAILURES = frozenset({
    (SCOPE_DISCOVERY_FAILURE, SCOPE_DISCOVERY_INFRASTRUCTURE_FAILURE_CODE),
    (
        ANALYSIS_CONTRACT_GENERATION_FAILURE,
        ANALYSIS_CONTRACT_GENERATION_INFRASTRUCTURE_FAILURE_CODE,
    ),
    ("rendering", RENDERER_INFRASTRUCTURE_FAILURE_CODE),
})
TYPED_INFRASTRUCTURE_CODES = frozenset(
    code for _, code in TYPED_INFRASTRUCTURE_FAILURES
)


class RunOutcomeError(ValueError):
    """A run's stage metadata conflicts with its recorded outcome."""


def failure_kind_for_diagnostic(
    stage: str, diagnostic: dict[str, Any] | None, code: str | None = None
) -> str:
    """Classify only validated run outcomes and closed diagnostic categories."""
    if stage == NO_FAILURE:
        return NO_FAILURE
    if diagnostic is not None and diagnostic.get("category") in {
        "provider_failure",
        "infrastructure_failure",
        "cancelled",
    }:
        return INFRASTRUCTURE_FAILURE
    if (stage, code) in TYPED_INFRASTRUCTURE_FAILURES:
        return INFRASTRUCTURE_FAILURE
    return QUALITY_FAILURE


def validate_run_outcome(run: dict[str, Any]) -> None:
    """Require one safe stage/code pair consistent with observable run fields."""
    stage = run["failure_stage"]
    code = run["failure_code"]
    kind = run.get("failure_kind")
    if not isinstance(stage, str) or stage not in {NO_FAILURE, *FAILURE_STAGES}:
        raise RunOutcomeError("failure stage is unsupported")
    if not isinstance(code, str) or (
        code and SAFE_FAILURE_CODE.fullmatch(code) is None
    ):
        raise RunOutcomeError(
            "failure code must be an empty value or a safe machine code"
        )
    if kind is not None:
        if not isinstance(kind, str) or kind not in FAILURE_KINDS:
            raise RunOutcomeError("failure kind is unsupported")
        if (stage == NO_FAILURE) != (kind == NO_FAILURE):
            raise RunOutcomeError("failure kind conflicts with its outcome")

    executed = run["sql_execution_succeeded"]
    rendered = run["render_succeeded"]
    sql = run["generated_sql"]
    rows = run["actual_rows"]
    if stage == NO_FAILURE:
        valid = code == "" and bool(sql.strip()) and executed and rendered
    elif not code or rendered:
        valid = False
    elif stage in PREFLIGHT_FAILURE_STAGES:
        valid = not sql and not executed and not rows
    elif stage in {"planning", "sql_generation"}:
        valid = not sql and not executed and not rows
    elif stage in {"sql_validation", "dry_run"}:
        valid = bool(sql.strip()) and not executed and not rows
    elif stage == "execution":
        valid = bool(sql.strip()) and not executed and not rows
    else:
        valid = bool(sql.strip()) and executed
    if not valid:
        raise RunOutcomeError("run outcome conflicts with its failure stage")


def validate_failure_kind(run: dict[str, Any]) -> None:
    """Require failure kind to agree with typed diagnostics and safety evidence."""
    if (
        run["failure_code"] in TYPED_INFRASTRUCTURE_CODES
        and (run["failure_stage"], run["failure_code"])
        not in TYPED_INFRASTRUCTURE_FAILURES
    ):
        raise RunOutcomeError("infrastructure failure code conflicts with its stage")
    quality_evidence = any(
        run[name]
        for name in (
            "unauthorized_reference",
            "dangerous_sql",
            "scan_limit_exceeded",
            "semantic_error",
        )
    )
    diagnostic = run["diagnostic"]
    if diagnostic is not None or (
        run["failure_stage"], run["failure_code"]
    ) in TYPED_INFRASTRUCTURE_FAILURES:
        expected = failure_kind_for_diagnostic(
            run["failure_stage"], diagnostic, run["failure_code"]
        )
        if run["failure_kind"] != expected:
            raise RunOutcomeError("failure kind conflicts with its outcome")
    elif quality_evidence and run["failure_kind"] == INFRASTRUCTURE_FAILURE:
        raise RunOutcomeError("infrastructure failures cannot contain quality evidence")

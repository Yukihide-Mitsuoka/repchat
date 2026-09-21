"""Validate generated manifest SQL with the common local safety contracts."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

import analysis_contract_context  # noqa: E402 - sibling spike import
import contract_period_validation  # noqa: E402 - sibling spike import
import run_report as report  # noqa: E402 - sibling spike import
import sql_contract_validation  # noqa: E402 - sibling spike import
from manifest_sql_generation import (  # noqa: E402 - local import after path setup
    GeneratedSQLAttempt,
    run_manifest_sql_generation,
)


SQL_VALIDATION_FAILURE = "sql_validation"
SQL_VALIDATION_FAILURE_CODE = "sql_validation_failed"
_UNAUTHORIZED_DIAGNOSTICS = (
    "table decorator is outside the analysis contract",
    "table is outside the analysis contract",
    "schema policyとSQLを照合できません",
)
_DANGEROUS_DIAGNOSTICS = (
    "not a SELECT",
    "multiple statements",
    "forbidden keyword",
    "SELECT * anti-pattern",
    "query must reference an analysis contract table",
)


@dataclass(frozen=True)
class ValidatedSQLAttempt:
    """One generated attempt after source-independent local SQL validation."""

    generated_attempt: GeneratedSQLAttempt
    validated_sql: str | None
    failure_stage: str | None = None
    failure_code: str | None = None
    unauthorized_reference: bool = False
    dangerous_sql: bool = False
    semantic_error: bool = False

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed validation without retaining its raw diagnostic."""
        if self.succeeded:
            raise ValueError(
                "a successful SQL validation attempt cannot create a failure recording"
            )
        if self.failure_stage != SQL_VALIDATION_FAILURE:
            return self.generated_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if type(bytes_processed) is not int or bytes_processed < 0:
            raise ValueError("SQL validation bytes must be a non-negative integer")
        planned_attempt = self.generated_attempt.planned_attempt
        preflight_attempt = planned_attempt.preflight_attempt
        return {
            "schema_id": preflight_attempt.schema_id,
            "case_id": preflight_attempt.case_id,
            "run": {
                "run_id": preflight_attempt.run_id,
                **dict(preflight_attempt.pipeline_fingerprints),
                "runtime_input": preflight_attempt.result.runtime_input(),
                "generated_sql": self.generated_attempt.generated_sql,
                "failure_stage": self.failure_stage,
                "failure_code": self.failure_code,
                "sql_execution_succeeded": False,
                "actual_rows": [],
                "unauthorized_reference": self.unauthorized_reference,
                "dangerous_sql": self.dangerous_sql,
                "scan_limit_exceeded": False,
                "semantic_error": self.semantic_error,
                "render_succeeded": False,
                "bytes_processed": bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def _failed_attempt(
    attempt: GeneratedSQLAttempt,
    stage: str,
    code: str,
    *,
    unauthorized_reference: bool = False,
    dangerous_sql: bool = False,
    semantic_error: bool = False,
) -> ValidatedSQLAttempt:
    return ValidatedSQLAttempt(
        generated_attempt=attempt,
        validated_sql=None,
        failure_stage=stage,
        failure_code=code,
        unauthorized_reference=unauthorized_reference,
        dangerous_sql=dangerous_sql,
        semantic_error=semantic_error,
    )


def _local_safety_flags(diagnostic: str) -> tuple[bool, bool]:
    """Map only stable common-validator classes to evaluation safety evidence."""
    unauthorized = any(item in diagnostic for item in _UNAUTHORIZED_DIAGNOSTICS)
    dangerous = any(item in diagnostic for item in _DANGEROUS_DIAGNOSTICS)
    return unauthorized, dangerous


def _validate_attempt(attempt: GeneratedSQLAttempt) -> ValidatedSQLAttempt:
    if not attempt.succeeded:
        return _failed_attempt(
            attempt, str(attempt.failure_stage), str(attempt.failure_code)
        )

    try:
        planned_attempt = attempt.planned_attempt
        contract = planned_attempt.preflight_attempt.result.contract
        if contract is None or attempt.section is None or attempt.generated_sql is None:
            raise ValueError("successful SQL generation output is incomplete")
        policy = analysis_contract_context.execution_policy(contract)
        normalized, diagnostic = report.validate_sql(
            attempt.generated_sql,
            policy=policy,
        )
        if diagnostic:
            unauthorized, dangerous = _local_safety_flags(diagnostic)
            return _failed_attempt(
                attempt,
                SQL_VALIDATION_FAILURE,
                SQL_VALIDATION_FAILURE_CODE,
                unauthorized_reference=unauthorized,
                dangerous_sql=dangerous,
            )
        if normalized is None:
            raise ValueError("common SQL validation returned no SQL")
        period_diagnostic = contract_period_validation.contract_period_diagnostic(
            normalized, policy
        )
        if period_diagnostic:
            return _failed_attempt(
                attempt,
                SQL_VALIDATION_FAILURE,
                SQL_VALIDATION_FAILURE_CODE,
                semantic_error=True,
            )
        try:
            sql_contract_validation.validate_generated_dashboard_sql(
                attempt.section,
                normalized,
                policy,
            )
        except sql_contract_validation.SQLContractError:
            return _failed_attempt(
                attempt,
                SQL_VALIDATION_FAILURE,
                SQL_VALIDATION_FAILURE_CODE,
                semantic_error=True,
            )
    except Exception:
        return _failed_attempt(
            attempt,
            SQL_VALIDATION_FAILURE,
            SQL_VALIDATION_FAILURE_CODE,
        )
    return ValidatedSQLAttempt(
        generated_attempt=attempt,
        validated_sql=normalized,
    )


def run_manifest_sql_validation(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    generation_runner: Callable[..., tuple[GeneratedSQLAttempt, ...]] = (
        run_manifest_sql_generation
    ),
) -> tuple[ValidatedSQLAttempt, ...]:
    """Generate manifest SQL and locally validate only successful attempts."""
    generated_attempts = generation_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(_validate_attempt(attempt) for attempt in generated_attempts)

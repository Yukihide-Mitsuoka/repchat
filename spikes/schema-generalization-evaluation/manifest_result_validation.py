"""Validate executed manifest results through the common result boundary."""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

import analysis_contract_context  # noqa: E402 - sibling spike import
import result_validation as common_result_validation  # noqa: E402
from manifest_execution import (  # noqa: E402 - local import after path setup
    ExecutionAttempt,
    run_manifest_executions,
)


RESULT_VALIDATION_FAILURE = "result_validation"
RESULT_VALIDATION_FAILURE_CODE = "result_validation_failed"


@dataclass(frozen=True)
class ResultValidationAttempt:
    """One execution attempt after common result validation and normalization."""

    execution_attempt: ExecutionAttempt
    rows: tuple[tuple[Any, ...], ...] | None
    columns: tuple[str, ...] | None
    visualization: str | None
    bytes_processed: int | None
    failure_stage: str | None = None
    failure_code: str | None = None
    semantic_error: bool = False

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed validation without persisting unvalidated result rows."""
        if self.succeeded:
            raise ValueError(
                "a successful result validation cannot create a failure recording"
            )
        if self.failure_stage != RESULT_VALIDATION_FAILURE:
            return self.execution_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if bytes_processed != self.bytes_processed:
            raise ValueError(
                "result validation bytes must match execution metadata"
            )
        if (
            isinstance(cost_jpy, bool)
            or not isinstance(cost_jpy, (int, float))
            or not math.isfinite(cost_jpy)
            or cost_jpy < 0
        ):
            raise ValueError("result validation cost must be finite and non-negative")
        validated_attempt = self.execution_attempt.dry_run_attempt.validated_attempt
        generated_attempt = validated_attempt.generated_attempt
        preflight_attempt = generated_attempt.planned_attempt.preflight_attempt
        return {
            "schema_id": preflight_attempt.schema_id,
            "case_id": preflight_attempt.case_id,
            "run": {
                "run_id": preflight_attempt.run_id,
                **dict(preflight_attempt.pipeline_fingerprints),
                "runtime_input": preflight_attempt.result.runtime_input(),
                "generated_sql": validated_attempt.validated_sql,
                "failure_stage": self.failure_stage,
                "failure_code": self.failure_code,
                "sql_execution_succeeded": True,
                "actual_rows": [],
                "unauthorized_reference": False,
                "dangerous_sql": False,
                "scan_limit_exceeded": False,
                "semantic_error": self.semantic_error,
                "render_succeeded": False,
                "bytes_processed": self.bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def _upstream_failure(attempt: ExecutionAttempt) -> ResultValidationAttempt:
    return ResultValidationAttempt(
        attempt,
        None,
        None,
        None,
        attempt.bytes_processed,
        failure_stage=attempt.failure_stage,
        failure_code=attempt.failure_code,
    )


def _result_failure(attempt: ExecutionAttempt) -> ResultValidationAttempt:
    return ResultValidationAttempt(
        attempt,
        None,
        None,
        None,
        attempt.bytes_processed,
        failure_stage=RESULT_VALIDATION_FAILURE,
        failure_code=RESULT_VALIDATION_FAILURE_CODE,
        semantic_error=True,
    )


def _validate_attempt(attempt: ExecutionAttempt) -> ResultValidationAttempt:
    if not attempt.succeeded:
        return _upstream_failure(attempt)

    try:
        dry_run_attempt = attempt.dry_run_attempt
        generated_attempt = dry_run_attempt.validated_attempt.generated_attempt
        contract = generated_attempt.planned_attempt.preflight_attempt.result.contract
        section = generated_attempt.section
        if (
            contract is None
            or section is None
            or attempt.rows is None
            or attempt.columns is None
            or attempt.bytes_processed is None
        ):
            raise ValueError("successful execution output is incomplete")
        policy = analysis_contract_context.execution_policy(contract)
        section_limit = section.get("max_result_rows")
        if type(section_limit) is not int or section_limit < 1:
            raise ValueError("section result row limit is invalid")
        result = common_result_validation.validate_dashboard_result(
            section,
            attempt.rows,
            attempt.columns,
            max_result_rows=min(section_limit, policy.maximum_result_rows),
            policy=policy,
        )
    except Exception:
        return _result_failure(attempt)
    return ResultValidationAttempt(
        attempt,
        result.rows,
        result.columns,
        result.visualization,
        attempt.bytes_processed,
    )


def run_manifest_result_validation(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    execution_runner: Callable[..., tuple[ExecutionAttempt, ...]] = (
        run_manifest_executions
    ),
) -> tuple[ResultValidationAttempt, ...]:
    """Execute every manifest attempt and validate only successful results."""
    execution_attempts = execution_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(_validate_attempt(attempt) for attempt in execution_attempts)

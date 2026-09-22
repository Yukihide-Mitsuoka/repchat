"""Execute successful manifest dry runs through the common BigQuery boundary."""

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
import run_report as report  # noqa: E402 - sibling spike import
from manifest_dry_run import (  # noqa: E402 - local import after path setup
    DryRunAttempt,
    run_manifest_dry_runs,
)


EXECUTION_FAILURE = "execution"
EXECUTION_FAILURE_CODE = "execution_failed"


@dataclass(frozen=True)
class ExecutionAttempt:
    """One dry-run attempt after guarded BigQuery query execution."""

    dry_run_attempt: DryRunAttempt
    rows: tuple[tuple[object, ...], ...] | None
    columns: tuple[str, ...] | None
    bytes_processed: int | None
    failure_stage: str | None = None
    failure_code: str | None = None
    scan_limit_exceeded: bool = False

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed execution without retaining provider diagnostics."""
        if self.succeeded:
            raise ValueError(
                "a successful execution attempt cannot create a failure recording"
            )
        if self.failure_stage != EXECUTION_FAILURE:
            return self.dry_run_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if type(bytes_processed) is not int or bytes_processed < 0:
            raise ValueError("execution failure bytes must be a non-negative integer")
        validated_attempt = self.dry_run_attempt.validated_attempt
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
                "sql_execution_succeeded": False,
                "actual_rows": [],
                "unauthorized_reference": False,
                "dangerous_sql": False,
                "scan_limit_exceeded": self.scan_limit_exceeded,
                "semantic_error": False,
                "render_succeeded": False,
                "bytes_processed": bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def _upstream_failure(attempt: DryRunAttempt) -> ExecutionAttempt:
    return ExecutionAttempt(
        attempt,
        None,
        None,
        None,
        failure_stage=attempt.failure_stage,
        failure_code=attempt.failure_code,
        scan_limit_exceeded=attempt.scan_limit_exceeded,
    )


def _execution_failure(
    attempt: DryRunAttempt, *, scan_limit_exceeded: bool = False
) -> ExecutionAttempt:
    return ExecutionAttempt(
        attempt,
        None,
        None,
        None,
        failure_stage=EXECUTION_FAILURE,
        failure_code=EXECUTION_FAILURE_CODE,
        scan_limit_exceeded=scan_limit_exceeded,
    )


def _execute_attempt(attempt: DryRunAttempt, bq) -> ExecutionAttempt:
    if not attempt.succeeded:
        return _upstream_failure(attempt)

    try:
        validated_attempt = attempt.validated_attempt
        generated_attempt = validated_attempt.generated_attempt
        contract = generated_attempt.planned_attempt.preflight_attempt.result.contract
        section = generated_attempt.section
        sql = validated_attempt.validated_sql
        if contract is None or section is None or sql is None:
            raise ValueError("successful dry run output is incomplete")
        policy = analysis_contract_context.execution_policy(contract)
        section_limit = section.get("max_result_rows")
        if type(section_limit) is not int or section_limit < 1:
            raise ValueError("section result row limit is invalid")
        execution, diagnostic = report.execute_bq_diagnostic(
            bq,
            sql,
            max_results=min(section_limit, policy.maximum_result_rows) + 1,
            policy=policy,
        )
        if diagnostic:
            return _execution_failure(
                attempt,
                scan_limit_exceeded=(
                    diagnostic.category
                    is report.SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED
                ),
            )
        if execution is None:
            raise ValueError("common execution returned no result")
    except Exception:
        return _execution_failure(attempt)
    return ExecutionAttempt(
        attempt, execution.rows, execution.columns, execution.bytes_processed
    )


def run_manifest_executions(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    dry_run_runner: Callable[..., tuple[DryRunAttempt, ...]] = run_manifest_dry_runs,
) -> tuple[ExecutionAttempt, ...]:
    """Dry-run manifest attempts and execute only their successes."""
    dry_run_attempts = dry_run_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(_execute_attempt(attempt, bq) for attempt in dry_run_attempts)

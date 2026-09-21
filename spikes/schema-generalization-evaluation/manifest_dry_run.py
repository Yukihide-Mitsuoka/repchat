"""Dry-run locally validated manifest SQL through the common BigQuery boundary."""

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
import contract_result_validation  # noqa: E402 - sibling spike import
import run_report as report  # noqa: E402 - sibling spike import
import sql_contract_validation  # noqa: E402 - sibling spike import
from manifest_sql_validation import (  # noqa: E402 - local import after path setup
    ValidatedSQLAttempt,
    run_manifest_sql_validation,
)


DRY_RUN_FAILURE = "dry_run"
DRY_RUN_FAILURE_CODE = "dry_run_failed"


@dataclass(frozen=True)
class DryRunAttempt:
    """One validated SQL attempt after BigQuery parsing without result rows."""

    validated_attempt: ValidatedSQLAttempt
    dry_run_schema: tuple[tuple[str, ...], ...] | None
    estimated_bytes_processed: int | None
    failure_stage: str | None = None
    failure_code: str | None = None
    unauthorized_reference: bool = False
    dangerous_sql: bool = False
    scan_limit_exceeded: bool = False
    semantic_error: bool = False

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed dry run without retaining provider diagnostics."""
        if self.succeeded:
            raise ValueError(
                "a successful dry run attempt cannot create a failure recording"
            )
        if self.failure_stage != DRY_RUN_FAILURE:
            return self.validated_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if type(bytes_processed) is not int or bytes_processed < 0:
            raise ValueError("dry run bytes must be a non-negative integer")
        generated_attempt = self.validated_attempt.generated_attempt
        preflight_attempt = generated_attempt.planned_attempt.preflight_attempt
        return {
            "schema_id": preflight_attempt.schema_id,
            "case_id": preflight_attempt.case_id,
            "run": {
                "run_id": preflight_attempt.run_id,
                **dict(preflight_attempt.pipeline_fingerprints),
                "runtime_input": preflight_attempt.result.runtime_input(),
                "generated_sql": self.validated_attempt.validated_sql,
                "failure_stage": self.failure_stage,
                "failure_code": self.failure_code,
                "sql_execution_succeeded": False,
                "actual_rows": [],
                "unauthorized_reference": self.unauthorized_reference,
                "dangerous_sql": self.dangerous_sql,
                "scan_limit_exceeded": self.scan_limit_exceeded,
                "semantic_error": self.semantic_error,
                "render_succeeded": False,
                "bytes_processed": bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def _upstream_failure(attempt: ValidatedSQLAttempt) -> DryRunAttempt:
    return DryRunAttempt(
        validated_attempt=attempt,
        dry_run_schema=None,
        estimated_bytes_processed=None,
        failure_stage=attempt.failure_stage,
        failure_code=attempt.failure_code,
        unauthorized_reference=attempt.unauthorized_reference,
        dangerous_sql=attempt.dangerous_sql,
        semantic_error=attempt.semantic_error,
    )


def _dry_run_failure(
    attempt: ValidatedSQLAttempt,
    inspection: report.DryRunInspection | None,
    *,
    unauthorized_reference: bool = False,
    dangerous_sql: bool = False,
    scan_limit_exceeded: bool = False,
    semantic_error: bool = False,
) -> DryRunAttempt:
    return DryRunAttempt(
        validated_attempt=attempt,
        dry_run_schema=inspection.schema if inspection else None,
        estimated_bytes_processed=(
            inspection.estimated_bytes_processed if inspection else None
        ),
        failure_stage=DRY_RUN_FAILURE,
        failure_code=DRY_RUN_FAILURE_CODE,
        unauthorized_reference=unauthorized_reference,
        dangerous_sql=dangerous_sql,
        scan_limit_exceeded=scan_limit_exceeded,
        semantic_error=semantic_error,
    )


def _dry_run_attempt(attempt: ValidatedSQLAttempt, bq) -> DryRunAttempt:
    if not attempt.succeeded:
        return _upstream_failure(attempt)

    try:
        generated_attempt = attempt.generated_attempt
        contract = generated_attempt.planned_attempt.preflight_attempt.result.contract
        section = generated_attempt.section
        if contract is None or section is None or attempt.validated_sql is None:
            raise ValueError("successful SQL validation output is incomplete")
        policy = analysis_contract_context.execution_policy(contract)
        inspection, diagnostic = report.inspect_bq_dry_run(
            bq,
            attempt.validated_sql,
            policy=policy,
        )
        if diagnostic:
            return _dry_run_failure(
                attempt,
                inspection,
                unauthorized_reference=(
                    "outside the analysis contract" in diagnostic
                    or "referenced table identity" in diagnostic
                ),
                dangerous_sql=(
                    "statement type" in diagnostic and "expected SELECT" in diagnostic
                ),
                scan_limit_exceeded="scan limit exceeded" in diagnostic,
            )
        if inspection is None:
            raise ValueError("common dry run returned no inspection")
        if contract_result_validation.contract_result_diagnostic(
            section,
            list(inspection.schema),
            policy,
        ):
            return _dry_run_failure(attempt, inspection, semantic_error=True)
        try:
            sql_contract_validation.validate_dashboard_dry_run_schema(
                section,
                [(field[0], field[1]) for field in inspection.schema],
            )
        except sql_contract_validation.SQLContractError:
            return _dry_run_failure(attempt, inspection, semantic_error=True)
    except Exception:
        return _dry_run_failure(attempt, None)
    return DryRunAttempt(
        validated_attempt=attempt,
        dry_run_schema=inspection.schema,
        estimated_bytes_processed=inspection.estimated_bytes_processed,
    )


def run_manifest_dry_runs(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    validation_runner: Callable[..., tuple[ValidatedSQLAttempt, ...]] = (
        run_manifest_sql_validation
    ),
) -> tuple[DryRunAttempt, ...]:
    """Validate all manifest SQL attempts and dry-run only their successes."""
    validated_attempts = validation_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(_dry_run_attempt(attempt, bq) for attempt in validated_attempts)

"""Validate and execute analysis-contract-bounded BigQuery queries."""

import re
import time
from dataclasses import dataclass

from analysis_contract_context import AnalysisExecutionPolicy
from contract_sql_validation import contract_sql_diagnostic
from sql_diagnostic import (
    SQLDiagnostic,
    SQLDiagnosticCategory,
    SQLDiagnosticCode,
    sql_diagnostic,
)


@dataclass(frozen=True)
class DryRunInspection:
    """BigQuery-parsed dry-run evidence without result rows."""

    schema: tuple[tuple[str, ...], ...]
    estimated_bytes_processed: int


@dataclass(frozen=True)
class _DryRunOutcome:
    inspection: DryRunInspection | None
    diagnostic: SQLDiagnostic | None
    display_message: str | None


@dataclass(frozen=True)
class QueryExecution:
    """Completed BigQuery result and measured processing metadata."""

    rows: tuple[tuple[object, ...], ...]
    columns: tuple[str, ...]
    bytes_processed: int


@dataclass(frozen=True)
class _ExecutionOutcome:
    execution: QueryExecution | None
    diagnostic: SQLDiagnostic | None
    display_message: str | None


def _dry_run_metadata_diagnostic(
    job,
    policy: AnalysisExecutionPolicy,
) -> tuple[SQLDiagnostic | None, str | None]:
    """Validate the query using BigQuery's parsed job statistics."""
    # Keep the local text check for fast feedback, then trust BigQuery's parsed
    # metadata at the network boundary so SQL syntax tricks cannot bypass scope.
    statement_type = getattr(job, "statement_type", None)
    if statement_type != "SELECT":
        observed = statement_type or "missing"
        diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_STATEMENT_NOT_SELECT)
        return diagnostic, (
            f"bq dry-run rejected: statement type {observed}; expected SELECT"
        )

    references = getattr(job, "referenced_tables", None)
    if not references:
        diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_REFERENCES_MISSING)
        return diagnostic, diagnostic.message
    for reference in references:
        project = getattr(reference, "project", None)
        dataset_id = getattr(reference, "dataset_id", None)
        if not project or not dataset_id:
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_REFERENCE_INCOMPLETE)
            return diagnostic, diagnostic.message
        table_id = getattr(reference, "table_id", None)
        if not table_id:
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_REFERENCE_INCOMPLETE)
            return diagnostic, diagnostic.message
        if f"{project}.{dataset_id}.{table_id}" not in policy.job_tables:
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_TABLE_OUTSIDE_SCOPE)
            return diagnostic, diagnostic.message
    return None, None


def _inspect_bq_dry_run(
    bq,
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> _DryRunOutcome:
    s, validation_diagnostic = validate_sql_diagnostic(sql, policy=policy)
    if validation_diagnostic:
        return _DryRunOutcome(
            None, validation_diagnostic, validation_diagnostic.message
        )
    assert s is not None
    assert policy is not None
    from google.cloud import bigquery

    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                dry_run=True,
                maximum_bytes_billed=policy.maximum_bytes_billed,
                use_query_cache=False,
            ),
        )
        schema = tuple(
            (
                (field.name, field.field_type, field.mode)
                if isinstance(getattr(field, "mode", None), str)
                else (field.name, field.field_type)
            )
            for field in job.schema
        )
        estimated_bytes = getattr(job, "total_bytes_processed", None)
        if (
            isinstance(estimated_bytes, bool)
            or not isinstance(estimated_bytes, int)
            or estimated_bytes < 0
        ):
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_BYTES_MISSING)
            return _DryRunOutcome(None, diagnostic, diagnostic.message)
        inspection = DryRunInspection(schema, estimated_bytes)
        metadata_diagnostic, display_message = _dry_run_metadata_diagnostic(
            job, policy
        )
        if metadata_diagnostic:
            return _DryRunOutcome(
                inspection, metadata_diagnostic, display_message
            )
        if estimated_bytes > policy.maximum_bytes_billed:
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED)
            return _DryRunOutcome(inspection, diagnostic, diagnostic.message)
        return _DryRunOutcome(inspection, None, None)
    except Exception as error:  # noqa: BLE001 — dry-run diagnostics are user-actionable
        why = ""
        errors = getattr(error, "errors", None)
        if errors and isinstance(errors, list) and isinstance(errors[0], dict):
            why = errors[0].get("message", "")
        if not why:
            why = getattr(error, "message", "") or str(error)
        if re.search(
            r"(?:exceeded limit for bytes billed|maximum.*bytes.*billed|bytes billed.*limit)",
            why,
            re.I,
        ):
            diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED)
            return _DryRunOutcome(None, diagnostic, diagnostic.message)
        diagnostic = sql_diagnostic(SQLDiagnosticCode.DRY_RUN_PROVIDER_FAILURE)
        return _DryRunOutcome(
            None,
            diagnostic,
            f"bq dry-run error: {type(error).__name__}: {why[:220]}",
        )


def inspect_bq_dry_run_diagnostic(
    bq,
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> tuple[DryRunInspection | None, SQLDiagnostic | None]:
    """Dry-run SQL and return only closed diagnostics at the evaluation boundary."""
    outcome = _inspect_bq_dry_run(bq, sql, policy=policy)
    return outcome.inspection, outcome.diagnostic


def inspect_bq_dry_run(
    bq,
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Dry-run SQL and adapt its typed diagnostic to the display message API."""
    outcome = _inspect_bq_dry_run(bq, sql, policy=policy)
    return outcome.inspection, outcome.display_message


def inspect_bq_schema(
    bq,
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Dry-run a validated query and return only its output schema."""
    inspection, error = inspect_bq_dry_run(bq, sql, policy=policy)
    if error or inspection is None:
        return None, error
    return list(inspection.schema), None


def _execute_bq(
    bq,
    sql: str,
    max_results: int | None = None,
    cancel_event=None,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> _ExecutionOutcome:
    s, validation_diagnostic = validate_sql_diagnostic(sql, policy=policy)
    if validation_diagnostic:
        return _ExecutionOutcome(
            None, validation_diagnostic, validation_diagnostic.message
        )
    assert s is not None
    assert policy is not None
    from google.cloud import bigquery

    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                dry_run=False,
                maximum_bytes_billed=policy.maximum_bytes_billed,
                use_query_cache=True,
            ),
        )
        if cancel_event is not None:
            deadline = time.monotonic() + 180
            while not job.done():
                if cancel_event.wait(0.2):
                    job.cancel()
                    diagnostic = sql_diagnostic(SQLDiagnosticCode.EXECUTION_CANCELLED)
                    return _ExecutionOutcome(None, diagnostic, diagnostic.message)
                if time.monotonic() >= deadline:
                    job.cancel()
                    diagnostic = sql_diagnostic(SQLDiagnosticCode.EXECUTION_TIMEOUT)
                    return _ExecutionOutcome(None, diagnostic, diagnostic.message)
        it = job.result(timeout=180, max_results=max_results)
        # Column names come off this same job. Re-querying just to read the
        # schema would triple the scan cost of every section.
        bytes_processed = getattr(job, "total_bytes_processed", None)
        if (
            isinstance(bytes_processed, bool)
            or not isinstance(bytes_processed, int)
            or bytes_processed < 0
        ):
            diagnostic = sql_diagnostic(SQLDiagnosticCode.EXECUTION_BYTES_MISSING)
            return _ExecutionOutcome(None, diagnostic, diagnostic.message)
        return _ExecutionOutcome(
            QueryExecution(
                tuple(tuple(row.values()) for row in it),
                tuple(field.name for field in it.schema),
                bytes_processed,
            ),
            None,
            None,
        )
    except Exception as e:  # noqa: BLE001 — provider failures share one boundary
        # Take the reason out of the exception rather than truncating its front:
        # a BadRequest stringifies as a long API URL first, so a head-clipped
        # message shows the endpoint and hides the syntax error. Fourth time this
        # session that a discarded diagnostic cost a debugging round.
        why = ""
        errs = getattr(e, "errors", None)
        if errs and isinstance(errs, list) and isinstance(errs[0], dict):
            why = errs[0].get("message", "")
        if not why:
            why = getattr(e, "message", "") or str(e)
        if re.search(
            r"(?:exceeded limit for bytes billed|maximum.*bytes.*billed|bytes billed.*limit)",
            why,
            re.I,
        ):
            diagnostic = sql_diagnostic(
                SQLDiagnosticCode.EXECUTION_SCAN_LIMIT_EXCEEDED
            )
            return _ExecutionOutcome(None, diagnostic, diagnostic.message)
        diagnostic = sql_diagnostic(SQLDiagnosticCode.EXECUTION_PROVIDER_FAILURE)
        return _ExecutionOutcome(
            None,
            diagnostic,
            f"bq error: {type(e).__name__}: {why[:220]}",
        )


def execute_bq_diagnostic(
    bq,
    sql: str,
    max_results: int | None = None,
    cancel_event=None,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> tuple[QueryExecution | None, SQLDiagnostic | None]:
    """Execute SQL and return only closed diagnostics at the evaluation boundary."""
    outcome = _execute_bq(
        bq,
        sql,
        max_results=max_results,
        cancel_event=cancel_event,
        policy=policy,
    )
    return outcome.execution, outcome.diagnostic


def execute_bq(
    bq,
    sql: str,
    max_results: int | None = None,
    cancel_event=None,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Execute SQL and adapt its typed diagnostic to the display message API."""
    outcome = _execute_bq(
        bq,
        sql,
        max_results=max_results,
        cancel_event=cancel_event,
        policy=policy,
    )
    return outcome.execution, outcome.display_message


def exec_bq(
    bq,
    sql: str,
    max_results: int | None = None,
    cancel_event=None,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Execute a query and return the legacy rows-and-columns payload."""
    execution, error = execute_bq(
        bq,
        sql,
        max_results=max_results,
        cancel_event=cancel_event,
        policy=policy,
    )
    if error or execution is None:
        return None, error
    return (list(execution.rows), list(execution.columns)), None


def validate_sql_diagnostic(
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> tuple[str | None, SQLDiagnostic | None]:
    """Return normalized SQL or one closed, target-independent refusal."""
    if policy is None:
        return None, sql_diagnostic(SQLDiagnosticCode.ANALYSIS_CONTRACT_REQUIRED)
    s = sql.strip()
    if s.endswith(";"):
        s = s[:-1].rstrip()
    if not re.match(r"^(select|with)\b", s, re.I):
        return None, sql_diagnostic(SQLDiagnosticCode.NOT_SELECT)
    if ";" in s:
        return None, sql_diagnostic(SQLDiagnosticCode.MULTIPLE_STATEMENTS)
    without_comments = re.sub(r"/\*.*?\*/|--[^\n]*", " ", s, flags=re.S)
    without_literals = re.sub(r"'(?:''|[^'])*'", "''", without_comments)
    if re.search(
        r"\b(insert|update|delete|drop|create|merge|alter|call|export|grant)\b",
        without_literals,
        re.I,
    ):
        return None, sql_diagnostic(SQLDiagnosticCode.FORBIDDEN_KEYWORD)
    if re.search(
        r"\bselect\s+(?:distinct\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?\*",
        without_literals,
        re.I,
    ):
        return None, sql_diagnostic(SQLDiagnosticCode.SELECT_STAR)
    found_table = False
    for m in re.finditer(
        r"`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\.[a-zA-Z0-9_*]+`?",
        without_literals,
    ):
        reference = m.group(0).strip("`")
        if m.end() < len(without_literals) and without_literals[m.end()] in "$@":
            return None, sql_diagnostic(
                SQLDiagnosticCode.TABLE_DECORATOR_OUTSIDE_SCOPE
            )
        if reference not in policy.query_tables:
            return None, sql_diagnostic(SQLDiagnosticCode.TABLE_OUTSIDE_SCOPE)
        found_table = True
    if not found_table:
        return None, sql_diagnostic(SQLDiagnosticCode.CONTRACT_TABLE_REQUIRED)
    contract_error = contract_sql_diagnostic(s, policy)
    if contract_error:
        return None, sql_diagnostic(SQLDiagnosticCode.SCHEMA_POLICY_MISMATCH)
    return s, None


def validate_sql(
    sql: str,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> tuple[str | None, str | None]:
    """Return normalized SQL or the typed diagnostic's safe display message."""
    normalized, diagnostic = validate_sql_diagnostic(sql, policy=policy)
    return normalized, diagnostic.message if diagnostic else None

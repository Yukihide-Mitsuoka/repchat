"""Validate and execute dataset-bounded BigQuery report queries."""

import re
import time

from analysis_contract_context import AnalysisExecutionPolicy
from contract_sql_validation import contract_sql_diagnostic


DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
MAX_BYTES_BILLED = 20 * 1024**3  # 20 GiB — the sample month is far under this


def _dry_run_metadata_error(
    job,
    allowed_dataset: str,
    policy: AnalysisExecutionPolicy | None = None,
) -> str:
    """Validate the query using BigQuery's parsed job statistics."""
    # Keep the local text check for fast feedback, then trust BigQuery's parsed
    # metadata at the network boundary so SQL syntax tricks cannot bypass scope.
    statement_type = getattr(job, "statement_type", None)
    if statement_type != "SELECT":
        observed = statement_type or "missing"
        return f"bq dry-run rejected: statement type {observed}; expected SELECT"

    references = getattr(job, "referenced_tables", None)
    if not references:
        return "bq dry-run rejected: referenced tables were not returned"
    for reference in references:
        project = getattr(reference, "project", None)
        dataset_id = getattr(reference, "dataset_id", None)
        if not project or not dataset_id:
            return "bq dry-run rejected: referenced table identity is incomplete"
        if policy is not None:
            table_id = getattr(reference, "table_id", None)
            if not table_id:
                return "bq dry-run rejected: referenced table identity is incomplete"
            if f"{project}.{dataset_id}.{table_id}" not in policy.job_tables:
                return "bq dry-run rejected: table is outside the analysis contract"
            continue
        actual_dataset = f"{project}.{dataset_id}"
        if actual_dataset != allowed_dataset:
            return f"bq dry-run rejected: foreign table ref {actual_dataset}"
    return ""


def inspect_bq_schema(
    bq,
    sql: str,
    allowed_dataset: str = DATASET,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Dry-run a validated query and return its output schema without scanning rows."""
    from google.cloud import bigquery

    s, validation_error = validate_sql(sql, allowed_dataset, policy=policy)
    if validation_error:
        return None, validation_error
    assert s is not None
    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                dry_run=True,
                maximum_bytes_billed=(
                    policy.maximum_bytes_billed
                    if policy is not None
                    else MAX_BYTES_BILLED
                ),
                use_query_cache=False,
            ),
        )
        metadata_error = _dry_run_metadata_error(job, allowed_dataset, policy)
        if metadata_error:
            return None, metadata_error
        return [
            (
                (field.name, field.field_type, field.mode)
                if isinstance(getattr(field, "mode", None), str)
                else (field.name, field.field_type)
            )
            for field in job.schema
        ], None
    except Exception as error:  # noqa: BLE001 — dry-run diagnostics are user-actionable
        why = ""
        errors = getattr(error, "errors", None)
        if errors and isinstance(errors, list) and isinstance(errors[0], dict):
            why = errors[0].get("message", "")
        if not why:
            why = getattr(error, "message", "") or str(error)
        return None, f"bq dry-run error: {type(error).__name__}: {why[:220]}"


def exec_bq(
    bq,
    sql: str,
    max_results: int | None = None,
    allowed_dataset: str = DATASET,
    cancel_event=None,
    *,
    policy: AnalysisExecutionPolicy | None = None,
):
    """Read-only execution, guarded the same way the executor guards tenant SQL."""
    from google.cloud import bigquery

    s, validation_error = validate_sql(sql, allowed_dataset, policy=policy)
    if validation_error:
        return None, validation_error
    assert s is not None
    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                maximum_bytes_billed=(
                    policy.maximum_bytes_billed
                    if policy is not None
                    else MAX_BYTES_BILLED
                ),
                use_query_cache=True,
            ),
        )
        if cancel_event is not None:
            deadline = time.monotonic() + 180
            while not job.done():
                if cancel_event.wait(0.2):
                    job.cancel()
                    return None, "cancelled"
                if time.monotonic() >= deadline:
                    job.cancel()
                    return None, "bq error: TimeoutError: query exceeded 180 seconds"
        it = job.result(timeout=180, max_results=max_results)
        # Column names come off this same job. Re-querying just to read the
        # schema would triple the scan cost of every section.
        return ([tuple(r.values()) for r in it], [f.name for f in it.schema]), None
    except Exception as e:  # noqa: BLE001 — the message is the diagnostic
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
        return None, f"bq error: {type(e).__name__}: {why[:220]}"


def validate_sql(
    sql: str,
    allowed_dataset: str = DATASET,
    *,
    policy: AnalysisExecutionPolicy | None = None,
) -> tuple[str | None, str | None]:
    """Return a normalized dataset-bounded SELECT or a refusal reason."""
    s = sql.strip()
    if s.endswith(";"):
        s = s[:-1].rstrip()
    if not re.match(r"^(select|with)\b", s, re.I):
        return None, "rejected: not a SELECT"
    if ";" in s:
        return None, "rejected: multiple statements"
    without_comments = re.sub(r"/\*.*?\*/|--[^\n]*", " ", s, flags=re.S)
    without_literals = re.sub(r"'(?:''|[^'])*'", "''", without_comments)
    if re.search(
        r"\b(insert|update|delete|drop|create|merge|alter|call|export|grant)\b",
        without_literals,
        re.I,
    ):
        return None, "rejected: forbidden keyword"
    if re.search(
        r"\bselect\s+(?:distinct\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?\*",
        without_literals,
        re.I,
    ):
        return None, "rejected: SELECT * anti-pattern"
    found_table = False
    for m in re.finditer(
        r"`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\.[a-zA-Z0-9_*]+`?",
        without_literals,
    ):
        reference = m.group(0).strip("`")
        if m.end() < len(without_literals) and without_literals[m.end()] in "$@":
            return None, "rejected: table decorator is outside the analysis contract"
        if policy is not None and reference not in policy.query_tables:
            return None, "rejected: table is outside the analysis contract"
        if policy is None and f"{m.group(1)}.{m.group(2)}" != allowed_dataset:
            return None, f"rejected: foreign table ref {m.group(0)}"
        found_table = True
    if not found_table:
        if policy is not None:
            return None, "rejected: query must reference an analysis contract table"
        return None, f"rejected: query must reference dataset {allowed_dataset}"
    contract_error = contract_sql_diagnostic(s, policy)
    if contract_error:
        return None, f"rejected: {contract_error}"
    return s, None

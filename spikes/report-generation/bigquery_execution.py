"""Validate and execute dataset-bounded BigQuery report queries."""

import re
import time


DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
MAX_BYTES_BILLED = 20 * 1024**3  # 20 GiB — the sample month is far under this


def inspect_bq_schema(bq, sql: str, allowed_dataset: str = DATASET):
    """Dry-run a validated query and return its output schema without scanning rows."""
    from google.cloud import bigquery

    s, validation_error = validate_sql(sql, allowed_dataset)
    if validation_error:
        return None, validation_error
    assert s is not None
    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False),
        )
        return [(field.name, field.field_type) for field in job.schema], None
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
):
    """Read-only execution, guarded the same way the executor guards tenant SQL."""
    from google.cloud import bigquery

    s, validation_error = validate_sql(sql, allowed_dataset)
    if validation_error:
        return None, validation_error
    assert s is not None
    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                maximum_bytes_billed=MAX_BYTES_BILLED, use_query_cache=True
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
    sql: str, allowed_dataset: str = DATASET
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
    found_dataset = False
    for m in re.finditer(
        r"`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\.[a-zA-Z0-9_*]+`?",
        without_literals,
    ):
        if f"{m.group(1)}.{m.group(2)}" != allowed_dataset:
            return None, f"rejected: foreign table ref {m.group(0)}"
        found_dataset = True
    if not found_dataset:
        return None, f"rejected: query must reference dataset {allowed_dataset}"
    return s, None

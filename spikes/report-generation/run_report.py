#!/usr/bin/env python3
"""Shared SQL generation, BigQuery validation, and Evidence rendering helpers.

The executable fixed-report runner was removed. Product analysis starts in the
live consultation flow and requires an AI-authored specification before SQL.
"""
import re
import sys
import time
from pathlib import Path
from evidence_components import (
    EVIDENCE_COMPONENT,
    SOURCE,
    evidence_component,
    evidence_identifier,
    evidence_query,
)
from evidence_page import (
    GENERATED_SQL_STYLE,
    evidence_page as _evidence_page_impl,
    generated_sql_block as _generated_sql_block_impl,
)
from evidence_output import write_outputs as _write_outputs_impl
from sql_generation import (
    SHAPE_HINT,
    SQLGenerationError,
    SQL_MAX_OUTPUT_TOKENS,
    _JSON_SCHEMA,
    _load_sql_response,
    generate,
    generate_request,
    generation_request,
    repair,
    repair_request,
    repairable_dry_run_error,
)
from sql_prompt_context import SCHEMA_DDL, metrics_block, prompt_rules

HERE = Path(__file__).parent
DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
MAX_BYTES_BILLED = 20 * 1024**3  # 20 GiB — the sample month is far under this
DEFAULT_MODEL = "gemini-3.6-flash"
USD_JPY = 155.0
PRICING = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
}  # USD per 1M tokens (in, out)

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


def break_select_columns(sql: str) -> str:
    """Put each expression in every SELECT list on its own logical line."""
    out: list[str] = []
    select_depths: list[int] = []
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(sql):
        char = sql[index]
        if quote:
            out.append(char)
            if char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    out.append(sql[index + 1])
                    index += 1
                else:
                    quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
            out.append(char)
            index += 1
            continue
        if char == "(":
            depth += 1
            out.append(char)
            index += 1
            continue
        if char == ")":
            out.append(char)
            depth = max(0, depth - 1)
            index += 1
            continue
        if char.isalpha() or char == "_":
            end = index + 1
            while end < len(sql) and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            word = sql[index:end]
            upper = word.upper()
            if upper == "SELECT":
                select_depths.append(depth)
            elif upper == "FROM" and select_depths and select_depths[-1] == depth:
                select_depths.pop()
            out.append(word)
            index = end
            continue
        if char == "," and select_depths and select_depths[-1] == depth:
            out.append(",\n" + " " * (4 * (depth + 1)))
            index += 1
            while index < len(sql) and sql[index].isspace():
                index += 1
            continue
        out.append(char)
        index += 1
    return "".join(out)


def sql_parenthesis_delta(line: str) -> int:
    """Count structural parentheses while ignoring quoted SQL content."""
    delta = 0
    quote: str | None = None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char == "-" and index + 1 < len(line) and line[index + 1] == "-":
            break
        elif char == "(":
            delta += 1
        elif char == ")":
            delta -= 1
        index += 1
    return delta


def normalize_sql_indentation(formatted: str, width: int = 4) -> str:
    """Replace visual alignment offsets with structural indentation levels."""
    lines = formatted.replace("\t", " " * width).splitlines()
    normalized: list[str] = []
    depth = 0
    select_contexts: list[dict[str, int | str]] = []
    main_clause = re.compile(
        r"^(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|QUALIFY|LIMIT|"
        r"UNION(?:\s+ALL)?|EXCEPT|INTERSECT)\b",
        flags=re.I,
    )
    join_clause = re.compile(
        r"^(?:(?:LEFT|RIGHT|FULL|INNER|OUTER|CROSS|NATURAL)\s+)?JOIN\b",
        flags=re.I,
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            normalized.append("")
            continue

        leading_closes = len(stripped) - len(stripped.lstrip(")"))
        effective_depth = max(0, depth - leading_closes)
        select_contexts = [
            context
            for context in select_contexts
            if int(context["depth"]) <= effective_depth
        ]
        context = select_contexts[-1] if select_contexts else None
        upper = stripped.upper()

        if re.match(r"^SELECT\b", upper):
            select_contexts = [
                existing
                for existing in select_contexts
                if int(existing["depth"]) < effective_depth
            ]
            context = {"depth": effective_depth, "phase": "select"}
            select_contexts.append(context)
            indent_level = effective_depth
        else:
            clause = main_clause.match(stripped)
            if clause and context:
                indent_level = int(context["depth"])
                keyword = clause.group(1).upper()
                if keyword.startswith("GROUP"):
                    context["phase"] = "group"
                elif keyword.startswith("ORDER"):
                    context["phase"] = "order"
                elif keyword.startswith("FROM"):
                    context["phase"] = "from"
                elif keyword.startswith(("WHERE", "HAVING", "QUALIFY")):
                    context["phase"] = "condition"
                else:
                    context["phase"] = "clause"
            elif join_clause.match(stripped) and context:
                indent_level = int(context["depth"])
                context["phase"] = "from"
            elif re.match(r"^(AND|OR|ON|USING)\b", upper) and context:
                indent_level = int(context["depth"]) + 1
            elif stripped.startswith(")"):
                indent_level = effective_depth
            elif context and context["phase"] in {
                "select",
                "from",
                "group",
                "order",
                "condition",
            }:
                indent_level = max(int(context["depth"]) + 1, effective_depth)
            else:
                indent_level = effective_depth

        normalized.append(" " * (width * indent_level) + stripped)
        depth = max(0, depth + sql_parenthesis_delta(stripped))

    return "\n".join(normalized)


def format_sql_for_display(sql: str) -> str:
    """Format SQL for the page without changing the executable source text."""
    try:
        import sqlparse
    except ModuleNotFoundError:
        # Unit tests run without the paid demo venv. Keep this dependency-free
        # formatter deterministic; the demo venv pins sqlparse for full nesting.
        clauses = r"\s+(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\s+"
        formatted = re.sub(
            clauses,
            lambda match: f"\n{match.group(1).upper()} ",
            break_select_columns(sql.strip()),
            flags=re.I,
        )
    else:
        # AlignedIndentFilter uses keyword-width offsets instead of the requested
        # indent width. It provides useful line breaks here;
        # normalize_sql_indentation applies the four-space hierarchy below.
        formatted = sqlparse.format(
            sql.strip(),
            keyword_case="upper",
            reindent_aligned=True,
            use_space_around_operators=True,
            wrap_after=100,
        ).strip()

    # sqlparse's aligned mode keeps each expression readable, but leaves the
    # first one beside SELECT and can put SELECT beside UNION or the final CTE
    # close. Keep those structural keywords on their own lines as requested.
    formatted = re.sub(
        r"(?im)^([ \t]*)UNION\s+ALL\s+SELECT\s+",
        lambda match: f"{match.group(1)}UNION ALL\n{match.group(1)}SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?i)\bUNION[ \t]+ALL[ \t]+SELECT[ \t]+",
        "UNION ALL\nSELECT ",
        formatted,
    )
    formatted = re.sub(r"(?i)\)[ \t]+SELECT[ \t]+", ")\nSELECT ", formatted)
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # The dependency-free unit-test formatter receives the compact source, so
    # expose CTE SELECTs before applying the same line-start rule a second time.
    formatted = re.sub(
        r"(?i)\bAS[ \t]*\([ \t]*SELECT[ \t]+",
        "AS (\n    SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # Aligned mode reserves space based on keyword width, which otherwise
    # leaves the first SELECT expression at a different column from the rest.
    # Keep every projected expression at one consistent four-space offset.
    lines = formatted.splitlines()
    select_column_indent: int | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.upper() == "SELECT":
            select_column_indent = len(line) - len(line.lstrip()) + 4
            continue
        if select_column_indent is not None and re.match(
            r"^(FROM|INTO)\b", stripped, flags=re.I
        ):
            select_column_indent = None
            continue
        if select_column_indent is not None and stripped:
            lines[index] = " " * select_column_indent + stripped
    return normalize_sql_indentation("\n".join(lines))


def generated_sql_block(sql: str) -> list[str]:
    """Keep the established report API while delegating SQL block rendering."""
    return _generated_sql_block_impl(sql, format_sql=format_sql_for_display)


def evidence_page(spec: dict, results: list) -> str:
    """Keep the established report API while delegating page assembly."""
    return _evidence_page_impl(spec, results, format_sql=format_sql_for_display)


def write_outputs(out_dir: Path, spec: dict, results: list, project: str) -> Path:
    """Keep the established report API while delegating safe publication."""
    return _write_outputs_impl(
        out_dir,
        spec,
        results,
        project,
        source=SOURCE,
        render_page=evidence_page,
    )


if __name__ == "__main__":
    print(
        "固定レポートrunnerは削除されました。AI分析仕様を作成するmake demo-liveを使用してください。",
        file=sys.stderr,
    )
    raise SystemExit(2)

#!/usr/bin/env python3
"""Shared SQL generation, BigQuery validation, and Evidence rendering helpers.

The executable fixed-report runner was removed. Product analysis starts in the
live consultation flow and requires an AI-authored specification before SQL.
"""
import re
import sys
from pathlib import Path
from bigquery_execution import (
    DATASET,
    MAX_BYTES_BILLED,
    exec_bq,
    inspect_bq_schema,
    validate_sql,
)
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
from sql_display_structure import (
    break_select_columns,
    normalize_sql_indentation,
    sql_parenthesis_delta,
)
from sql_prompt_context import SCHEMA_DDL, metrics_block, prompt_rules

HERE = Path(__file__).parent
DEFAULT_MODEL = "gemini-3.6-flash"
USD_JPY = 155.0
PRICING = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
}  # USD per 1M tokens (in, out)

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

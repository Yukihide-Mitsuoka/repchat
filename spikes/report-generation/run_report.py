#!/usr/bin/env python3
"""Shared SQL generation, BigQuery validation, and Evidence rendering helpers.

The executable fixed-report runner was removed. Product analysis starts in the
live consultation flow and requires an AI-authored specification before SQL.
"""
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
from sql_display import format_sql_for_display
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

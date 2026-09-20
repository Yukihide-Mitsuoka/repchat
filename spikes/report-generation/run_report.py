#!/usr/bin/env python3
"""Shared Vertex pricing, SQL generation, BigQuery validation, and display helpers.

The executable fixed-report runner was removed. Product analysis starts in the
live consultation flow and requires an AI-authored specification before SQL.
"""
import sys
from pathlib import Path
from bigquery_execution import (
    DryRunInspection,
    QueryExecution,
    exec_bq,
    execute_bq,
    inspect_bq_dry_run,
    inspect_bq_schema,
    validate_sql,
)
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

HERE = Path(__file__).parent
DEFAULT_MODEL = "gemini-3.6-flash"
USD_JPY = 155.0
PRICING = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
}  # USD per 1M tokens (in, out)


def vertex_cost_jpy(model: str, usage: dict) -> float:
    """Calculate one Vertex request cost from the shared model price table."""
    input_price, output_price = PRICING[model]
    return (
        usage["input_tokens"] * input_price
        + usage["output_tokens"] * output_price
    ) / 1e6 * USD_JPY

if __name__ == "__main__":
    print(
        "固定レポートrunnerと対象別ライブデモ入口は削除されました。",
        file=sys.stderr,
    )
    raise SystemExit(2)

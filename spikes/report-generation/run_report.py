"""Shared Vertex pricing, SQL generation, and contract-bound query helpers."""

from bigquery_execution import (
    exec_bq,
    inspect_bq_schema,
    validate_sql,
)
from sql_generation import (
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

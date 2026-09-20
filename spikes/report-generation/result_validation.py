"""Validate and normalize query results without analysis-target knowledge."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import contract_result_validation
import visualization_results
from analysis_contract_context import AnalysisExecutionPolicy


class ResultValidationError(ValueError):
    """Raised when executed rows cannot become a contract-bound JSON result."""


@dataclass(frozen=True)
class ValidatedResult:
    """A visualization-compatible result containing only JSON-safe values."""

    rows: tuple[tuple[Any, ...], ...]
    columns: tuple[str, ...]
    visualization: str


def validate_dashboard_result(
    section: dict,
    rows: list[tuple] | tuple[tuple[object, ...], ...],
    columns: list[str] | tuple[str, ...],
    *,
    max_result_rows: int,
    policy: AnalysisExecutionPolicy,
) -> ValidatedResult:
    """Apply the shared row, contract, visualization, and JSON boundaries."""
    if len(rows) > max_result_rows:
        raise ResultValidationError(
            f"結果が{max_result_rows}行を超えたため描画しません。集計条件を追加してください。"
        )
    column_values = list(columns)
    contract_diagnostic = contract_result_validation.contract_result_diagnostic(
        section,
        column_values,
        policy,
    )
    if contract_diagnostic:
        raise ResultValidationError(contract_diagnostic)
    row_values = list(rows)
    visualization = visualization_results.dashboard_visualization(
        section,
        row_values,
        column_values,
    )
    try:
        normalized_rows = tuple(
            tuple(visualization_results.json_value(value) for value in row)
            for row in row_values
        )
        json.dumps(normalized_rows, ensure_ascii=False, allow_nan=False)
    except (OverflowError, TypeError, ValueError):
        raise ResultValidationError(
            "結果をJSON互換形式へ変換できないため描画しません。"
        ) from None
    return ValidatedResult(
        rows=normalized_rows,
        columns=tuple(column_values),
        visualization=visualization,
    )

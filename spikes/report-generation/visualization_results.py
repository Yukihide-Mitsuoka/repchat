"""Validate and classify query results for the confirmed dashboard visualization."""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from decimal import Decimal

from visualization_flows import (
    MAX_SANKEY_EDGE_ROWS,
    MAX_SANKEY_PAGES,
    MAX_SANKEY_PATHS,
    valid_flow_sankey_result,
    valid_sankey_result,
)
from visualization_geography import valid_geojson_geometry, valid_geojson_map


class VisualizationResultError(ValueError):
    """Raised when query results cannot satisfy the confirmed visualization."""


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value if value is None or isinstance(value, (str, int, float, bool)) else str(value)


def dashboard_visualization(section: dict, rows: list[tuple], columns: list[str]) -> str:
    """Validate the confirmed AI chart before selecting its renderer."""
    planned = section.get("planned_visualization")
    if not planned:
        raise VisualizationResultError(
            f"{section['title']}にAIが確定した描画仕様がないため実行しません。"
        )
    numeric = (int, float, Decimal)
    finite = lambda value: isinstance(value, numeric) and math.isfinite(float(value))
    nullable_finite = lambda value: value is None or finite(value)
    width = len(columns)
    valid = all(len(row) == width for row in rows)
    if planned == "scorecard":
        valid = valid and width == 1 and (not rows or len(rows) == 1 and finite(rows[0][0]))
    elif planned == "kpi_group":
        valid = valid and 2 <= width <= 4 and (
            not rows or len(rows) == 1 and all(finite(value) for value in rows[0])
        )
    elif planned == "bar":
        valid = valid and width == 2 and all(finite(row[1]) and row[1] >= 0 for row in rows)
    elif planned in {"grouped_bar", "stacked_bar", "percent_stacked_bar"}:
        valid = valid and 3 <= width <= 5 and all(
            all(finite(value) and value >= 0 for value in row[1:]) for row in rows
        )
    elif planned == "line":
        valid = valid and width == 2 and all(
            isinstance(row[0], (date, datetime)) and nullable_finite(row[1]) for row in rows
        )
    elif planned == "area":
        valid = valid and width == 2 and all(
            isinstance(row[0], (date, datetime)) and finite(row[1]) for row in rows
        )
    elif planned == "multi_line":
        valid = valid and 3 <= width <= 5 and all(
            isinstance(row[0], (date, datetime))
            and all(nullable_finite(value) for value in row[1:])
            for row in rows
        )
    elif planned in {"stacked_area", "percent_stacked_area"}:
        valid = valid and 3 <= width <= 5 and all(
            isinstance(row[0], (date, datetime))
            and all(finite(value) and value >= 0 for value in row[1:])
            for row in rows
        )
    elif planned == "histogram":
        valid = valid and width == 2 and all(
            finite(row[0]) and finite(row[1]) and row[1] >= 0 for row in rows
        )
    elif planned == "donut":
        valid = valid and width == 2 and all(finite(row[1]) and row[1] >= 0 for row in rows)
    elif planned == "calendar_heatmap":
        valid = valid and width == 2 and all(
            isinstance(row[0], (date, datetime)) and finite(row[1]) for row in rows
        )
    elif planned == "scatter":
        dimension_count = section.get("dimension_count", 1)
        valid = valid and width == dimension_count + 2 and all(
            (dimension_count == 1 or isinstance(row[1], str))
            and all(finite(value) for value in row[dimension_count:])
            for row in rows
        )
    elif planned == "bubble":
        dimension_count = section.get("dimension_count", 1)
        valid = valid and width == dimension_count + 3 and all(
            (dimension_count == 1 or isinstance(row[1], str))
            and all(finite(value) for value in row[dimension_count:])
            and row[-1] >= 0
            for row in rows
        )
    elif planned in {"funnel", "funnel_horizontal"}:
        valid = valid and width == 2 and all(finite(row[1]) and row[1] >= 0 for row in rows)
    elif planned == "heatmap":
        valid = valid and width == 3 and all(finite(row[2]) for row in rows)
    elif planned == "table":
        valid = valid and width >= 1
    elif planned == "pivot_table":
        pairs = [(row[0], row[1]) for row in rows]
        valid = (
            valid
            and 3 <= width <= 6
            and len(pairs) == len(set(pairs))
            and all(
                (isinstance(row[0], (str, date, datetime)) or finite(row[0]))
                and (isinstance(row[1], (str, date, datetime)) or finite(row[1]))
                and all(nullable_finite(value) for value in row[2:])
                for row in rows
            )
        )
    elif planned == "comparison_table":
        valid = valid and 4 <= width <= 7 and all(
            all(finite(value) for value in row[-3:])
            and abs((row[-3] - row[-2]) - row[-1])
            <= max(1e-9, abs(row[-3]) * 1e-9, abs(row[-2]) * 1e-9)
            for row in rows
        )
    elif planned == "sparkline_table":
        pairs = [(row[0], row[1]) for row in rows]
        valid = (
            valid
            and width == 3
            and len(pairs) == len(set(pairs))
            and all(
                isinstance(row[0], str)
                and row[0].strip()
                and isinstance(row[1], (date, datetime))
                and nullable_finite(row[2])
                for row in rows
            )
        )
    elif planned in {"sankey", "sankey_vertical"}:
        valid = valid and (not rows or valid_sankey_result(rows))
    elif planned in {"flow_sankey", "flow_sankey_vertical"}:
        valid = valid and (not rows or valid_flow_sankey_result(rows))
    elif planned == "annotated_line":
        valid = valid and width == 3 and all(
            isinstance(row[0], (date, datetime))
            and (row[1] is None or isinstance(row[1], str))
            and nullable_finite(row[2])
            for row in rows
        )
    elif planned == "sparkline":
        valid = valid and width == 2 and all(
            isinstance(row[0], (date, datetime)) and nullable_finite(row[1]) for row in rows
        )
    elif planned == "mixed_bar_line":
        valid = valid and 3 <= width <= 5 and all(
            isinstance(row[0], (str, date, datetime))
            and all(nullable_finite(value) for value in row[1:])
            for row in rows
        )
    elif planned == "delta":
        valid = valid and width == 2 and (
            not rows or len(rows) == 1 and all(finite(value) for value in rows[0])
        )
    elif planned in {"box_plot", "box_plot_horizontal"}:
        valid = valid and width == 6 and all(
            isinstance(row[0], str)
            and all(finite(value) for value in row[1:])
            and list(row[1:]) == sorted(row[1:])
            for row in rows
        )
    elif planned == "treemap":
        dimension_count = section.get("dimension_count", width - 1)
        paths = [tuple(row[:dimension_count]) for row in rows]
        valid = (
            valid
            and 2 <= width <= 5
            and len(paths) == len(set(paths))
            and all(
                all(isinstance(value, str) and value.strip() for value in row[:dimension_count])
                and finite(row[-1]) and row[-1] >= 0
                for row in rows
            )
        )
    elif planned == "pie":
        valid = valid and width == 2 and all(
            isinstance(row[0], str) and row[0].strip() and finite(row[1]) and row[1] >= 0
            for row in rows
        )
    elif planned in {"area_map", "us_map"}:
        region_ids = [row[0] for row in rows]
        valid = (
            valid
            and width == 3
            and len(region_ids) == len(set(region_ids))
            and all(
                isinstance(row[0], str)
                and row[0].strip()
                and (planned != "us_map" or re.fullmatch(r"[A-Z]{2}", row[0]))
                and valid_geojson_geometry(row[1])
                and finite(row[2]) and row[2] >= 0
                for row in rows
            )
        )
    elif planned in {"point_map", "bubble_map"}:
        expected_width = 5 if planned == "point_map" else 6
        geometry_values = [row[1] for row in rows if row[1] is not None]
        valid = (
            valid
            and width == expected_width
            and bool(geometry_values)
            and all(valid_geojson_map(value) for value in geometry_values)
            and all(
                isinstance(row[0], str) and row[0].strip()
                and (row[1] is None or isinstance(row[1], str))
                and finite(row[2]) and -90 <= row[2] <= 90
                and finite(row[3]) and -180 <= row[3] <= 180
                and all(finite(value) and value >= 0 for value in row[4:])
                for row in rows
            )
        )
    elif planned == "base_map":
        valid = valid and width == 7 and any(row[2] is not None for row in rows) and all(
            isinstance(row[0], str)
            and row[0] in {"area", "point", "bubble"}
            and isinstance(row[1], str) and row[1].strip()
            and (row[2] is None or valid_geojson_map(row[2]))
            and finite(row[6]) and row[6] >= 0
            and (
                row[0] == "area" and valid_geojson_geometry(row[2])
                and row[3] is None and row[4] is None and row[5] is None
                or row[0] == "point" and finite(row[3]) and -90 <= row[3] <= 90
                and finite(row[4]) and -180 <= row[4] <= 180 and row[5] is None
                or row[0] == "bubble" and finite(row[3]) and -90 <= row[3] <= 90
                and finite(row[4]) and -180 <= row[4] <= 180
                and finite(row[5]) and row[5] >= 0
            )
            for row in rows
        )
    elif planned == "reference_line":
        valid = valid and width == 3 and all(
            isinstance(row[0], (str, date, datetime))
            and all(finite(value) for value in row[1:])
            for row in rows
        )
    elif planned == "reference_area":
        valid = valid and width == 4 and all(
            isinstance(row[0], (str, date, datetime))
            and all(finite(value) for value in row[1:])
            and row[2] <= row[3]
            for row in rows
        )
    else:
        valid = False
    if not valid:
        raise VisualizationResultError(
            f"{section['title']}の結果形状がAI分析仕様の{planned}と一致しないため"
            "描画しません。"
        )
    return "scalar" if planned == "scorecard" else planned

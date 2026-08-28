"""Validate and classify query results for the confirmed dashboard visualization."""

from __future__ import annotations

import json
import math
import re
from datetime import date, datetime
from decimal import Decimal

import analysis_planner as planner

MAX_SANKEY_PAGES = planner.MAX_SANKEY_PAGES
MAX_SANKEY_PATHS = planner.MAX_SANKEY_PATHS
MAX_SANKEY_EDGE_ROWS = planner.MAX_SANKEY_EDGE_ROWS


class VisualizationResultError(ValueError):
    """Raised when query results cannot satisfy the confirmed visualization."""


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value if value is None or isinstance(value, (str, int, float, bool)) else str(value)


def valid_sankey_result(rows: list[tuple]) -> bool:
    """Validate bounded adjacent Sankey edges without inferring a chart type."""
    numeric = (int, float, Decimal)

    def stage(value: str) -> int | None:
        match = re.match(r"^(\d+)\.", value.strip())
        return int(match.group(1)) if match else None

    if not rows or len(rows) > MAX_SANKEY_EDGE_ROWS:
        return False
    valid_rows = all(
        len(row) == 3
        and isinstance(row[0], str)
        and isinstance(row[1], str)
        and isinstance(row[2], numeric)
        and math.isfinite(float(row[2]))
        and row[2] >= 0
        and stage(row[0]) is not None
        and stage(row[1]) == stage(row[0]) + 1
        and stage(row[1]) <= MAX_SANKEY_PAGES
        for row in rows
    )
    if not valid_rows:
        return False
    pairs = {(row[0], row[1]) for row in rows}
    if len(pairs) != len(rows):
        return False
    nodes_by_stage: dict[int, set[str]] = {}
    for source, target, _value in rows:
        nodes_by_stage.setdefault(stage(source), set()).add(source)
        nodes_by_stage.setdefault(stage(target), set()).add(target)
    return all(len(nodes) <= MAX_SANKEY_PATHS for nodes in nodes_by_stage.values())


def valid_flow_sankey_result(rows: list[tuple]) -> bool:
    """Validate a bounded acyclic directed flow without page-navigation semantics."""
    numeric = (int, float, Decimal)
    if not rows or len(rows) > planner.MAX_FLOW_SANKEY_EDGES:
        return False
    if not all(
        len(row) == 3
        and isinstance(row[0], str)
        and row[0].strip()
        and isinstance(row[1], str)
        and row[1].strip()
        and row[0] != row[1]
        and isinstance(row[2], numeric)
        and math.isfinite(float(row[2]))
        and row[2] >= 0
        for row in rows
    ):
        return False
    edges = {(row[0], row[1]) for row in rows}
    if len(edges) != len(rows):
        return False
    nodes = {value for edge in edges for value in edge}
    indegree = {node: 0 for node in nodes}
    outgoing = {node: [] for node in nodes}
    for source, target in edges:
        outgoing[source].append(target)
        indegree[target] += 1
    pending = [node for node, count in indegree.items() if count == 0]
    visited = 0
    while pending:
        source = pending.pop()
        visited += 1
        for target in outgoing[source]:
            indegree[target] -= 1
            if indegree[target] == 0:
                pending.append(target)
    return visited == len(nodes)


def valid_geojson_geometry(value: object) -> bool:
    """Accept a closed GeoJSON Polygon/MultiPolygon supplied by the query result."""
    if not isinstance(value, str):
        return False
    try:
        geometry = json.loads(value)
    except (TypeError, ValueError):
        return False

    def valid_ring(ring: object) -> bool:
        return (
            isinstance(ring, list)
            and len(ring) >= 4
            and ring[0] == ring[-1]
            and all(
                isinstance(point, list)
                and len(point) >= 2
                and all(isinstance(coordinate, (int, float)) for coordinate in point[:2])
                and -180 <= point[0] <= 180
                and -90 <= point[1] <= 90
                for point in ring
            )
        )

    if not isinstance(geometry, dict):
        return False
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon":
        polygons = [coordinates]
    elif geometry.get("type") == "MultiPolygon":
        polygons = coordinates
    else:
        return False
    return bool(polygons) and all(
        isinstance(polygon, list) and polygon and all(valid_ring(ring) for ring in polygon)
        for polygon in polygons
    )


def valid_geojson_map(value: object) -> bool:
    """Accept query-provided polygon geometry, Feature, or FeatureCollection."""
    if valid_geojson_geometry(value):
        return True
    if not isinstance(value, str):
        return False
    try:
        document = json.loads(value)
    except (TypeError, ValueError):
        return False
    if not isinstance(document, dict):
        return False
    if document.get("type") == "Feature":
        return valid_geojson_geometry(json.dumps(document.get("geometry")))
    if document.get("type") != "FeatureCollection":
        return False
    features = document.get("features")
    return bool(features) and all(
        isinstance(feature, dict)
        and feature.get("type") == "Feature"
        and valid_geojson_geometry(json.dumps(feature.get("geometry")))
        for feature in features
    )


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


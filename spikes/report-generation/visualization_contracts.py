"""Canonical renderer capability contracts for analysis planning."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VisualizationContract:
    """One renderer capability exposed to analysis planning."""

    chart: str
    source_shape: tuple[int, int, int, int]
    max_result_rows: int


MAX_SANKEY_STAGES = 4
MAX_SANKEY_PATHS = 10
MAX_SANKEY_EDGE_ROWS = MAX_SANKEY_PATHS * (MAX_SANKEY_STAGES - 1)
MAX_FLOW_SANKEY_EDGES = 50
MAX_CALENDAR_YEARS = 5
MAX_CALENDAR_ROWS = MAX_CALENDAR_YEARS * 366
STAGED_SANKEY_CHARTS = frozenset({"sankey", "sankey_vertical"})
FLOW_SANKEY_CHARTS = frozenset({"flow_sankey", "flow_sankey_vertical"})
SANKEY_CHARTS = STAGED_SANKEY_CHARTS | FLOW_SANKEY_CHARTS


VISUALIZATION_CONTRACTS = (
    VisualizationContract("scorecard", (0, 0, 1, 1), 1),
    VisualizationContract("kpi_group", (0, 0, 2, 4), 1),
    VisualizationContract("bar", (1, 1, 1, 1), 30),
    VisualizationContract("grouped_bar", (1, 1, 2, 4), 20),
    VisualizationContract("stacked_bar", (1, 1, 2, 4), 20),
    VisualizationContract("percent_stacked_bar", (1, 1, 2, 4), 20),
    VisualizationContract("line", (1, 1, 1, 1), 100),
    VisualizationContract("multi_line", (1, 1, 2, 4), 100),
    VisualizationContract("area", (1, 1, 1, 1), 100),
    VisualizationContract("stacked_area", (1, 1, 2, 4), 100),
    VisualizationContract("percent_stacked_area", (1, 1, 2, 4), 100),
    VisualizationContract("histogram", (1, 1, 1, 1), 30),
    VisualizationContract("donut", (1, 1, 1, 1), 12),
    VisualizationContract("calendar_heatmap", (1, 1, 1, 1), MAX_CALENDAR_ROWS),
    VisualizationContract("scatter", (1, 2, 2, 2), 100),
    VisualizationContract("bubble", (1, 2, 3, 3), 100),
    VisualizationContract("funnel", (1, 1, 1, 1), 12),
    VisualizationContract("funnel_horizontal", (1, 1, 1, 1), 12),
    VisualizationContract("heatmap", (2, 2, 1, 1), 100),
    VisualizationContract("table", (0, 4, 1, 4), 100),
    VisualizationContract("pivot_table", (2, 2, 1, 4), 100),
    VisualizationContract("comparison_table", (1, 4, 1, 1), 100),
    VisualizationContract("sparkline_table", (2, 2, 1, 1), 100),
    VisualizationContract("sankey", (2, 2, 1, 1), MAX_SANKEY_EDGE_ROWS),
    VisualizationContract("sankey_vertical", (2, 2, 1, 1), MAX_SANKEY_EDGE_ROWS),
    VisualizationContract("flow_sankey", (2, 2, 1, 1), MAX_FLOW_SANKEY_EDGES),
    VisualizationContract(
        "flow_sankey_vertical", (2, 2, 1, 1), MAX_FLOW_SANKEY_EDGES
    ),
    VisualizationContract("annotated_line", (2, 2, 1, 1), 100),
    VisualizationContract("sparkline", (1, 1, 1, 1), 100),
    VisualizationContract("mixed_bar_line", (1, 1, 2, 4), 100),
    VisualizationContract("delta", (0, 0, 1, 1), 1),
    VisualizationContract("box_plot", (1, 1, 1, 1), 30),
    VisualizationContract("box_plot_horizontal", (1, 1, 1, 1), 30),
    VisualizationContract("treemap", (1, 4, 1, 1), 100),
    VisualizationContract("pie", (1, 1, 1, 1), 12),
    VisualizationContract("area_map", (2, 2, 1, 1), 100),
    VisualizationContract("us_map", (2, 2, 1, 1), 60),
    VisualizationContract("point_map", (2, 2, 1, 1), 100),
    VisualizationContract("bubble_map", (2, 2, 2, 2), 100),
    VisualizationContract("base_map", (3, 3, 2, 2), 100),
    VisualizationContract("reference_line", (1, 1, 1, 1), 100),
    VisualizationContract("reference_area", (1, 1, 1, 1), 100),
)

SUPPORTED_DASHBOARD_CHARTS = tuple(
    contract.chart for contract in VISUALIZATION_CONTRACTS
)
CHART_SOURCE_SHAPE_CONTRACTS = {
    contract.chart: contract.source_shape for contract in VISUALIZATION_CONTRACTS
}
DASHBOARD_ROW_LIMITS = {
    contract.chart: contract.max_result_rows for contract in VISUALIZATION_CONTRACTS
}

# These are renderer roles, not planner measures. A ``*`` suffix means that the
# role repeats for the number of source dimensions or measures accepted by the
# corresponding source shape. Keeping this inventory beside the source shape
# prevents derived, positional, and statistical result columns from being
# mistaken for customer-defined metrics.
CHART_RESULT_ROLE_CONTRACTS = {
    "scorecard": ("metric_value",),
    "kpi_group": ("metric_*",),
    "bar": ("category", "metric_value"),
    "grouped_bar": ("category", "metric_*"),
    "stacked_bar": ("category", "metric_*"),
    "percent_stacked_bar": ("category", "metric_*"),
    "line": ("temporal_dimension", "metric_value"),
    "multi_line": ("temporal_dimension", "metric_*"),
    "area": ("temporal_dimension", "metric_value"),
    "stacked_area": ("temporal_dimension", "metric_*"),
    "percent_stacked_area": ("temporal_dimension", "metric_*"),
    "histogram": ("bin_start", "frequency"),
    "donut": ("category", "metric_value"),
    "calendar_heatmap": ("temporal_dimension", "metric_value"),
    "scatter": ("category", "series?", "x_value", "y_value"),
    "bubble": ("category", "series?", "x_value", "y_value", "size_value"),
    "funnel": ("stage", "metric_value"),
    "funnel_horizontal": ("stage", "metric_value"),
    "heatmap": ("x_category", "y_category", "metric_value"),
    "table": ("dimension_*", "metric_*"),
    "pivot_table": ("row_dimension", "pivot_dimension", "metric_*"),
    "comparison_table": (
        "dimension_*",
        "current_value",
        "comparison_value",
        "delta_value",
    ),
    "sparkline_table": ("category", "temporal_dimension", "metric_value"),
    "sankey": ("source", "target", "metric_value"),
    "sankey_vertical": ("source", "target", "metric_value"),
    "flow_sankey": ("source", "target", "metric_value"),
    "flow_sankey_vertical": ("source", "target", "metric_value"),
    "annotated_line": ("temporal_dimension", "annotation_label", "metric_value"),
    "sparkline": ("temporal_dimension", "metric_value"),
    "mixed_bar_line": ("category", "metric_*"),
    "delta": ("current_value", "comparison_value"),
    "box_plot": (
        "category",
        "min_value",
        "q1_value",
        "median_value",
        "q3_value",
        "max_value",
    ),
    "box_plot_horizontal": (
        "category",
        "min_value",
        "q1_value",
        "median_value",
        "q3_value",
        "max_value",
    ),
    "treemap": ("level_*", "metric_value"),
    "pie": ("category", "metric_value"),
    "area_map": ("region_id", "geometry_geojson", "metric_value"),
    "us_map": ("region_id", "geometry_geojson", "metric_value"),
    "point_map": (
        "point_name",
        "map_geojson",
        "latitude",
        "longitude",
        "metric_value",
    ),
    "bubble_map": (
        "point_name",
        "map_geojson",
        "latitude",
        "longitude",
        "size_value",
        "metric_value",
    ),
    "base_map": (
        "layer_kind",
        "item_name",
        "geometry_geojson",
        "latitude",
        "longitude",
        "size_value",
        "metric_value",
    ),
    "reference_line": ("category", "metric_value", "reference_value"),
    "reference_area": (
        "category",
        "metric_value",
        "lower_value",
        "upper_value",
    ),
}
CHART_PLANNING_RULES = (
    "comparison_tableはmeasuresを比較対象の定義済み指標1件にし、execution_promptに"
    "現在値と比較値の対象条件を明記する。current_value、comparison_value、delta_valueは"
    "SQL出力列でありmeasuresへ指定しない。複数の独立指標を並べる場合はtableまたは"
    "grouped_barを使う。",
    "histogram、delta、box_plot、reference_line、reference_areaはmeasuresを元となる"
    "定義済み指標だけにする。階級、現在値・比較値、統計値、基準値・範囲はSQLの派生出力役割であり、"
    "別々の指標として指定しない。",
    "point_mapは位置列をmeasuresへ指定せず値の指標1件、bubble_mapとbase_mapはsizeと値の"
    "指標2件を指定する。latitude、longitude、geometry、layerはSQL出力役割である。",
)

if not (
    len(VISUALIZATION_CONTRACTS)
    == len(CHART_SOURCE_SHAPE_CONTRACTS)
    == len(DASHBOARD_ROW_LIMITS)
    == len(CHART_RESULT_ROLE_CONTRACTS)
    and set(CHART_SOURCE_SHAPE_CONTRACTS) == set(CHART_RESULT_ROLE_CONTRACTS)
):
    raise ValueError("visualization chart identifiers must be unique")

"""Canonical renderer capability contracts for analysis planning."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VisualizationContract:
    """One renderer capability exposed to analysis planning."""

    chart: str
    shape: tuple[int, int, int, int]
    max_result_rows: int


MAX_SANKEY_PAGES = 4
MAX_SANKEY_PATHS = 10
MAX_SANKEY_EDGE_ROWS = MAX_SANKEY_PATHS * (MAX_SANKEY_PAGES - 1)
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
    VisualizationContract("delta", (0, 0, 2, 2), 1),
    VisualizationContract("box_plot", (1, 1, 5, 5), 30),
    VisualizationContract("box_plot_horizontal", (1, 1, 5, 5), 30),
    VisualizationContract("treemap", (1, 4, 1, 1), 100),
    VisualizationContract("pie", (1, 1, 1, 1), 12),
    VisualizationContract("area_map", (2, 2, 1, 1), 100),
    VisualizationContract("us_map", (2, 2, 1, 1), 60),
    VisualizationContract("point_map", (2, 2, 3, 3), 100),
    VisualizationContract("bubble_map", (2, 2, 4, 4), 100),
    VisualizationContract("base_map", (3, 3, 4, 4), 100),
    VisualizationContract("reference_line", (1, 1, 2, 2), 100),
    VisualizationContract("reference_area", (1, 1, 3, 3), 100),
)

SUPPORTED_DASHBOARD_CHARTS = tuple(
    contract.chart for contract in VISUALIZATION_CONTRACTS
)
CHART_SHAPE_CONTRACTS = {
    contract.chart: contract.shape for contract in VISUALIZATION_CONTRACTS
}
DASHBOARD_ROW_LIMITS = {
    contract.chart: contract.max_result_rows for contract in VISUALIZATION_CONTRACTS
}
CHART_PLANNING_RULES = (
    "comparison_tableはmeasuresを比較対象の定義済み指標1件にし、execution_promptに"
    "現在値と比較値の対象条件を明記する。current_value、comparison_value、delta_valueは"
    "SQL出力列でありmeasuresへ指定しない。複数の独立指標を並べる場合はtableまたは"
    "grouped_barを使う。",
)

if not (
    len(VISUALIZATION_CONTRACTS)
    == len(CHART_SHAPE_CONTRACTS)
    == len(DASHBOARD_ROW_LIMITS)
):
    raise ValueError("visualization chart identifiers must be unique")

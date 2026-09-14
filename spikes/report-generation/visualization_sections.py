"""Build guarded SQL and renderer sections from confirmed visualizations."""

from __future__ import annotations

from visualization_contracts import (
    CHART_RESULT_ROLE_CONTRACTS,
    DASHBOARD_ROW_LIMITS,
    MAX_SANKEY_PAGES,
    MAX_SANKEY_PATHS,
    SUPPORTED_DASHBOARD_CHARTS,
)


class UnsupportedVisualizationError(ValueError):
    """A confirmed visualization has no executable renderer contract."""


COMPONENT_BY_CHART = {
    chart: chart for chart in SUPPORTED_DASHBOARD_CHARTS
} | {"scorecard": "table", "bar": "table"}


def build_planned_analysis_section(
    panel: dict, section_id: str | None = None
) -> dict:
    """Translate one confirmed AI specification into a guarded render contract."""
    chart = panel.get("chart")
    if chart not in COMPONENT_BY_CHART:
        raise UnsupportedVisualizationError(
            "確定した分析仕様の可視化種別が未対応です。"
        )
    section = {
        "id": section_id or panel["id"],
        "title": panel["title"],
        "text": panel["execution_prompt"],
        "compare": "execution",
        "component": COMPONENT_BY_CHART[chart],
        "planned_visualization": chart,
        "verification": "execution",
        "purpose": panel.get("decision", panel.get("objective", "")),
        "max_result_rows": DASHBOARD_ROW_LIMITS[chart],
        "dimension_count": len(panel["dimensions"]),
        "measure_count": len(panel["measures"]),
        "semantic_dimensions": list(panel["dimensions"]),
        "semantic_measures": list(panel["measures"]),
        "result_roles": CHART_RESULT_ROLE_CONTRACTS[chart],
    }
    dimensions = panel["dimensions"]
    measures = panel["measures"]
    if chart == "scorecard":
        section["shape"] = {"rows": "1行", "columns": measures}
        section["source_columns"] = ["metric_value"]
    elif chart == "kpi_group":
        section["shape"] = {"rows": "1行", "columns": measures}
        section["source_columns"] = [
            f"metric_{index}" for index in range(1, len(measures) + 1)
        ]
    elif chart in {"bar", "donut", "pie"}:
        section["shape"] = {"rows": "区分ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["category", "metric_value"]
    elif chart in {"grouped_bar", "stacked_bar", "percent_stacked_bar", "mixed_bar_line"}:
        section["shape"] = {"rows": "区分ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = [
            "category",
            *[f"metric_{index}" for index in range(1, len(measures) + 1)],
        ]
    elif chart in {"line", "area", "calendar_heatmap", "sparkline"}:
        section["shape"] = {"rows": "日付ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["event_date", "metric_value"]
    elif chart in {"multi_line", "stacked_area", "percent_stacked_area"}:
        section["shape"] = {"rows": "日付ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = [
            "event_date",
            *[f"metric_{index}" for index in range(1, len(measures) + 1)],
        ]
    elif chart == "histogram":
        measure = measures[0]
        section["shape"] = {
            "rows": "階級ごとに1行",
            "columns": [f"{measure}（階級下限）", f"{measure}（度数）"],
        }
        section["source_columns"] = ["bin_start", "frequency"]
        section["generation_requirements"] = [
            f"bin_startは同じ指標「{measure}」の値を階級化した下限にする",
            f"frequencyは指標「{measure}」の各階級に含まれる行数にする",
        ]
    elif chart in {"scatter", "bubble"}:
        value_columns = ["x_value", "y_value"]
        if chart == "bubble":
            value_columns.append("size_value")
        section["shape"] = {"rows": "項目ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = [
            "category",
            *(["series"] if len(dimensions) == 2 else []),
            *value_columns,
        ]
    elif chart in {"funnel", "funnel_horizontal"}:
        section["shape"] = {"rows": "段階ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["stage", "metric_value"]
        section["generation_requirements"] = [
            "stageには順序が判別できる番号接頭辞を付ける"
        ]
    elif chart == "heatmap":
        section["shape"] = {
            "rows": "2つの区分の組み合わせごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["x_category", "y_category", "metric_value"]
    elif chart in {"table", "pivot_table"}:
        section["shape"] = {
            "rows": "区分または集計単位ごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = (
            [
                "row_dimension",
                "pivot_dimension",
                *[f"metric_{index}" for index in range(1, len(measures) + 1)],
            ]
            if chart == "pivot_table"
            else [
                *[f"dimension_{index}" for index in range(1, len(dimensions) + 1)],
                *[f"metric_{index}" for index in range(1, len(measures) + 1)],
            ]
        )
    elif chart == "comparison_table":
        measure = measures[0]
        section["shape"] = {
            "rows": "区分または集計単位ごとに1行",
            "columns": dimensions
            + [
                f"{measure}（現在値）",
                f"{measure}（比較値）",
                f"{measure}（差分）",
            ],
        }
        section["source_columns"] = [
            *[f"dimension_{index}" for index in range(1, len(dimensions) + 1)],
            "current_value",
            "comparison_value",
            "delta_value",
        ]
        section["generation_requirements"] = [
            "current_valueとcomparison_valueはexecution_promptに明示された条件で"
            f"同じ指標「{measure}」を比較する",
            "delta_valueはcurrent_value - comparison_valueと一致させる",
        ]
    elif chart == "sparkline_table":
        section["shape"] = {
            "rows": "区分と日付の組み合わせごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["category", "event_date", "metric_value"]
    elif chart in {"sankey", "sankey_vertical"}:
        display_dimensions = dimensions
        if len({"".join(value.lower().split()) for value in dimensions}) == 1:
            display_dimensions = [f"遷移元{dimensions[0]}", f"遷移先{dimensions[1]}"]
        section["shape"] = {
            "rows": "隣接する段階間の遷移ごとに1行",
            "columns": display_dimensions + measures,
        }
        section["source_columns"] = ["source", "target", "metric_value"]
        section["max_navigation_pages"] = MAX_SANKEY_PAGES
        section["max_navigation_paths"] = MAX_SANKEY_PATHS
        section["generation_requirements"] = [
            "最終列のASCII別名はsource、target、metric_valueにする",
            f"sourceとtargetには1.〜{MAX_SANKEY_PAGES}.のページ段階が"
            "判別できる"
            "番号接頭辞を付ける",
            "指定した最終ページへ到達した完全な経路を集計し、全ページ列を"
            f"安定した順序条件へ含めてmetric_valueの上位{MAX_SANKEY_PATHS}経路を"
            "先に選ぶ",
            "上位経路を選んだ後で、各経路をsourceとtargetの隣接edgeへ"
            "変換する",
            f"回遊は最初の{MAX_SANKEY_PAGES}ページまでとし、"
            f"{MAX_SANKEY_PAGES}ページ目より後のnodeやedgeは返さない",
            f"3〜{MAX_SANKEY_PAGES}ページの回遊もsourceとtargetの隣接edgeとして"
            "縦持ちで返す",
            "同一sourceとtargetの組はSUMして1行に集約する",
            "URLをnode名に使う場合はscheme、host、query、fragmentを除いた"
            "page pathを表示名にする",
        ]
    elif chart in {"flow_sankey", "flow_sankey_vertical"}:
        section["shape"] = {
            "rows": "有向flowの接続ごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["source", "target", "metric_value"]
        section["generation_requirements"] = [
            "sourceとtargetは空でない項目名にし、同じ項目を指定しない",
            "同一sourceとtargetの組はSUMして1行に集約する",
            "循環するflowを返さない",
        ]
    elif chart == "annotated_line":
        section["shape"] = {
            "rows": "日付ごとに1行。注釈がない日はannotation_labelをNULLにする",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["event_date", "annotation_label", "metric_value"]
    elif chart == "delta":
        measure = measures[0]
        section["shape"] = {
            "rows": "比較対象を含む1行",
            "columns": [f"{measure}（現在値）", f"{measure}（比較値）"],
        }
        section["source_columns"] = ["current_value", "comparison_value"]
        section["generation_requirements"] = [
            f"current_valueとcomparison_valueは同じ指標「{measure}」を比較する",
            "現在値と比較値の対象条件をexecution_promptに明記する",
        ]
    elif chart in {"box_plot", "box_plot_horizontal"}:
        measure = measures[0]
        section["shape"] = {
            "rows": "区分ごとに1行",
            "columns": [
                *dimensions,
                f"{measure}（最小）",
                f"{measure}（第1四分位）",
                f"{measure}（中央値）",
                f"{measure}（第3四分位）",
                f"{measure}（最大）",
            ],
        }
        section["source_columns"] = [
            "category", "min_value", "q1_value", "median_value", "q3_value", "max_value"
        ]
        section["generation_requirements"] = [
            f"最小、第1四分位、中央値、第3四分位、最大は同じ指標「{measure}」から計算する",
            "5つの統計値は昇順で返す",
        ]
    elif chart == "treemap":
        section["shape"] = {
            "rows": "階層の末端項目ごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = [
            *[f"level_{index}" for index in range(1, len(dimensions) + 1)],
            "metric_value",
        ]
    elif chart in {"area_map", "us_map"}:
        section["shape"] = {
            "rows": "地域ごとに1行。地理境界はGeoJSON PolygonまたはMultiPolygon",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["region_id", "geometry_geojson", "metric_value"]
    elif chart == "point_map":
        measure = measures[0]
        section["shape"] = {
            "rows": "地点ごとに1行",
            "columns": [*dimensions, "緯度", "経度", f"{measure}（値）"],
        }
        section["source_columns"] = [
            "point_name",
            "map_geojson",
            "latitude",
            "longitude",
            "metric_value",
        ]
        section["generation_requirements"] = [
            "latitudeとlongitudeは地点の位置列であり、measuresへ追加しない",
            f"metric_valueは指標「{measure}」の値にする",
        ]
    elif chart == "bubble_map":
        size_measure, metric_measure = measures
        section["shape"] = {
            "rows": "地点ごとに1行",
            "columns": [
                *dimensions,
                "緯度",
                "経度",
                f"{size_measure}（size）",
                f"{metric_measure}（値）",
            ],
        }
        section["source_columns"] = [
            "point_name",
            "map_geojson",
            "latitude",
            "longitude",
            "size_value",
            "metric_value",
        ]
        section["generation_requirements"] = [
            "latitudeとlongitudeは地点の位置列であり、measuresへ追加しない",
            f"size_valueは指標「{size_measure}」の非負値にする",
            f"metric_valueは指標「{metric_measure}」の非負値にする",
        ]
    elif chart == "base_map":
        size_measure, metric_measure = measures
        section["shape"] = {
            "rows": "地理layerの項目ごとに1行",
            "columns": [
                *dimensions,
                "緯度",
                "経度",
                f"{size_measure}（size）",
                f"{metric_measure}（値）",
            ],
        }
        section["source_columns"] = [
            "layer_kind",
            "item_name",
            "geometry_geojson",
            "latitude",
            "longitude",
            "size_value",
            "metric_value",
        ]
        section["generation_requirements"] = [
            "latitudeとlongitudeは地点layerの位置列であり、measuresへ追加しない",
            f"size_valueは指標「{size_measure}」の非負値にし、area／pointではNULLを許容する",
            f"metric_valueは指標「{metric_measure}」の非負値にする",
        ]
    elif chart == "reference_line":
        measure = measures[0]
        section["shape"] = {
            "rows": "区分ごとに1行",
            "columns": [*dimensions, f"{measure}（実績）", f"{measure}（基準値）"],
        }
        section["source_columns"] = ["category", "metric_value", "reference_value"]
        section["generation_requirements"] = [
            f"metric_valueは指標「{measure}」の実績値にする",
            "reference_valueはexecution_promptで明示した基準値にする",
        ]
    elif chart == "reference_area":
        measure = measures[0]
        section["shape"] = {
            "rows": "区分ごとに1行",
            "columns": [
                *dimensions,
                f"{measure}（実績）",
                f"{measure}（下限）",
                f"{measure}（上限）",
            ],
        }
        section["source_columns"] = ["category", "metric_value", "lower_value", "upper_value"]
        section["generation_requirements"] = [
            f"metric_valueは指標「{measure}」の実績値にする",
            "lower_valueとupper_valueはexecution_promptで明示した基準範囲にする",
            "lower_valueはupper_value以下にする",
        ]
    _append_generation_requirements(section)
    return section


def _append_generation_requirements(section: dict) -> None:
    """Apply shared SQL constraints after chart-specific output columns are known."""
    chart = section["planned_visualization"]
    if chart not in {
        "line",
        "multi_line",
        "area",
        "stacked_area",
        "percent_stacked_area",
        "annotated_line",
        "sparkline",
        "mixed_bar_line",
        "base_map",
        "table",
        "pivot_table",
        "sparkline_table",
    }:
        nonnull_metric_columns = section["source_columns"][section["dimension_count"] :]
        section["nonnull_metric_columns"] = nonnull_metric_columns
        aliases = "、".join(nonnull_metric_columns)
        section.setdefault("generation_requirements", []).append(
            f"{aliases}はNULLを返さない。COUNT/COUNTIF以外の式は最終SELECT式全体を"
            "COALESCEまたはIFNULLで包む"
        )
    if chart not in {"scorecard", "kpi_group", "delta"}:
        max_rows = section["max_result_rows"]
        if chart in {
            "line", "multi_line", "area", "stacked_area", "percent_stacked_area",
            "calendar_heatmap", "annotated_line", "sparkline",
        }:
            ordering = "event_dateの昇順"
        elif chart == "histogram":
            ordering = "bin_startの昇順"
        elif chart in {"sankey", "sankey_vertical", "flow_sankey", "flow_sankey_vertical"}:
            ordering = "metric_valueの降順"
        elif chart in {"funnel", "funnel_horizontal"}:
            ordering = "stageの昇順"
        elif chart in {"reference_line", "reference_area"}:
            ordering = "categoryの昇順"
        else:
            ordering = f"{section['source_columns'][-1]}の降順"
        section.setdefault("generation_requirements", []).append(
            f"最終SELECTは{ordering}でORDER BYし、LIMIT {max_rows}を明示する"
        )

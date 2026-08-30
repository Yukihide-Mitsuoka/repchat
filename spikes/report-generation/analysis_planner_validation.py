"""Shared validation primitives for analysis planning outputs."""

from __future__ import annotations

from analysis_planner_contracts import PlannerError
from visualization_contracts import CHART_SHAPE_CONTRACTS


def text(value, label: str) -> str:
    """Require one non-empty analysis-plan text value."""
    normalized = str(value or "").strip()
    if not normalized:
        raise PlannerError(f"分析計画の{label}が空です。")
    return normalized


def plan_panel_text(value, label: str, limit: int = 300) -> str:
    """Normalize and bound one analysis-plan panel text value."""
    normalized = " ".join(text(value, label).split())
    if len(normalized) > limit:
        raise PlannerError(f"分析計画の{label}が長すぎます。")
    return normalized


def panel_terms(
    value, label: str, *, minimum: int = 0, allow_role_duplicates: bool = False
) -> list[str]:
    """Validate one bounded analysis-plan dimension or measure list."""
    if not isinstance(value, list) or not minimum <= len(value) <= 4:
        raise PlannerError(f"分析計画の{label}は{minimum}〜4件にしてください。")
    terms = [plan_panel_text(item, label, 80) for item in value]
    if (
        not allow_role_duplicates
        and len({"".join(item.lower().split()) for item in terms}) != len(terms)
    ):
        raise PlannerError(f"分析計画の{label}に重複があります。")
    return terms


def flatten_visualization(item: dict) -> dict:
    """Flatten the provider-only chart/shape union into the stored panel contract."""
    visualization = item.get("visualization")
    if visualization is None:
        return item
    if not isinstance(visualization, dict):
        raise PlannerError("分析仕様のvisualizationがobjectではありません。")
    if any(field in item for field in ("chart", "dimensions", "measures")):
        raise PlannerError("分析仕様の可視化指定が重複しています。")
    return {
        **item,
        "chart": visualization.get("chart"),
        "dimensions": visualization.get("dimensions"),
        "measures": visualization.get("measures"),
    }


def validate_chart_shape(
    chart: str, dimensions: list[str], measures: list[str]
) -> None:
    """Validate semantic fields against one renderer capability contract."""
    min_dimensions, max_dimensions, min_measures, max_measures = CHART_SHAPE_CONTRACTS[
        chart
    ]
    if not (
        min_dimensions <= len(dimensions) <= max_dimensions
        and min_measures <= len(measures) <= max_measures
    ):
        if chart == "scorecard":
            raise PlannerError("scorecardは区分軸なし・指標1件にしてください。")
        expected_dimensions = (
            f"{min_dimensions}件"
            if min_dimensions == max_dimensions
            else f"{min_dimensions}〜{max_dimensions}件"
        )
        expected_measures = (
            f"{min_measures}件"
            if min_measures == max_measures
            else f"{min_measures}〜{max_measures}件"
        )
        raise PlannerError(
            f"AIが生成した{chart}仕様を描画できません。"
            f"必要なのは区分軸{expected_dimensions}・指標{expected_measures}ですが、"
            f"AI出力は区分軸{len(dimensions)}件・指標{len(measures)}件でした。"
        )


def bounded_consultation_text(value, label: str, limit: int = 500) -> str:
    """Normalize and bound one consultation text value."""
    normalized = " ".join(str(value or "").split())
    if not normalized:
        raise PlannerError(f"分析相談の{label}が空です。")
    if len(normalized) > limit:
        raise PlannerError(f"分析相談の{label}が長すぎます。")
    return normalized


def consultation_terms(
    value, label: str, *, minimum: int = 0, allow_role_duplicates: bool = False
) -> list[str]:
    """Validate one bounded consultation dimension or measure list."""
    if not isinstance(value, list) or not minimum <= len(value) <= 4:
        raise PlannerError(f"分析相談の{label}は{minimum}〜4件にしてください。")
    terms = [bounded_consultation_text(item, label, 80) for item in value]
    if (
        not allow_role_duplicates
        and len({"".join(item.lower().split()) for item in terms}) != len(terms)
    ):
        raise PlannerError(f"分析相談の{label}に重複があります。")
    return terms

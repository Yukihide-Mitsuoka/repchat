"""Normalize and validate AI-authored dashboard plans."""

from __future__ import annotations

import json
import re

from analysis_planner_contracts import PlannerError, planner_panel_counts
from analysis_planner_validation import (
    flatten_visualization as _flatten_visualization,
    normalize_plan_header as _normalize_plan_header_impl,
    panel_terms as _panel_terms,
    plan_panel_text as _plan_panel_text,
    revisioned_plan as _revisioned_plan,
    validate_chart_shape as _validate_chart_shape,
)
from visualization_contracts import (
    DASHBOARD_ROW_LIMITS,
    SANKEY_CHARTS,
    STAGED_SANKEY_CHARTS,
    SUPPORTED_DASHBOARD_CHARTS,
)

CLARIFICATION_FIELDS = ("audience", "comparison", "business_goal")
DASHBOARD_CHARTS = SUPPORTED_DASHBOARD_CHARTS
DYNAMIC_PANEL_TEXT_FIELDS = (
    "title", "kpi", "chart", "decision", "reason", "execution_prompt"
)
DYNAMIC_PANEL_LIST_FIELDS = ("dimensions", "measures")
DYNAMIC_PANEL_LAYOUT_FIELDS = ("layout_row", "layout_weight")
DYNAMIC_PANEL_FIELDS = (
    DYNAMIC_PANEL_TEXT_FIELDS
    + DYNAMIC_PANEL_LIST_FIELDS
    + DYNAMIC_PANEL_LAYOUT_FIELDS
)
INITIAL_PANEL_COUNT, MAX_PANEL_COUNT = planner_panel_counts()


def _normalize_plan_header(
    raw: dict,
    objective: str,
    period: dict[str, str],
    answers: dict[str, str] | None,
) -> dict:
    return _normalize_plan_header_impl(
        raw, objective, period, answers, CLARIFICATION_FIELDS
    )


def normalize_dashboard_plan(
    raw: dict,
    objective: str,
    period: dict[str, str],
    answers: dict[str, str] | None = None,
    *,
    allow_layout_gaps: bool = False,
    allowed_metrics: tuple[str, ...] = (),
) -> dict:
    """Validate model output and produce a deterministic proposed revision."""
    plan = _normalize_plan_header(raw, objective, period, answers)
    raw_panels = raw.get("panels", [])
    if not isinstance(raw_panels, list) or not 1 <= len(raw_panels) <= MAX_PANEL_COUNT:
        raise PlannerError(f"分析計画のパネルは1〜{MAX_PANEL_COUNT}件にしてください。")
    panels, seen_prompts = [], set()
    for index, item in enumerate(raw_panels, start=1):
        if not isinstance(item, dict):
            raise PlannerError("分析計画のパネルがobjectではありません。")
        item = _flatten_visualization(item)
        panel = {
            field: _plan_panel_text(
                item.get(field),
                "パネル選択理由" if field == "reason" else field,
                80 if field in {"title", "kpi", "chart"} else 300,
            )
            for field in DYNAMIC_PANEL_TEXT_FIELDS
        }
        if panel["chart"] not in DASHBOARD_CHARTS:
            raise PlannerError("分析計画の可視化種別が未対応です。")
        panel["dimensions"] = _panel_terms(
            item.get("dimensions"),
            "区分軸",
            allow_role_duplicates=panel["chart"] in SANKEY_CHARTS,
        )
        panel["measures"] = _panel_terms(item.get("measures"), "指標", minimum=1)
        undefined_metrics = [
            measure
            for measure in panel["measures"]
            if allowed_metrics and measure not in allowed_metrics
        ]
        if undefined_metrics:
            raise PlannerError(
                "AIが指標定義にない指標を生成しました: "
                + "、".join(undefined_metrics)
                + "。現在案は保持し、自動再実行していません。",
                suggested_instruction="指標は定義済みの「"
                + "」「".join(allowed_metrics)
                + "」だけを使って再提案して",
            )
        layout_row = item.get("layout_row")
        layout_weight = item.get("layout_weight")
        if (
            isinstance(layout_row, bool)
            or not isinstance(layout_row, int)
            or layout_row < 1
        ):
            raise PlannerError("分析計画のlayout_rowは1以上の整数にしてください。")
        if (
            isinstance(layout_weight, bool)
            or not isinstance(layout_weight, int)
            or not 1 <= layout_weight <= 100
        ):
            raise PlannerError("分析計画のlayout_weightは1〜100の整数にしてください。")
        panel["layout_row"] = layout_row
        panel["layout_weight"] = layout_weight
        dimensions, measures = panel["dimensions"], panel["measures"]
        try:
            _validate_chart_shape(panel["chart"], dimensions, measures)
        except PlannerError as error:
            suggestion = panel["execution_prompt"].rstrip("。")
            if panel["chart"] in STAGED_SANKEY_CHARTS and measures:
                if not re.search(r"(?:上位|トップ)\s*\d+", suggestion):
                    suggestion += "。経路は上位10件に絞って"
                suggestion += (
                    f"。3ページ分は遷移元・遷移先の隣接edgeとして表し、"
                    f"区分軸2件と{measures[0]}1指標で返して"
                )
            raise PlannerError(
                f"{error} 現在案は保持しています。",
                suggested_instruction=suggestion,
            ) from error
        prompt = panel["execution_prompt"]
        if re.search(
            r"(?:```|`|\b(?:SELECT|WITH|FROM|GROUP\s+BY)\b)",
            prompt,
            flags=re.IGNORECASE,
        ):
            raise PlannerError("分析計画の実行仕様にはSQLを書けません。")
        prompt_key = "".join(prompt.lower().split())
        if prompt_key in seen_prompts:
            raise PlannerError("分析計画に重複した実行仕様があります。")
        seen_prompts.add(prompt_key)
        panel["max_result_rows"] = DASHBOARD_ROW_LIMITS[panel["chart"]]
        panels.append({"id": f"P{index}", **panel})
    layout_rows = [panel["layout_row"] for panel in panels]
    expected_rows = list(range(1, max(layout_rows) + 1))
    if layout_rows != sorted(layout_rows) or (
        not allow_layout_gaps and sorted(set(layout_rows)) != expected_rows
    ):
        raise PlannerError(
            "分析計画のlayout_rowは1から始まる連続値をパネル順に指定してください。"
        )
    if any(layout_rows.count(row) > 4 for row in expected_rows):
        raise PlannerError("分析計画の1行あたりのパネルは最大4件にしてください。")
    plan["panels"] = panels
    return _revisioned_plan(plan)


def confirm_dashboard_plan(plan: dict) -> dict:
    """Revalidate an edited AI-authored proposal and freeze its full specification."""
    answers = plan.get("answers", {})
    if not isinstance(answers, dict):
        raise PlannerError("確認事項の回答がobjectではありません。")
    clarifications = plan.get("clarifications", [])
    if not isinstance(clarifications, list):
        raise PlannerError("確認事項が配列ではありません。")
    for item in clarifications:
        field = item.get("field") if isinstance(item, dict) else None
        if field not in CLARIFICATION_FIELDS:
            diagnostic = json.dumps(field, ensure_ascii=False)
            raise PlannerError(f"確認事項のfieldが許可範囲外です: {diagnostic}")
        answer = answers.get(field)
        if not isinstance(answer, str) or not answer.strip():
            raise PlannerError(f"確認事項{field}の回答が空です。")
    raw = {
        key: plan.get(key)
        for key in ("objective_summary", "audience", "comparison", "hypotheses")
    }
    raw["clarifications"] = []
    raw["panels"] = [
        {field: item.get(field) for field in DYNAMIC_PANEL_FIELDS}
        for item in plan.get("panels", [])
    ]
    confirmed = normalize_dashboard_plan(
        raw,
        plan.get("objective", ""),
        plan.get("period", {}),
        answers,
        allow_layout_gaps=True,
    )
    if confirmed["clarifications"]:
        raise PlannerError("未回答の確認事項があります。")
    confirmed["status"] = "confirmed"
    return _revisioned_plan(confirmed)

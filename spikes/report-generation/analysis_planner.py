"""Structured, reviewable analysis planning for the local dashboard demo."""

from __future__ import annotations

import hashlib
import json
import os
import re
from analysis_planner_contracts import (
    PlannerError,
    build_clarification_response_schema,
    build_consultation_schema,
    build_dashboard_response_schema,
    build_plan_schemas,
    neutral_chart_order as _neutral_chart_order,
    visualization_response_schema as _visualization_response_schema,
)
from analysis_planner_prompts import (
    build_consultation_request,
    build_dashboard_planning_request,
)
from analysis_planner_validation import (
    bounded_consultation_text as _bounded_consultation_text,
    consultation_terms as _consultation_terms,
    flatten_visualization as _flatten_visualization,
    normalize_plan_header as _normalize_plan_header_impl,
    panel_terms as _panel_terms,
    plan_panel_text as _plan_panel_text,
    revisioned_plan as _revisioned_plan,
    text as _text,
    validate_chart_shape as _validate_chart_shape,
)
from structured_response import (
    StructuredResponseError,
    load_structured_json as _load_structured_json,
)
from visualization_contracts import (
    CHART_SHAPE_CONTRACTS,
    DASHBOARD_ROW_LIMITS,
    MAX_CALENDAR_ROWS,
    MAX_CALENDAR_YEARS,
    MAX_FLOW_SANKEY_EDGES,
    MAX_SANKEY_EDGE_ROWS,
    MAX_SANKEY_PAGES,
    MAX_SANKEY_PATHS,
    SUPPORTED_DASHBOARD_CHARTS,
)

CLARIFICATION_FIELDS = ("audience", "comparison", "business_goal")
DASHBOARD_CHARTS = SUPPORTED_DASHBOARD_CHARTS
STAGED_SANKEY_CHARTS = frozenset({"sankey", "sankey_vertical"})
SANKEY_CHARTS = STAGED_SANKEY_CHARTS | {"flow_sankey", "flow_sankey_vertical"}
# Initial dashboard output is exactly INITIAL_PANEL_COUNT panels; revisions are
# locally validated at 1..MAX_PANEL_COUNT. Consultation is provider- and
# locally-bounded at 1..4 recommendations. Token budgets cover those different
# cardinalities without leaving either paid response unbounded.
DASHBOARD_MAX_OUTPUT_TOKENS = 32768
CONSULTATION_MAX_OUTPUT_TOKENS = 8192
DEFAULT_INITIAL_PANEL_COUNT = 6
DEFAULT_MAX_PANEL_COUNT = 20
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


def _positive_count_setting(name: str, default: int) -> int:
    """Read one admin-owned positive count without selecting analysis content."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


MAX_PANEL_COUNT = _positive_count_setting(
    "ANALYSIS_MAX_PANEL_COUNT", DEFAULT_MAX_PANEL_COUNT
)
INITIAL_PANEL_COUNT = _positive_count_setting(
    "ANALYSIS_INITIAL_PANEL_COUNT", min(DEFAULT_INITIAL_PANEL_COUNT, MAX_PANEL_COUNT)
)
if INITIAL_PANEL_COUNT > MAX_PANEL_COUNT:
    raise ValueError(
        "ANALYSIS_INITIAL_PANEL_COUNT must not exceed ANALYSIS_MAX_PANEL_COUNT"
    )


def _defined_metric_names(metrics: str) -> tuple[str, ...]:
    """Extract only customer-defined metric names from the rendered definition block."""
    return tuple(dict.fromkeys(re.findall(r'^- 指標「([^」]+)」', metrics, re.MULTILINE)))


PLAN_SCHEMA, DYNAMIC_PLAN_SCHEMA = build_plan_schemas(
    INITIAL_PANEL_COUNT, _visualization_response_schema(DASHBOARD_CHARTS)
)


def _load_planner_response(response, label: str):
    try:
        return _load_structured_json(response)
    except StructuredResponseError as error:
        suffix = "現在案は保持し、自動再実行していません。"
        if error.kind == "max_tokens":
            message = f"Vertex AIの{label}が出力上限までに完了しませんでした。{suffix}"
        elif error.kind == "finish_reason":
            message = (
                f"Vertex AIが{label}の生成を完了できませんでした"
                f"（終了理由: {error.finish_reason}）。{suffix}"
            )
        elif error.kind == "missing_text":
            message = f"Vertex AIから{label}JSONを受け取れませんでした。{suffix}"
        else:
            message = f"Vertex AIの{label}JSONを解釈できませんでした。{suffix}"
        raise PlannerError(message) from error


def _response_schema(answers: dict[str, str]) -> dict:
    """Constrain clarification output to fields that still need an answer."""
    return build_clarification_response_schema(
        PLAN_SCHEMA, CLARIFICATION_FIELDS, answers
    )


def _dashboard_response_schema(
    answers: dict[str, str],
    *,
    revising: bool = False,
    seed: str = "",
    metric_names: tuple[str, ...] = (),
) -> dict:
    """Constrain an initial or revised AI-authored dashboard."""
    return build_dashboard_response_schema(
        PLAN_SCHEMA,
        DYNAMIC_PLAN_SCHEMA,
        CLARIFICATION_FIELDS,
        DASHBOARD_CHARTS,
        answers,
        revising=revising,
        seed=seed,
        metric_names=metric_names,
    )


def dashboard_planning_request(
    objective: str,
    period: dict[str, str],
    metrics: str,
    answers: dict[str, str],
    *,
    current_plan: dict | None = None,
    instruction: str | None = None,
) -> str:
    """Build an initial or iterative dashboard planning request."""
    return build_dashboard_planning_request(
        objective,
        period,
        metrics,
        answers,
        current_plan=current_plan,
        instruction=instruction,
        initial_panel_count=INITIAL_PANEL_COUNT,
        max_panel_count=MAX_PANEL_COUNT,
        dynamic_panel_fields=DYNAMIC_PANEL_FIELDS,
        max_sankey_paths=MAX_SANKEY_PATHS,
        max_sankey_pages=MAX_SANKEY_PAGES,
    )


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


def propose_dashboard(
    client,
    model: str,
    objective: str,
    period: dict,
    metrics: str,
    answers: dict,
    *,
    current_plan: dict | None = None,
    instruction: str | None = None,
):
    """Ask Vertex AI to author bounded dashboard panel specifications."""
    from google.genai import types
    from vertex_usage import token_counts

    metric_names = _defined_metric_names(metrics)
    response = client.models.generate_content(
        model=model,
        contents=dashboard_planning_request(
            objective,
            period,
            metrics,
            answers,
            current_plan=current_plan,
            instruction=instruction,
        ),
        config=types.GenerateContentConfig(
            system_instruction="あなたは意思決定から分析仕様を設計する日本語BIプランナー。",
            response_mime_type="application/json",
            max_output_tokens=DASHBOARD_MAX_OUTPUT_TOKENS,
            response_schema=_dashboard_response_schema(
                answers,
                revising=current_plan is not None,
                seed=f"{objective}\n{instruction or ''}",
                metric_names=metric_names,
            ),
        ),
    )
    raw = _load_planner_response(response, "分析計画")
    return normalize_dashboard_plan(
        raw, objective, period, answers, allowed_metrics=metric_names
    ), token_counts(response.usage_metadata)


CONSULTATION_CHARTS = SUPPORTED_DASHBOARD_CHARTS
CONSULTATION_TEXT_FIELDS = (
    "title",
    "objective",
    "comparison",
    "chart",
    "execution_prompt",
    "reason",
)
CONSULTATION_LIST_FIELDS = ("dimensions", "measures")
CONSULTATION_FIELDS = CONSULTATION_TEXT_FIELDS + CONSULTATION_LIST_FIELDS


def _consultation_schema(seed: str = "") -> dict:
    return build_consultation_schema(
        CONSULTATION_TEXT_FIELDS, CONSULTATION_CHARTS, seed=seed
    )


def consultation_request(
    question: str,
    history: list[dict[str, str]],
    context: str,
    profile: str,
) -> str:
    """Build one bounded, history-aware consultation turn."""
    return build_consultation_request(question, history, context, profile)


def confirm_analysis_specification(raw: dict) -> dict:
    """Validate and revision one AI-authored single-insight specification."""
    if not isinstance(raw, dict):
        raise PlannerError("分析相談の候補がobjectではありません。")
    raw = _flatten_visualization(raw)
    recommendation = {
        field: _bounded_consultation_text(
            raw.get(field),
            "候補理由" if field == "reason" else field,
            80 if field in {"title", "comparison", "chart"} else 500,
        )
        for field in CONSULTATION_TEXT_FIELDS
    }
    chart = recommendation["chart"]
    if chart not in CONSULTATION_CHARTS:
        raise PlannerError("分析相談の可視化種別が未対応です。")
    recommendation["dimensions"] = _consultation_terms(
        raw.get("dimensions"),
        "区分軸",
        allow_role_duplicates=chart in SANKEY_CHARTS,
    )
    recommendation["measures"] = _consultation_terms(
        raw.get("measures"), "指標", minimum=1
    )
    dimensions = recommendation["dimensions"]
    measures = recommendation["measures"]
    _validate_chart_shape(chart, dimensions, measures)
    execution_prompt = recommendation["execution_prompt"]
    if re.search(
        r"(?:```|`|\b(?:SELECT|WITH|FROM|GROUP\s+BY)\b)",
        execution_prompt,
        flags=re.IGNORECASE,
    ):
        raise PlannerError("分析相談の実行依頼にはSQLを書けません。")
    canonical = json.dumps(
        recommendation, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    recommendation["revision"] = (
        "insight-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    )
    return recommendation


def normalize_consultation(raw: dict) -> dict:
    """Validate newly reasoned analysis specifications before SQL generation."""
    if not isinstance(raw, dict):
        raise PlannerError("分析相談がJSON objectではありません。")
    recommendations = []
    seen: set[str] = set()
    raw_recommendations = raw.get("recommendations")
    if not isinstance(raw_recommendations, list) or not 1 <= len(raw_recommendations) <= 4:
        raise PlannerError("分析相談の候補は1〜4件にしてください。")
    for item in raw_recommendations:
        if not isinstance(item, dict):
            raise PlannerError("分析相談の候補がobjectではありません。")
        recommendation = confirm_analysis_specification(item)
        execution_prompt = recommendation["execution_prompt"]
        duplicate_key = "".join(execution_prompt.lower().split())
        if duplicate_key in seen:
            raise PlannerError("分析相談に重複した候補があります。")
        seen.add(duplicate_key)
        recommendations.append(recommendation)
    assistant_message = _bounded_consultation_text(raw.get("assistant_message"), "応答")
    follow_up_question = _bounded_consultation_text(
        raw.get("follow_up_question"), "確認質問"
    )
    titles = "、".join(item["title"] for item in recommendations)
    history_message = (
        f"{assistant_message}\n提案: {titles}\n確認: {follow_up_question}"
    )
    return {
        "assistant_message": assistant_message,
        "recommendations": recommendations,
        "follow_up_question": follow_up_question,
        "history_message": history_message,
    }


def propose_consultation(
    client,
    model: str,
    question: str,
    history: list[dict[str, str]],
    context: str,
    profile: str,
):
    """Ask Vertex AI to reason about new analyses without generating SQL."""
    from google.genai import types
    from vertex_usage import token_counts

    response = client.models.generate_content(
        model=model,
        contents=consultation_request(question, history, context, profile),
        config=types.GenerateContentConfig(
            system_instruction=(
                "あなたは利用者の意思決定を明確にし、実行可能な分析だけを提案する"
                "日本語BIアナリスト。"
            ),
            response_mime_type="application/json",
            max_output_tokens=CONSULTATION_MAX_OUTPUT_TOKENS,
            response_schema=_consultation_schema(seed=f"{profile}\n{question}"),
        ),
    )
    return normalize_consultation(
        _load_planner_response(response, "分析相談")
    ), token_counts(response.usage_metadata)


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

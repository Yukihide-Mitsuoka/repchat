"""Structured, reviewable analysis planning for the local dashboard demo."""

from __future__ import annotations

import re

from analysis_dashboard_plan import (
    CLARIFICATION_FIELDS,
    DASHBOARD_CHARTS,
    DYNAMIC_PANEL_FIELDS,
    DYNAMIC_PANEL_LAYOUT_FIELDS,
    DYNAMIC_PANEL_LIST_FIELDS,
    DYNAMIC_PANEL_TEXT_FIELDS,
    INITIAL_PANEL_COUNT,
    MAX_PANEL_COUNT,
    _normalize_plan_header,
    confirm_dashboard_plan,
    normalize_dashboard_plan,
)
from analysis_consultation import (
    CONSULTATION_CHARTS,
    CONSULTATION_FIELDS,
    CONSULTATION_LIST_FIELDS,
    CONSULTATION_MAX_OUTPUT_TOKENS,
    CONSULTATION_TEXT_FIELDS,
    confirm_analysis_specification,
    consultation_request,
    consultation_schema as _consultation_schema,
    normalize_consultation,
    propose_consultation as _propose_consultation_impl,
)
from analysis_planner_contracts import (
    PlannerError,
    build_clarification_response_schema,
    build_dashboard_response_schema,
    build_plan_schemas,
    neutral_chart_order as _neutral_chart_order,
    visualization_response_schema as _visualization_response_schema,
)
from analysis_planner_prompts import (
    build_dashboard_planning_request,
)
from analysis_planner_validation import (
    revisioned_plan as _revisioned_plan,
)
from structured_response import (
    StructuredResponseError,
    load_structured_json as _load_structured_json,
)
from visualization_contracts import (
    CHART_RESULT_ROLE_CONTRACTS,
    CHART_SHAPE_CONTRACTS,
    CHART_SOURCE_SHAPE_CONTRACTS,
    DASHBOARD_ROW_LIMITS,
    MAX_CALENDAR_ROWS,
    MAX_CALENDAR_YEARS,
    MAX_FLOW_SANKEY_EDGES,
    MAX_SANKEY_EDGE_ROWS,
    MAX_SANKEY_PAGES,
    MAX_SANKEY_PATHS,
    SANKEY_CHARTS,
    STAGED_SANKEY_CHARTS,
    SUPPORTED_DASHBOARD_CHARTS,
)
from vertex_generation import generate_content

DASHBOARD_MAX_OUTPUT_TOKENS = 32768


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
    period: dict[str, str] | None,
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
        has_governed_metrics=bool(_defined_metric_names(metrics)),
    )


def propose_dashboard(
    client,
    model: str,
    objective: str,
    period: dict | None,
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
    response = generate_content(
        client,
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
        raw,
        objective,
        period,
        answers,
        allowed_metrics=metric_names,
    ), token_counts(response.usage_metadata)


def propose_consultation(
    client,
    model: str,
    question: str,
    history: list[dict[str, str]],
    context: str,
):
    """Keep the established planner API while delegating consultation work."""
    return _propose_consultation_impl(
        client,
        model,
        question,
        history,
        context,
        load_response=_load_planner_response,
    )

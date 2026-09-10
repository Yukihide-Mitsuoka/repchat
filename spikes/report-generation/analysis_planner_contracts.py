"""Structured-output schema contracts for analysis planning."""

from __future__ import annotations

import copy
import hashlib
import os

from visualization_contracts import CHART_SHAPE_CONTRACTS


class PlannerError(ValueError):
    """A planner contract violation safe to show in the local UI."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


# Initial dashboard output is exactly INITIAL_PANEL_COUNT panels; revisions are
# locally validated at 1..MAX_PANEL_COUNT. Consultation is provider- and
# locally-bounded at 1..4 recommendations. Token budgets cover those different
# cardinalities without leaving either paid response unbounded.
DEFAULT_INITIAL_PANEL_COUNT = 6
DEFAULT_MAX_PANEL_COUNT = 20


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


def planner_panel_counts() -> tuple[int, int]:
    """Return the configured initial and maximum dashboard panel counts."""
    maximum = _positive_count_setting(
        "ANALYSIS_MAX_PANEL_COUNT", DEFAULT_MAX_PANEL_COUNT
    )
    initial = _positive_count_setting(
        "ANALYSIS_INITIAL_PANEL_COUNT",
        min(DEFAULT_INITIAL_PANEL_COUNT, maximum),
    )
    if initial > maximum:
        raise ValueError(
            "ANALYSIS_INITIAL_PANEL_COUNT must not exceed ANALYSIS_MAX_PANEL_COUNT"
        )
    return initial, maximum


def neutral_chart_order(charts: tuple[str, ...], seed: str) -> tuple[str, ...]:
    """Return a reproducible order unrelated to chart semantics or source order."""
    if not seed:
        return charts
    return tuple(
        sorted(
            charts,
            key=lambda chart: hashlib.sha256(f"{seed}\0{chart}".encode()).digest(),
        )
    )


def visualization_response_schema(
    charts: tuple[str, ...], *, seed: str = ""
) -> dict:
    """Expose every renderer while avoiding combinatorial provider schemas."""
    ordered = neutral_chart_order(charts, seed)
    contracts = [CHART_SHAPE_CONTRACTS[chart] for chart in ordered]

    def count_range(minimum: int, maximum: int) -> str:
        return str(minimum) if minimum == maximum else f"{minimum}〜{maximum}"

    guidance = "; ".join(
        f"{chart}=dimensions {count_range(contract[0], contract[1])}、"
        f"measures {count_range(contract[2], contract[3])}"
        for chart, contract in zip(ordered, contracts, strict=True)
    )
    return {
        "type": "object",
        "description": "chart別の必要件数: " + guidance,
        "properties": {
            "chart": {
                "type": "string",
                "format": "enum",
                "enum": list(ordered),
            },
            "dimensions": {
                "type": "array",
                "minItems": min(contract[0] for contract in contracts),
                "maxItems": max(contract[1] for contract in contracts),
                "items": {"type": "string"},
            },
            "measures": {
                "type": "array",
                "minItems": min(contract[2] for contract in contracts),
                "maxItems": max(contract[3] for contract in contracts),
                "items": {"type": "string"},
            },
        },
        "required": ["chart", "dimensions", "measures"],
    }


def build_plan_schemas(
    initial_panel_count: int, visualization_schema: dict
) -> tuple[dict, dict]:
    """Build the base and initial dashboard plan response schemas."""
    plan_schema = {
        "type": "object",
        "properties": {
            "objective_summary": {"type": "string"},
            "audience": {"type": "string"},
            "comparison": {"type": "string"},
            "hypotheses": {"type": "array", "items": {"type": "string"}},
            "clarifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "question": {"type": "string"},
                        "recommended_answer": {"type": "string"},
                    },
                    "required": ["field", "question", "recommended_answer"],
                },
            },
            "panels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["id", "reason"],
                },
            },
        },
        "required": [
            "objective_summary",
            "audience",
            "comparison",
            "hypotheses",
            "clarifications",
            "panels",
        ],
    }

    dynamic_plan_schema = copy.deepcopy(plan_schema)
    dynamic_plan_schema["properties"]["panels"] = {
        "type": "array",
        "minItems": initial_panel_count,
        "maxItems": initial_panel_count,
        "items": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "kpi": {"type": "string"},
                "decision": {"type": "string"},
                "reason": {"type": "string"},
                "execution_prompt": {"type": "string"},
                "visualization": visualization_schema,
                "layout_row": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "表示行番号。1から始めてパネル順に連続させ、同じ行は同じ値にする。1行は最大4件。",
                },
                "layout_weight": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "description": "同じ表示行にあるパネル間の相対幅。",
                },
            },
            "required": [
                "title",
                "kpi",
                "decision",
                "reason",
                "execution_prompt",
                "visualization",
                "layout_row",
                "layout_weight",
            ],
        },
    }
    return plan_schema, dynamic_plan_schema


def build_clarification_response_schema(
    plan_schema: dict,
    clarification_fields: tuple[str, ...],
    answers: dict[str, str],
) -> dict:
    """Constrain clarification output to fields that still need an answer."""
    unanswered = [field for field in clarification_fields if field not in answers]
    schema = copy.deepcopy(plan_schema)
    clarifications = schema["properties"]["clarifications"]
    # Vertex structured output can reject an array schema whose maxItems is 0.
    # When every field is answered, omit that API-level bound and let the
    # normalizer below reject any repeated or unsupported clarification.
    if unanswered:
        clarifications["maxItems"] = len(unanswered)
    if len(unanswered) == len(clarification_fields):
        clarifications["minItems"] = 1
    if unanswered:
        field_schema = clarifications["items"]["properties"]["field"]
        field_schema["format"] = "enum"
        field_schema["enum"] = unanswered
    return schema


def build_dashboard_response_schema(
    plan_schema: dict,
    dynamic_plan_schema: dict,
    clarification_fields: tuple[str, ...],
    dashboard_charts: tuple[str, ...],
    answers: dict[str, str],
    *,
    revising: bool = False,
    seed: str = "",
    metric_names: tuple[str, ...] = (),
) -> dict:
    """Constrain an initial or revised AI-authored dashboard."""
    schema = build_clarification_response_schema(
        plan_schema, clarification_fields, answers
    )
    schema["properties"]["panels"] = copy.deepcopy(
        dynamic_plan_schema["properties"]["panels"]
    )
    schema["properties"]["panels"]["items"]["properties"]["visualization"] = (
        visualization_response_schema(dashboard_charts, seed=seed)
    )
    if metric_names:
        schema["properties"]["panels"]["description"] = (
            "measuresは次の定義済み指標名だけを使う: "
            + "、".join(neutral_chart_order(metric_names, seed))
        )
    if revising:
        # Vertex can reject otherwise valid structured-output schemas as too
        # complex when a nested array has a long item-count limit. Revisions
        # can grow to the caller-owned maximum, so keep that policy in the
        # strict local normalizer instead of sending limits to the provider.
        schema["properties"]["panels"].pop("minItems", None)
        schema["properties"]["panels"].pop("maxItems", None)
    return schema


def build_consultation_schema(
    consultation_text_fields: tuple[str, ...],
    consultation_charts: tuple[str, ...],
    *,
    seed: str = "",
) -> dict:
    """Constrain one bounded set of consultation recommendations."""
    recommendation_properties = {
        field: {"type": "string"}
        for field in consultation_text_fields
        if field != "chart"
    }
    recommendation_properties["visualization"] = visualization_response_schema(
        consultation_charts, seed=seed
    )
    return {
        "type": "object",
        "properties": {
            "assistant_message": {"type": "string"},
            "recommendations": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": recommendation_properties,
                    "required": [
                        field
                        for field in consultation_text_fields
                        if field != "chart"
                    ]
                    + ["visualization"],
                },
            },
            "follow_up_question": {"type": "string"},
        },
        "required": [
            "assistant_message",
            "recommendations",
            "follow_up_question",
        ],
    }

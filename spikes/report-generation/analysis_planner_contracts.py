"""Structured-output schema contracts for analysis planning."""

from __future__ import annotations

import copy


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

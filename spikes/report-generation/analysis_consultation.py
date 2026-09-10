"""Single-insight consultation planning and validation."""

from __future__ import annotations

import hashlib
import json
import re

from analysis_planner_contracts import PlannerError, build_consultation_schema
from analysis_planner_prompts import build_consultation_request
from analysis_planner_validation import (
    bounded_consultation_text,
    consultation_terms,
    flatten_visualization,
    validate_chart_shape,
)
from visualization_contracts import SANKEY_CHARTS, SUPPORTED_DASHBOARD_CHARTS
from vertex_generation import generate_content

CONSULTATION_MAX_OUTPUT_TOKENS = 8192
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


def consultation_schema(seed: str = "") -> dict:
    """Build the structured response schema for one consultation turn."""
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
    raw = flatten_visualization(raw)
    recommendation = {
        field: bounded_consultation_text(
            raw.get(field),
            "候補理由" if field == "reason" else field,
            80 if field in {"title", "comparison", "chart"} else 500,
        )
        for field in CONSULTATION_TEXT_FIELDS
    }
    chart = recommendation["chart"]
    if chart not in CONSULTATION_CHARTS:
        raise PlannerError("分析相談の可視化種別が未対応です。")
    recommendation["dimensions"] = consultation_terms(
        raw.get("dimensions"),
        "区分軸",
        allow_role_duplicates=chart in SANKEY_CHARTS,
    )
    recommendation["measures"] = consultation_terms(
        raw.get("measures"), "指標", minimum=1
    )
    validate_chart_shape(
        chart, recommendation["dimensions"], recommendation["measures"]
    )
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
    assistant_message = bounded_consultation_text(raw.get("assistant_message"), "応答")
    follow_up_question = bounded_consultation_text(
        raw.get("follow_up_question"), "確認質問"
    )
    titles = "、".join(item["title"] for item in recommendations)
    return {
        "assistant_message": assistant_message,
        "recommendations": recommendations,
        "follow_up_question": follow_up_question,
        "history_message": (
            f"{assistant_message}\n提案: {titles}\n確認: {follow_up_question}"
        ),
    }


def propose_consultation(
    client,
    model: str,
    question: str,
    history: list[dict[str, str]],
    context: str,
    profile: str,
    *,
    load_response,
):
    """Ask Vertex AI to reason about new analyses without generating SQL."""
    from google.genai import types
    from vertex_usage import token_counts

    response = generate_content(
        client,
        model=model,
        contents=consultation_request(question, history, context, profile),
        config=types.GenerateContentConfig(
            system_instruction=(
                "あなたは利用者の意思決定を明確にし、実行可能な分析だけを提案する"
                "日本語BIアナリスト。"
            ),
            response_mime_type="application/json",
            max_output_tokens=CONSULTATION_MAX_OUTPUT_TOKENS,
            response_schema=consultation_schema(seed=f"{profile}\n{question}"),
        ),
    )
    return normalize_consultation(
        load_response(response, "分析相談")
    ), token_counts(response.usage_metadata)

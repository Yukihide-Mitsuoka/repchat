"""Structured, reviewable analysis planning for the local dashboard demo."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re

CLARIFICATION_FIELDS = ("audience", "comparison", "business_goal")
SUPPORTED_DASHBOARD_CHARTS = (
    "scorecard",
    "kpi_group",
    "bar",
    "grouped_bar",
    "stacked_bar",
    "line",
    "multi_line",
    "area",
    "stacked_area",
    "histogram",
    "donut",
    "calendar_heatmap",
    "scatter",
    "bubble",
    "funnel",
    "heatmap",
    "table",
    "sankey",
)
DASHBOARD_CHARTS = SUPPORTED_DASHBOARD_CHARTS
MAX_SANKEY_PAGES = 4
MAX_SANKEY_PATHS = 10
MAX_SANKEY_EDGE_ROWS = MAX_SANKEY_PATHS * (MAX_SANKEY_PAGES - 1)
DASHBOARD_ROW_LIMITS = {
    "scorecard": 1,
    "kpi_group": 1,
    "bar": 30,
    "grouped_bar": 20,
    "stacked_bar": 20,
    "line": 100,
    "multi_line": 100,
    "area": 100,
    "stacked_area": 100,
    "histogram": 30,
    "donut": 12,
    "calendar_heatmap": 366,
    "scatter": 100,
    "bubble": 100,
    "funnel": 12,
    "heatmap": 100,
    "table": 100,
    "sankey": MAX_SANKEY_EDGE_ROWS,
}
CHART_SHAPE_CONTRACTS = {
    "scorecard": (0, 0, 1, 1),
    "kpi_group": (0, 0, 2, 4),
    "bar": (1, 1, 1, 1),
    "grouped_bar": (1, 1, 2, 4),
    "stacked_bar": (1, 1, 2, 4),
    "line": (1, 1, 1, 1),
    "multi_line": (1, 1, 2, 4),
    "area": (1, 1, 1, 1),
    "stacked_area": (1, 1, 2, 4),
    "histogram": (1, 1, 1, 1),
    "donut": (1, 1, 1, 1),
    "calendar_heatmap": (1, 1, 1, 1),
    "scatter": (1, 1, 2, 2),
    "bubble": (1, 1, 3, 3),
    "funnel": (1, 1, 1, 1),
    "heatmap": (2, 2, 1, 1),
    "table": (0, 4, 1, 4),
    "sankey": (2, 2, 1, 1),
}
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


def _neutral_chart_order(charts: tuple[str, ...], seed: str) -> tuple[str, ...]:
    """Return a reproducible order unrelated to chart semantics or source order."""
    if not seed:
        return charts
    return tuple(
        sorted(
            charts,
            key=lambda chart: hashlib.sha256(f"{seed}\0{chart}".encode()).digest(),
        )
    )


def _defined_metric_names(metrics: str) -> tuple[str, ...]:
    """Extract only customer-defined metric names from the rendered definition block."""
    return tuple(dict.fromkeys(re.findall(r'^- 指標「([^」]+)」', metrics, re.MULTILINE)))


def _visualization_response_schema(
    charts: tuple[str, ...], *, seed: str = ""
) -> dict:
    """Constrain chart and result shape together without prompt heuristics."""
    variants = []
    for chart in _neutral_chart_order(charts, seed):
        min_dimensions, max_dimensions, min_measures, max_measures = (
            CHART_SHAPE_CONTRACTS[chart]
        )
        variants.append(
            {
                "type": "object",
                "properties": {
                    "chart": {
                        "type": "string",
                        "format": "enum",
                        "enum": [chart],
                    },
                    "dimensions": {
                        "type": "array",
                        "minItems": min_dimensions,
                        "maxItems": max_dimensions,
                        "items": {"type": "string"},
                    },
                    "measures": {
                        "type": "array",
                        "minItems": min_measures,
                        "maxItems": max_measures,
                        "items": {"type": "string"},
                    },
                },
                "required": ["chart", "dimensions", "measures"],
            }
        )
    return {"anyOf": variants}


PLAN_SCHEMA = {
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

DYNAMIC_PLAN_SCHEMA = copy.deepcopy(PLAN_SCHEMA)
DYNAMIC_PLAN_SCHEMA["properties"]["panels"] = {
    "type": "array",
    "minItems": INITIAL_PANEL_COUNT,
    "maxItems": INITIAL_PANEL_COUNT,
    "items": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "kpi": {"type": "string"},
            "decision": {"type": "string"},
            "reason": {"type": "string"},
            "execution_prompt": {"type": "string"},
            "visualization": _visualization_response_schema(DASHBOARD_CHARTS),
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


class PlannerError(ValueError):
    """A planner contract violation safe to show in the local UI."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


def _response_schema(answers: dict[str, str]) -> dict:
    """Constrain clarification output to fields that still need an answer."""
    unanswered = [field for field in CLARIFICATION_FIELDS if field not in answers]
    schema = copy.deepcopy(PLAN_SCHEMA)
    clarifications = schema["properties"]["clarifications"]
    # Vertex structured output can reject an array schema whose maxItems is 0.
    # When every field is answered, omit that API-level bound and let the
    # normalizer below reject any repeated or unsupported clarification.
    if unanswered:
        clarifications["maxItems"] = len(unanswered)
    if len(unanswered) == len(CLARIFICATION_FIELDS):
        clarifications["minItems"] = 1
    if unanswered:
        field_schema = clarifications["items"]["properties"]["field"]
        field_schema["format"] = "enum"
        field_schema["enum"] = unanswered
    return schema


def _dashboard_response_schema(
    answers: dict[str, str],
    *,
    revising: bool = False,
    seed: str = "",
    metric_names: tuple[str, ...] = (),
) -> dict:
    """Constrain an initial or revised AI-authored dashboard."""
    schema = _response_schema(answers)
    schema["properties"]["panels"] = copy.deepcopy(
        DYNAMIC_PLAN_SCHEMA["properties"]["panels"]
    )
    schema["properties"]["panels"]["items"]["properties"]["visualization"] = (
        _visualization_response_schema(DASHBOARD_CHARTS, seed=seed)
    )
    if metric_names:
        schema["properties"]["panels"]["description"] = (
            "measuresは次の定義済み指標名だけを使う: "
            + "、".join(_neutral_chart_order(metric_names, seed))
        )
    if revising:
        # Vertex can reject otherwise valid structured-output schemas as too
        # complex when a nested array has a long item-count limit. Revisions
        # can grow to MAX_PANEL_COUNT, so keep that policy in the strict local
        # normalizer instead of sending minItems/maxItems to the provider.
        schema["properties"]["panels"].pop("minItems", None)
        schema["properties"]["panels"].pop("maxItems", None)
    return schema


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
    if (current_plan is None) != (instruction is None):
        raise PlannerError("現在案と変更依頼は一緒に指定してください。")
    answered = json.dumps(answers, ensure_ascii=False, sort_keys=True)
    if current_plan is None:
        revision_context = f"""これは初回提案である。
- 最初から大量に列挙せず、今回の目的に適したパネルを{INITIAL_PANEL_COUNT}件提案する。"""
    else:
        current = {
            "objective_summary": current_plan.get("objective_summary"),
            "audience": current_plan.get("audience"),
            "comparison": current_plan.get("comparison"),
            "hypotheses": current_plan.get("hypotheses"),
            "panels": [
                {field: panel.get(field) for field in DYNAMIC_PANEL_FIELDS}
                for panel in current_plan.get("panels", [])
            ],
        }
        revision_context = f"""これは現在案への追加・変更・削除相談である。
利用者の変更依頼: {instruction}
現在の分析仕様: {json.dumps(current, ensure_ascii=False, sort_keys=True)}
- 変更依頼の意味を解釈し、変更後の分析仕様をpanelsへすべて返す。
- 利用者が変更または削除を求めていない既存仕様は、意味、順序、文言を維持する。
- 新しい仕様は既存仕様と重複させず、変更後は重複なしの1〜{MAX_PANEL_COUNT}件にする。
- 上限{MAX_PANEL_COUNT}件へ達した場合は追加せず、その理由を目的要約へ明記する。"""
    return f"""次の依頼から、月次ECサイト分析ダッシュボードを計画する。

依頼: {objective}
対象期間: {period['label']}
読者回答: {answered}
{revision_context}
スキーマ・指標定義:
{metrics}

規則:
- 目的を意思決定へ言い換え、検証可能な仮説を最大3件にする。
- 固定済みの分析候補から選ばず、目的と仮説から分析仕様そのものを新規に考える。
- 各パネルには構造化出力schemaで要求された分析仕様と、SQL生成へ渡す具体的な1行の日本語execution_promptを書く。
- execution_promptにはSQLを書かない。対象期間、dimensionsとmeasuresの全項目、比較、必要な出力列が分かる仕様にする。
- 比較や派生指標が意思決定に有用なら候補として提案してよい。ただし、データソースから確認できる
  期間・粒度・指標で実行できるかを判断し、追加の範囲や定義が必要ならclarificationsで確認する。
  確認前のexecution_promptやmeasuresには未確認の実行条件を含めず、確認済みなら必要な期間と出力列を
  仕様へ明示する。
- 各可視化の結果は最大行数以内で判断できる集計粒度にする。高カーディナリティの区分軸は上位件数と並び順をexecution_promptへ明記する。
- ページ回遊のsankeyは上位{MAX_SANKEY_PATHS}経路・最大{MAX_SANKEY_PAGES}ページにする。指定した最終ページへ到達した完全な経路を集計して上位経路を選んだ後、dimensionsを遷移元・遷移先の2件とする隣接edgeへ変換する手順をexecution_promptへ明記する。
- KPI・グラフの選択理由をパネルごとに日本語で説明する。
- 初回は audience / comparison / business_goal から重要な確認を1〜3件だけ質問する。
- 読者回答にあるfieldは再質問しない。十分ならclarificationsを空にする。
- 利用できない指標や因果関係を捏造しない。
- measuresは上の「指標定義」に名前がある指標だけにする。目標値や目標達成度など、定義にない基準を作らない。
"""


def _text(value, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise PlannerError(f"分析計画の{label}が空です。")
    return normalized


def _plan_panel_text(value, label: str, limit: int = 300) -> str:
    text = " ".join(_text(value, label).split())
    if len(text) > limit:
        raise PlannerError(f"分析計画の{label}が長すぎます。")
    return text


def _panel_terms(
    value, label: str, *, minimum: int = 0, allow_role_duplicates: bool = False
) -> list[str]:
    if not isinstance(value, list) or not minimum <= len(value) <= 4:
        raise PlannerError(f"分析計画の{label}は{minimum}〜4件にしてください。")
    terms = [_plan_panel_text(item, label, 80) for item in value]
    if (
        not allow_role_duplicates
        and len({"".join(item.lower().split()) for item in terms}) != len(terms)
    ):
        raise PlannerError(f"分析計画の{label}に重複があります。")
    return terms


def _flatten_visualization(item: dict) -> dict:
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


def _validate_chart_shape(chart: str, dimensions: list[str], measures: list[str]) -> None:
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


def _normalize_plan_header(
    raw: dict,
    objective: str,
    period: dict[str, str],
    answers: dict[str, str] | None,
) -> dict:
    answers = answers or {}
    if not isinstance(raw, dict):
        raise PlannerError("分析計画がJSON objectではありません。")
    if (
        not isinstance(period, dict)
        or not all(isinstance(period.get(key), str) for key in ("from", "to", "label"))
    ):
        raise PlannerError("分析計画の対象期間が不正です。")
    hypotheses = [_text(value, "仮説") for value in raw.get("hypotheses", [])]
    if not 1 <= len(hypotheses) <= 3:
        raise PlannerError("分析計画の仮説は1〜3件にしてください。")
    clarifications = []
    for item in raw.get("clarifications", []):
        field = item.get("field") if isinstance(item, dict) else None
        diagnostic = json.dumps(field, ensure_ascii=False)
        if field not in CLARIFICATION_FIELDS:
            raise PlannerError(f"確認事項のfieldが許可範囲外です: {diagnostic}")
        if field in answers:
            raise PlannerError(f"確認事項のfieldは回答済みです: {diagnostic}")
        clarifications.append(
            {
                "field": field,
                "question": _text(item.get("question"), "確認質問"),
                "recommended_answer": _text(
                    item.get("recommended_answer"), "推奨回答"
                ),
            }
        )
    if len(clarifications) > 3 or (not answers and not clarifications):
        raise PlannerError("初回の確認事項は1〜3件にしてください。")
    normalized_objective = _text(objective, "目的")
    objective_summary = _text(raw.get("objective_summary"), "目的要約")
    audience = _text(raw.get("audience"), "読者")
    comparison = _text(raw.get("comparison"), "比較軸")
    organization_context = {
        "objective": normalized_objective,
        "objective_summary": objective_summary,
        "audience": audience,
        "comparison": comparison,
        "confirmed_answers": answers,
    }
    context_canonical = json.dumps(
        organization_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    organization_context["revision"] = (
        "context-" + hashlib.sha256(context_canonical.encode()).hexdigest()[:12]
    )
    return {
        "status": "proposed",
        "objective": normalized_objective,
        "objective_summary": objective_summary,
        "audience": audience,
        "comparison": comparison,
        "period": period,
        "hypotheses": hypotheses,
        "clarifications": clarifications,
        "answers": answers,
        "organization_context_revision": organization_context["revision"],
        "organization_context": organization_context,
    }


def _revisioned_plan(plan: dict) -> dict:
    canonical = json.dumps(plan, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    plan["revision"] = "plan-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    return plan


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
            allow_role_duplicates=panel["chart"] == "sankey",
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
            if panel["chart"] == "sankey" and measures:
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
        compact_prompt = "".join(prompt.lower().split())
        missing = [
            term
            for term in dimensions + measures
            if "".join(term.lower().split()) not in compact_prompt
        ]
        if missing:
            raise PlannerError(
                "分析計画の実行仕様に区分軸・指標がありません: " + "、".join(missing)
            )
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
            response_schema=_dashboard_response_schema(
                answers,
                revising=current_plan is not None,
                seed=f"{objective}\n{instruction or ''}",
                metric_names=metric_names,
            ),
        ),
    )
    try:
        response_text = response.text
    except (AttributeError, ValueError) as error:
        raise PlannerError(
            "Vertex AIから分析計画JSONを受け取れませんでした。"
            "現在案は保持し、自動再実行していません。"
        ) from error
    if not isinstance(response_text, str) or not response_text.strip():
        raise PlannerError(
            "Vertex AIから分析計画JSONを受け取れませんでした。"
            "現在案は保持し、自動再実行していません。"
        )
    try:
        raw = json.loads(response_text)
    except json.JSONDecodeError as error:
        raise PlannerError(
            "Vertex AIの分析計画JSONを解釈できませんでした。"
            "現在案は保持し、自動再実行していません。"
        ) from error
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
    recommendation_properties = {
        field: {"type": "string"} for field in CONSULTATION_TEXT_FIELDS
        if field != "chart"
    }
    recommendation_properties["visualization"] = _visualization_response_schema(
        CONSULTATION_CHARTS, seed=seed
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
                        for field in CONSULTATION_TEXT_FIELDS
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


def consultation_request(
    question: str,
    history: list[dict[str, str]],
    context: str,
    profile: str,
) -> str:
    """Build one bounded, history-aware consultation turn."""
    transcript = "\n".join(
        f"{item['role']}: {item['content']}" for item in history
    ) or "（初回）"
    return f"""日本語で分析テーマを相談する。SQLやデータ取得はまだ行わない。

これまでの対話:
{transcript}

今回の利用者発言: {question}

分析対象profile: {profile}
利用できるスキーマ・指標・期間の文脈:
{context}

規則:
- 今回の発言と対話履歴を踏まえ、分析担当者として自然な日本語で応答する。
- 分析仮説を立て、目的に役立つ新しい分析仕様を1〜4件考える。
- 各仕様には、measures、dimensions、比較軸、可視化、選択理由、SQL生成へ渡せる具体的な日本語依頼を書く。
- 可視化を含む分析内容は今回の目的から考え、選択理由をreasonへ書く。
- 「他にない」など別案を求められた場合、履歴で既に提示した分析をできる限り避ける。
- 最後に、分析目的を具体化する短い確認質問を1件だけ書く。
- 文脈にない指標・列・因果関係・取得済みでない数値を捏造しない。
- SQLは書かない。execution_promptは、別工程のSQL生成AIへ渡す1行の日本語仕様にする。
- 固定例から選択したように見せず、今回の目的に対する考察をassistant_messageとreasonへ明示する。
"""


def _bounded_consultation_text(value, label: str, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        raise PlannerError(f"分析相談の{label}が空です。")
    if len(text) > limit:
        raise PlannerError(f"分析相談の{label}が長すぎます。")
    return text


def _consultation_terms(value, label: str, *, minimum: int = 0) -> list[str]:
    if not isinstance(value, list) or not minimum <= len(value) <= 4:
        raise PlannerError(f"分析相談の{label}は{minimum}〜4件にしてください。")
    terms = [_bounded_consultation_text(item, label, 80) for item in value]
    if len({"".join(item.lower().split()) for item in terms}) != len(terms):
        raise PlannerError(f"分析相談の{label}に重複があります。")
    return terms


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
    recommendation["dimensions"] = _consultation_terms(raw.get("dimensions"), "区分軸")
    recommendation["measures"] = _consultation_terms(
        raw.get("measures"), "指標", minimum=1
    )
    chart = recommendation["chart"]
    if chart not in CONSULTATION_CHARTS:
        raise PlannerError("分析相談の可視化種別が未対応です。")
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
    compact_prompt = "".join(execution_prompt.lower().split())
    missing = [
        term
        for term in dimensions + measures
        if "".join(term.lower().split()) not in compact_prompt
    ]
    if missing:
        raise PlannerError(
            "分析相談の実行依頼に区分軸・指標がありません: " + "、".join(missing)
        )
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
            response_schema=_consultation_schema(seed=f"{profile}\n{question}"),
        ),
    )
    return normalize_consultation(
        json.loads(response.text)
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

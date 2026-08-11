"""Structured, reviewable analysis planning for the local dashboard demo."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re

ORGANIZATION_CONTEXT = {
    "revision": "demo-org-ec-v1",
    "state": "demo_fixture",
    "business": "ECサイトで商品を販売する組織",
    "goal": "購入成果を伸ばし、訪問者の継続利用を改善する",
    "decision_cycle": "月次マーケティング会議",
    "prohibited_interpretation": "観測相関を原因または施策効果と断定しない",
}

PANEL_CATALOG = {
    "R4": {
        "title": "購入件数と売上",
        "kpi": "購入件数、購入金額",
        "chart": "KPIカード",
        "decision": "成果の規模を把握し、追加診断が必要か判断する",
    },
    "R11": {
        "title": "リピートユーザー率",
        "kpi": "2回以上訪問したユーザーの割合",
        "chart": "KPIカード",
        "decision": "一度きりの訪問に偏っていないか判断する",
    },
    "R12": {
        "title": "平均エンゲージメント時間",
        "kpi": "セッションあたり平均エンゲージメント時間",
        "chart": "KPIカード",
        "decision": "訪問中に十分な関与があるか判断する",
    },
    "R9": {
        "title": "購入ファネル",
        "kpi": "商品閲覧、カート追加、購入のセッション数",
        "chart": "ファネル",
        "decision": "購入までの減少が大きい段階を絞り込む",
    },
    "R16": {
        "title": "日別セッションと7日移動平均",
        "kpi": "日別セッション数、7日移動平均",
        "chart": "2系列折れ線",
        "decision": "一時的な変動と基調を区別する",
    },
    "R17": {
        "title": "主要なサイト回遊",
        "kpi": "入口から3ページ目までの主要経路",
        "chart": "Sankey",
        "decision": "回遊上の行き止まりや主要導線を診断する",
    },
}

CLARIFICATION_FIELDS = ("audience", "comparison", "business_goal")
DASHBOARD_CHARTS = ("scorecard", "bar", "line", "table", "sankey")
DEFAULT_INITIAL_PANEL_COUNT = 6
DEFAULT_MAX_PANEL_COUNT = 20
DYNAMIC_PANEL_FIELDS = (
    "title", "kpi", "chart", "decision", "reason", "execution_prompt"
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
            "chart": {
                "type": "string",
                "format": "enum",
                "enum": list(DASHBOARD_CHARTS),
            },
            "decision": {"type": "string"},
            "reason": {"type": "string"},
            "execution_prompt": {"type": "string"},
        },
        "required": list(DYNAMIC_PANEL_FIELDS),
    },
}


class PlannerError(ValueError):
    """A planner contract violation safe to show in the local UI."""


def _response_schema(answers: dict[str, str]) -> dict:
    """Constrain clarification output to fields that still need an answer."""
    unanswered = [field for field in CLARIFICATION_FIELDS if field not in answers]
    schema = copy.deepcopy(PLAN_SCHEMA)
    clarifications = schema["properties"]["clarifications"]
    clarifications["maxItems"] = len(unanswered)
    if len(unanswered) == len(CLARIFICATION_FIELDS):
        clarifications["minItems"] = 1
    if unanswered:
        field_schema = clarifications["items"]["properties"]["field"]
        field_schema["format"] = "enum"
        field_schema["enum"] = unanswered
    return schema


def _dashboard_response_schema(
    answers: dict[str, str], *, revising: bool = False
) -> dict:
    """Constrain an initial or revised AI-authored dashboard."""
    schema = _response_schema(answers)
    schema["properties"]["panels"] = copy.deepcopy(
        DYNAMIC_PLAN_SCHEMA["properties"]["panels"]
    )
    if revising:
        schema["properties"]["panels"]["minItems"] = 1
        schema["properties"]["panels"]["maxItems"] = MAX_PANEL_COUNT
    return schema


def planning_request(
    objective: str, period: dict[str, str], metrics: str, answers: dict[str, str]
) -> str:
    """Build a bounded request from declared context, metrics, and panel catalog."""
    catalog = "\n".join(
        f"- {panel_id}: {item['title']} / {item['kpi']} / {item['chart']} / {item['decision']}"
        for panel_id, item in PANEL_CATALOG.items()
    )
    answered = json.dumps(answers, ensure_ascii=False, sort_keys=True)
    return f"""次の依頼から、月次ECサイト分析ダッシュボードを計画する。

依頼: {objective}
対象期間: {period['label']}
読者回答: {answered}
組織コンテキスト: {json.dumps(ORGANIZATION_CONTEXT, ensure_ascii=False)}
指標定義:
{metrics}

利用できるパネル:
{catalog}

規則:
- 目的を意思決定へ言い換え、検証可能な仮説を最大3件にする。
- パネルは目的に必要な4〜6件だけを選び、重複を避ける。
- KPI・グラフの選択理由をパネルごとに日本語で説明する。
- 初回は audience / comparison / business_goal から重要な確認を1〜3件だけ質問する。
- 読者回答にあるfieldは再質問しない。十分ならclarificationsを空にする。
- 利用できない指標や因果関係を捏造しない。
"""


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
- 明示されていない既存パネルは維持する。
- 追加依頼なら新しい分析仕様を追加し、既存案を置換しない。
- 変更・削除依頼なら対象だけを変更し、重複なしの1〜{MAX_PANEL_COUNT}件にする。
- 上限{MAX_PANEL_COUNT}件へ達した場合は追加せず、その理由を目的要約へ明記する。"""
    return f"""次の依頼から、月次ECサイト分析ダッシュボードを計画する。

依頼: {objective}
対象期間: {period['label']}
読者回答: {answered}
組織コンテキスト: {json.dumps(ORGANIZATION_CONTEXT, ensure_ascii=False)}
{revision_context}
スキーマ・指標定義:
{metrics}

利用できる可視化形式:
- scorecard: 1つの成果指標
- bar: 1つの区分軸と1つの数値
- line: 日付と1つの数値
- table: 意思決定に必要な最小限の列
- sankey: source、target、sessionsで表せる段階付きフロー

規則:
- 目的を意思決定へ言い換え、検証可能な仮説を最大3件にする。
- 固定済みの分析候補から選ばず、目的と仮説から分析仕様そのものを新規に考える。
- 可視化は慣例で決めず、比較、構成比、時系列、偏り、フローのどれを判断するかに合わせて選ぶ。
- 各パネルにはtitle、kpi、chart、decision、reasonと、SQL生成へ渡す具体的な1行の日本語execution_promptを書く。
- execution_promptにはSQLを書かない。対象期間、指標、軸、比較、必要な出力列が分かる仕様にする。
- KPI・グラフの選択理由をパネルごとに日本語で説明する。
- 初回は audience / comparison / business_goal から重要な確認を1〜3件だけ質問する。
- 読者回答にあるfieldは再質問しない。十分ならclarificationsを空にする。
- 利用できない指標や因果関係を捏造しない。
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
    return {
        "status": "proposed",
        "objective": _text(objective, "目的"),
        "objective_summary": _text(raw.get("objective_summary"), "目的要約"),
        "audience": _text(raw.get("audience"), "読者"),
        "comparison": _text(raw.get("comparison"), "比較軸"),
        "period": period,
        "hypotheses": hypotheses,
        "clarifications": clarifications,
        "answers": answers,
        "organization_context_revision": ORGANIZATION_CONTEXT["revision"],
    }


def _revisioned_plan(plan: dict) -> dict:
    canonical = json.dumps(plan, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    plan["revision"] = "plan-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    return plan


def normalize_plan(
    raw: dict,
    objective: str,
    period: dict[str, str],
    answers: dict[str, str] | None = None,
    *,
    complete_purchase_recommendations: bool = False,
) -> dict:
    """Validate the fixed-catalog fixture contract used by the current demo."""
    plan = _normalize_plan_header(raw, objective, period, answers)
    panel_reasons, seen = {}, set()
    for item in raw.get("panels", []):
        panel_id = item.get("id") if isinstance(item, dict) else None
        if panel_id not in PANEL_CATALOG or panel_id in seen:
            raise PlannerError("分析計画に未登録または重複したパネルがあります。")
        seen.add(panel_id)
        panel_reasons[panel_id] = _text(item.get("reason"), "パネル選択理由")
    if not 4 <= len(panel_reasons) <= 6:
        raise PlannerError("分析計画のパネルは4〜6件にしてください。")
    compact_objective = "".join(objective.split())
    if (
        complete_purchase_recommendations
        and "購入" in compact_objective
        and "改善" in compact_objective
        and any(word in compact_objective for word in ("課題", "優先施策"))
    ):
        for panel_id, item in PANEL_CATALOG.items():
            panel_reasons.setdefault(panel_id, f"{item['decision']}ため")
    plan["panels"] = [
        {"id": panel_id, **item, "reason": panel_reasons[panel_id]}
        for panel_id, item in PANEL_CATALOG.items()
        if panel_id in panel_reasons
    ]
    return _revisioned_plan(plan)


def normalize_dashboard_plan(
    raw: dict,
    objective: str,
    period: dict[str, str],
    answers: dict[str, str] | None = None,
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
        panel = {
            field: _plan_panel_text(
                item.get(field),
                "パネル選択理由" if field == "reason" else field,
                80 if field in {"title", "kpi", "chart"} else 300,
            )
            for field in DYNAMIC_PANEL_FIELDS
        }
        if panel["chart"] not in DASHBOARD_CHARTS:
            raise PlannerError("分析計画の可視化種別が未対応です。")
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
        panels.append({"id": f"P{index}", **panel})
    plan["panels"] = panels
    return _revisioned_plan(plan)


def propose(client, model: str, objective: str, period: dict, metrics: str, answers: dict):
    """Ask Vertex AI for a bounded plan and normalize its response."""
    from google.genai import types
    from vertex_usage import token_counts

    response = client.models.generate_content(
        model=model,
        contents=planning_request(objective, period, metrics, answers),
        config=types.GenerateContentConfig(
            system_instruction="あなたは意思決定から分析仕様を設計する日本語BIプランナー。",
            response_mime_type="application/json",
            response_schema=_response_schema(answers),
        ),
    )
    return normalize_plan(
        json.loads(response.text),
        objective,
        period,
        answers,
        complete_purchase_recommendations=True,
    ), token_counts(response.usage_metadata)


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
                answers, revising=current_plan is not None
            ),
        ),
    )
    plan = normalize_dashboard_plan(
        json.loads(response.text), objective, period, answers
    )
    add_only = instruction and any(
        word in instruction for word in ("追加", "他にも", "ほかにも", "増や")
    ) and not any(
        word in instruction for word in ("削除", "除外", "減ら", "置換", "入れ替")
    )
    if (
        current_plan is not None
        and add_only
        and len(current_plan.get("panels", [])) < MAX_PANEL_COUNT
        and len(plan["panels"]) <= len(current_plan.get("panels", []))
    ):
        raise PlannerError("追加依頼に対して分析パネルが追加されませんでした。")
    return plan, token_counts(response.usage_metadata)


CONSULTATION_CHARTS = DASHBOARD_CHARTS
CONSULTATION_FIELDS = (
    "title",
    "objective",
    "metric",
    "dimension",
    "comparison",
    "chart",
    "execution_prompt",
    "reason",
)


def _consultation_schema() -> dict:
    recommendation_properties = {
        field: {"type": "string"} for field in CONSULTATION_FIELDS
    }
    recommendation_properties["chart"] = {
        "type": "string",
        "format": "enum",
        "enum": list(CONSULTATION_CHARTS),
    }
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
                    "required": list(CONSULTATION_FIELDS),
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
- 各仕様には、指標、切り口、比較軸、可視化、選択理由、SQL生成へ渡せる具体的な日本語依頼を書く。
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
        recommendation = {
            field: _bounded_consultation_text(
                item.get(field),
                "候補理由" if field == "reason" else field,
                80 if field in {"title", "metric", "dimension", "comparison"} else 500,
            )
            for field in CONSULTATION_FIELDS
        }
        if recommendation["chart"] not in CONSULTATION_CHARTS:
            raise PlannerError("分析相談の可視化種別が未対応です。")
        execution_prompt = recommendation["execution_prompt"]
        if re.search(
            r"(?:```|`|\b(?:SELECT|WITH|FROM|GROUP\s+BY)\b)",
            execution_prompt,
            flags=re.IGNORECASE,
        ):
            raise PlannerError("分析相談の実行依頼にはSQLを書けません。")
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
            response_schema=_consultation_schema(),
        ),
    )
    return normalize_consultation(
        json.loads(response.text)
    ), token_counts(response.usage_metadata)


def confirm_plan(plan: dict) -> dict:
    """Revalidate an edited proposal and freeze a new immutable revision."""
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
        {"id": item.get("id"), "reason": item.get("reason")}
        for item in plan.get("panels", [])
    ]
    confirmed = normalize_plan(
        raw, plan.get("objective", ""), plan.get("period", {}), answers
    )
    if confirmed["clarifications"]:
        raise PlannerError("未回答の確認事項があります。")
    confirmed["status"] = "confirmed"
    canonical = json.dumps(
        confirmed, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    confirmed["revision"] = "plan-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    return confirmed


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
        raw, plan.get("objective", ""), plan.get("period", {}), answers
    )
    if confirmed["clarifications"]:
        raise PlannerError("未回答の確認事項があります。")
    confirmed["status"] = "confirmed"
    return _revisioned_plan(confirmed)

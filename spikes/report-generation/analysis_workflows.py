"""Coordinate AI-authored analysis workflows without owning transport state."""

from __future__ import annotations

from typing import Callable

import analysis_planner as planner
import bitcoin_profile as bitcoin
import meeting_report as meeting
import run_report as report


class AnalysisWorkflowError(RuntimeError):
    """Raised when an analysis workflow cannot safely produce its next event."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


def consultation_context(metrics: str, profile: str) -> str:
    """Expose source semantics without supplying prewritten analysis choices."""
    if profile == "bitcoin":
        return "利用可能期間は2024年1月〜12月。\n" + bitcoin.prompt_rules()
    return f"""利用可能期間は2020年11月〜2021年1月。未指定時は2021年1月を提案に使う。
BigQuery GA4 exportの主な列:
- event_date, event_timestamp, event_name, user_pseudo_id
- traffic_source.medium, device.category, ecommerce.transaction_id, ecommerce.purchase_revenue
- event_params ARRAY<STRUCT<key STRING, value STRUCT<string_value STRING, int_value INT64, double_value FLOAT64>>>
- items ARRAY<STRUCT<item_id STRING, item_name STRING, item_category STRING, price FLOAT64, quantity INT64>>
利用できる主な切り口:
- 日付、流入medium、device category、event_name、page_locationから正規化したpage_path、商品属性
- セッション内の時系列、入口、連続ページ遷移、イベント到達段階
定義済み指標:
{metrics}
指標定義にない語は推測せず、追加定義が必要だと説明する。"""


def analysis_section_for_specification(
    question: str,
    analysis_specification: dict,
    profile: str,
    *,
    ga4_period_for_question: Callable[[str], dict[str, str]],
    planned_analysis_section: Callable[[dict, str | None], dict],
) -> tuple[dict, dict]:
    """Freeze one selected AI proposal before SQL generation."""
    confirmed = planner.confirm_analysis_specification(analysis_specification)
    if question.strip() != confirmed["execution_prompt"]:
        raise AnalysisWorkflowError(
            "分析依頼がAIの分析仕様から変更されています。変更内容を再度相談してください。"
        )
    period = (
        bitcoin.period_for_question(question)
        if profile == "bitcoin"
        else ga4_period_for_question(question)
    )
    return period, planned_analysis_section(confirmed, "I1")


def vertex_cost_jpy(model: str, usage: dict) -> float:
    """Calculate one Vertex request cost from the shared model price table."""
    input_price, output_price = report.PRICING[model]
    return (
        usage["input_tokens"] * input_price
        + usage["output_tokens"] * output_price
    ) / 1e6 * report.USD_JPY


def run_single_analysis(
    question: str,
    analysis_specification: dict | None,
    emit: Callable[[dict], None],
    *,
    profile: str,
    clarification_answer: str | None,
    resolve_section: Callable[[str, dict, str], tuple[dict, dict]],
    run_section: Callable[..., float],
    cancel_event: object,
) -> None:
    """Execute only the AI specification explicitly selected by the user."""
    if analysis_specification is None:
        raise AnalysisWorkflowError(
            "AIが作成した分析仕様を選択してからbuildしてください。"
        )
    try:
        period, section = resolve_section(question, analysis_specification, profile)
    except (ValueError, planner.PlannerError) as error:
        raise AnalysisWorkflowError(str(error)) from error
    run_section(
        section,
        period,
        emit,
        context={"clarification_answer": clarification_answer or ""},
        profile=profile,
        cancel_event=cancel_event,
    )


def consult(
    client: object,
    model: str,
    metrics: str,
    question: str,
    history: list[dict[str, str]],
    profile: str,
    emit: Callable[[dict], None],
    *,
    context_for_profile: Callable[[str, str], str],
    check_cancelled: Callable[[], None],
) -> None:
    """Create history-aware analysis specifications without querying BigQuery."""
    try:
        emit(
            {
                "type": "consultation_stage",
                "message": "分析目的と利用可能なデータを照合中です。",
            }
        )
        consultation, usage = planner.propose_consultation(
            client,
            model,
            question,
            history,
            context_for_profile(metrics, profile),
            profile,
        )
        check_cancelled()
        emit(
            {
                "type": "consultation",
                **consultation,
                "cost_jpy": round(vertex_cost_jpy(model, usage), 3),
            }
        )
    except planner.PlannerError as error:
        raise AnalysisWorkflowError(
            str(error),
            suggested_instruction=error.suggested_instruction,
        ) from error
    except ValueError as error:
        raise AnalysisWorkflowError(str(error)) from error


def plan_dashboard(
    client: object,
    model: str,
    metrics: str,
    question: str,
    answers: dict[str, str],
    emit: Callable[[dict], None],
    *,
    analysis_plan: dict | None,
    revision_instruction: str | None,
    period_for_question: Callable[[str], dict[str, str]],
    context_for_profile: Callable[[str, str], str],
    check_cancelled: Callable[[], None],
) -> None:
    """Propose a reviewable dashboard plan without querying BigQuery."""
    try:
        period = period_for_question(question)
        current_plan = (
            planner.confirm_dashboard_plan(analysis_plan) if analysis_plan else None
        )
        emit({"type": "plan_stage", "message": "分析目的と指標定義を照合中です。"})
        plan, usage = planner.propose_dashboard(
            client,
            model,
            question,
            period,
            context_for_profile(metrics, "ga4"),
            answers,
            current_plan=current_plan,
            instruction=revision_instruction,
        )
        check_cancelled()
        emit(
            {
                "type": "plan",
                "plan": plan,
                "cost_jpy": round(vertex_cost_jpy(model, usage), 3),
            }
        )
    except planner.PlannerError as error:
        raise AnalysisWorkflowError(
            str(error),
            suggested_instruction=error.suggested_instruction,
        ) from error
    except ValueError as error:
        raise AnalysisWorkflowError(str(error)) from error


def generate_meeting_report(
    client: object,
    model: str,
    latest_dashboard: dict | None,
    build_revision: str,
    emit: Callable[[dict], None],
    *,
    check_cancelled: Callable[[], None],
) -> None:
    """Generate a cited meeting draft from one matching evidence bundle."""
    bundle = latest_dashboard
    if not bundle or bundle.get("build_revision") != build_revision:
        raise AnalysisWorkflowError("指定したbuild revisionの根拠bundleがありません。")
    try:
        emit({"type": "report_stage", "message": "根拠と不確実性を整理中です。"})
        draft, usage = meeting.generate(client, model, bundle)
        check_cancelled()
        emit(
            {
                "type": "meeting_report",
                "report": draft,
                "cost_jpy": round(vertex_cost_jpy(model, usage), 3),
            }
        )
    except (ValueError, meeting.ReportError) as error:
        raise AnalysisWorkflowError(str(error)) from error

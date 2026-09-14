"""Coordinate AI-authored analysis workflows without owning transport state."""

from __future__ import annotations

from typing import Callable

import analysis_planner as planner
import data_source_profiles
import meeting_report as meeting
import run_report as report


class AnalysisWorkflowError(RuntimeError):
    """Raised when an analysis workflow cannot safely produce its next event."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


def consultation_context(metrics: str, profile: str) -> str:
    """Expose source semantics without supplying prewritten analysis choices."""
    return data_source_profiles.profile_for(profile).planner_context(metrics)


def analysis_section_for_specification(
    question: str,
    analysis_specification: dict,
    profile: str,
    *,
    planned_analysis_section: Callable[[dict, str | None], dict],
) -> tuple[dict, dict]:
    """Freeze one selected AI proposal before SQL generation."""
    confirmed = planner.confirm_analysis_specification(analysis_specification)
    if question.strip() != confirmed["execution_prompt"]:
        raise AnalysisWorkflowError(
            "分析依頼がAIの分析仕様から変更されています。変更内容を再度相談してください。"
        )
    period = data_source_profiles.profile_for(profile).period_for_question(question)
    return period, planned_analysis_section(confirmed, "I1")


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
        )
        check_cancelled()
        emit(
            {
                "type": "consultation",
                **consultation,
                "cost_jpy": round(report.vertex_cost_jpy(model, usage), 3),
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
    source: data_source_profiles.DataSourceProfile | None = None,
    period_for_question: Callable[[str], dict[str, str]] | None = None,
    context_for_profile: Callable[[str, str], str] | None = None,
    check_cancelled: Callable[[], None],
) -> None:
    """Propose a reviewable dashboard plan without querying BigQuery."""
    try:
        selected_source = source or data_source_profiles.profile_for("ga4")
        period_resolver = period_for_question or selected_source.period_for_question
        period = period_resolver(question)
        current_plan = (
            planner.confirm_dashboard_plan(
                analysis_plan, expected_profile=selected_source.key
            )
            if analysis_plan
            else None
        )
        emit({"type": "plan_stage", "message": "分析目的と指標定義を照合中です。"})
        context = (
            context_for_profile(metrics, selected_source.key)
            if context_for_profile
            else selected_source.planner_context(metrics)
        )
        plan, usage = planner.propose_dashboard(
            client,
            model,
            question,
            period,
            context,
            answers,
            current_plan=current_plan,
            instruction=revision_instruction,
            profile=selected_source.key,
        )
        check_cancelled()
        emit(
            {
                "type": "plan",
                "plan": plan,
                "cost_jpy": round(report.vertex_cost_jpy(model, usage), 3),
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
                "cost_jpy": round(report.vertex_cost_jpy(model, usage), 3),
            }
        )
    except (ValueError, meeting.ReportError) as error:
        raise AnalysisWorkflowError(str(error)) from error

"""Coordinate AI-authored analysis workflows without owning transport state."""

from __future__ import annotations

from typing import Callable

import analysis_contract_context
import analysis_planner as planner
import meeting_report as meeting
import run_report as report
from analysis_contract import AnalysisContract


class AnalysisWorkflowError(RuntimeError):
    """Raised when an analysis workflow cannot safely produce its next event."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


def analysis_section_for_specification(
    question: str,
    analysis_specification: dict,
    contract: AnalysisContract,
    *,
    planned_analysis_section: Callable[[dict, str | None], dict],
) -> tuple[dict, dict]:
    """Freeze one selected AI proposal before SQL generation."""
    confirmed = planner.confirm_analysis_specification(analysis_specification)
    analysis_contract_context.require_specification_contract(confirmed, contract)
    if question.strip() != confirmed["execution_prompt"]:
        raise AnalysisWorkflowError(
            "分析依頼がAIの分析仕様から変更されています。変更内容を再度相談してください。"
        )
    period = analysis_contract_context.planning_period(contract)
    return period, planned_analysis_section(confirmed, "I1")


def run_single_analysis(
    question: str,
    analysis_specification: dict | None,
    emit: Callable[[dict], None],
    *,
    contract: AnalysisContract,
    resolve_section: Callable[[str, dict, AnalysisContract], tuple[dict, dict]],
    run_section: Callable[..., float],
) -> None:
    """Execute only the AI specification explicitly selected by the user."""
    if analysis_specification is None:
        raise AnalysisWorkflowError(
            "AIが作成した分析仕様を選択してからbuildしてください。"
        )
    try:
        period, section = resolve_section(question, analysis_specification, contract)
    except (
        analysis_contract_context.AnalysisContextError,
        ValueError,
        planner.PlannerError,
    ) as error:
        raise AnalysisWorkflowError(str(error)) from error
    run_section(
        section,
        emit,
        contract=contract,
        context={"operation": "single", "period": period["label"]},
    )


def consult(
    client: object,
    model: str,
    question: str,
    history: list[dict[str, str]],
    contract: AnalysisContract,
    emit: Callable[[dict], None],
    *,
    check_cancelled: Callable[[], None],
) -> None:
    """Create history-aware analysis specifications without querying BigQuery."""
    try:
        policy = analysis_contract_context.execution_policy(contract)
        if policy.result is None or not policy.result.measures:
            raise AnalysisWorkflowError(
                "共通分析契約に実行可能な指標がないため分析を提案しません。"
            )
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
            analysis_contract_context.planner_context(contract),
        )
        recommendations = [
            analysis_contract_context.bind_specification(item, contract)
            for item in consultation["recommendations"]
        ]
        for recommendation in recommendations:
            analysis_contract_context.require_specification_contract(
                recommendation, contract
            )
        consultation["recommendations"] = recommendations
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
    question: str,
    answers: dict[str, str],
    emit: Callable[[dict], None],
    *,
    contract: AnalysisContract,
    analysis_plan: dict | None,
    revision_instruction: str | None,
    check_cancelled: Callable[[], None],
) -> None:
    """Propose a reviewable dashboard plan without querying BigQuery."""
    try:
        policy = analysis_contract_context.execution_policy(contract)
        if policy.result is None or not policy.result.measures:
            raise AnalysisWorkflowError(
                "共通分析契約に実行可能な指標がないため分析を計画しません。"
            )
        period = analysis_contract_context.planning_period(contract)
        if analysis_plan is not None:
            analysis_contract_context.require_specification_contract(
                analysis_plan, contract
            )
        current_plan = (
            planner.confirm_dashboard_plan(analysis_plan)
            if analysis_plan
            else None
        )
        emit(
            {
                "type": "plan_stage",
                "message": "分析目的と共通分析契約を照合中です。",
            }
        )
        context = analysis_contract_context.planner_context(contract)
        plan, usage = planner.propose_dashboard(
            client,
            model,
            question,
            period,
            context,
            answers,
            allowed_metrics=(
                tuple(sorted(policy.result.measures)) if policy.result else ()
            ),
            current_plan=current_plan,
            instruction=revision_instruction,
        )
        plan = analysis_contract_context.bind_specification(plan, contract)
        analysis_contract_context.require_specification_contract(plan, contract)
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
    except (analysis_contract_context.AnalysisContextError, ValueError) as error:
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

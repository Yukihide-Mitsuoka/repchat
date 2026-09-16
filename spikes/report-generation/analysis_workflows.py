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


def consult(
    client: object,
    model: str,
    question: str,
    history: list[dict[str, str]],
    emit: Callable[[dict], None],
    *,
    contract: AnalysisContract,
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
            analysis_contract_context.planner_context(contract),
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
        period = analysis_contract_context.planning_period(contract)
        current_plan = (
            planner.confirm_dashboard_plan(analysis_plan)
            if analysis_plan
            else None
        )
        if current_plan is not None:
            analysis_contract_context.require_specification_contract(
                current_plan, contract
            )
        emit({"type": "plan_stage", "message": "分析目的と指標定義を照合中です。"})
        plan, usage = planner.propose_dashboard(
            client,
            model,
            question,
            period,
            analysis_contract_context.planner_context(contract),
            answers,
            current_plan=current_plan,
            instruction=revision_instruction,
        )
        plan = analysis_contract_context.bind_specification(plan, contract)
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

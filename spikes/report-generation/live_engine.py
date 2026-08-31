"""Own the stateful execution lifecycle for the local analysis demo."""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

import analysis_workflows
import bitcoin_profile as bitcoin
import dashboard_build
import run_report as report
import section_execution


class LiveQueryEngine:
    """Coordinate one cancellable live-demo operation at a time.

    The browser-facing module supplies its public error types and boundary helpers
    through class attributes. Keeping those seams configurable preserves the demo's
    established API while making lifecycle ownership independent of HTTP transport.
    """

    here = Path(__file__).resolve().parent
    max_result_rows = 100
    error_type: type[RuntimeError] = RuntimeError
    cancelled_error_type: type[RuntimeError] = RuntimeError
    resolve_analysis_section: Callable[..., tuple[dict, dict]]
    consultation_context: Callable[[str, str], str]
    sections_for_plan: Callable[[str, dict], tuple[dict, list[dict]]]
    layout_rows_for_plan: Callable[[list[dict]], list[dict]]
    period_for_question: Callable[[str], dict[str, str]]

    def __init__(self, project: str, model: str = report.DEFAULT_MODEL):
        from google import genai
        from google.cloud import bigquery

        self.model = model
        self.metric_definitions = json.loads(
            (self.here / "metrics.json").read_text(encoding="utf-8")
        )
        self.metrics = report.metrics_block(self.here / "metrics.json")
        self.rules = report.prompt_rules(self.metrics)
        self.bitcoin_rules = bitcoin.prompt_rules()
        self.client = genai.Client(vertexai=True, project=project, location="global")
        self.bq = bigquery.Client(project=project)
        self.lock = threading.Lock()
        self.operation_state_lock = threading.Lock()
        self.active_request_id = None
        self.active_cancel_event = None
        self.active_done_event = None
        self.latest_dashboard = None

    def _ensure_operation_state(self) -> None:
        if not hasattr(self, "operation_state_lock"):
            self.operation_state_lock = threading.Lock()
            self.active_request_id = None
            self.active_cancel_event = None
            self.active_done_event = None

    def _begin_operation(self, request_id: str | None) -> threading.Event:
        self._ensure_operation_state()
        if not self.lock.acquire(blocking=False):
            raise self.error_type("別の問い合わせを処理中です。完了後に再送してください。")
        cancel_event, done_event = threading.Event(), threading.Event()
        with self.operation_state_lock:
            self.active_request_id = request_id
            self.active_cancel_event = cancel_event
            self.active_done_event = done_event
        return cancel_event

    def _finish_operation(self) -> None:
        with self.operation_state_lock:
            done_event = self.active_done_event
            self.active_request_id = None
            self.active_cancel_event = None
            self.active_done_event = None
        self.lock.release()
        if done_event is not None:
            done_event.set()

    @contextmanager
    def _operation_scope(self, request_id: str | None) -> Iterator[threading.Event]:
        """Finish only the operation acquired here, including on failure."""
        cancel_event = self._begin_operation(request_id)
        try:
            yield cancel_event
        finally:
            self._finish_operation()

    def _check_cancelled(self, cancel_event: threading.Event) -> None:
        if cancel_event.is_set():
            raise self.cancelled_error_type("処理を停止しました。")

    def cancel(self, request_id: str) -> bool:
        """Request cancellation and wait until the active operation releases its lock."""
        self._ensure_operation_state()
        with self.operation_state_lock:
            if request_id != self.active_request_id or self.active_cancel_event is None:
                return False
            self.active_cancel_event.set()
            done_event = self.active_done_event
        return bool(done_event and done_event.wait(timeout=180))

    def query(
        self,
        question: str,
        emit: Callable[[dict], None],
        profile: str = "ga4",
        analysis_specification: dict | None = None,
        clarification_answer: str | None = None,
        request_id: str | None = None,
    ) -> None:
        with self._operation_scope(request_id) as cancel_event:
            try:
                analysis_workflows.run_single_analysis(
                    question,
                    analysis_specification,
                    emit,
                    profile=profile,
                    clarification_answer=clarification_answer,
                    resolve_section=self.resolve_analysis_section,
                    run_section=self._run_section,
                    cancel_event=cancel_event,
                )
            except analysis_workflows.AnalysisWorkflowError as error:
                raise self.error_type(
                    str(error),
                    suggested_instruction=error.suggested_instruction,
                ) from error

    def consult(
        self,
        question: str,
        history: list[dict[str, str]],
        emit: Callable[[dict], None],
        profile: str = "ga4",
        request_id: str | None = None,
    ) -> None:
        """Create history-aware analysis specifications without querying BigQuery."""
        with self._operation_scope(request_id) as cancel_event:
            try:
                analysis_workflows.consult(
                    self.client,
                    self.model,
                    self.metrics,
                    question,
                    history,
                    profile,
                    emit,
                    context_for_profile=self.consultation_context,
                    check_cancelled=lambda: self._check_cancelled(cancel_event),
                )
            except analysis_workflows.AnalysisWorkflowError as error:
                raise self.error_type(
                    str(error),
                    suggested_instruction=error.suggested_instruction,
                ) from error

    def dashboard(
        self,
        question: str,
        emit: Callable[[dict], None],
        analysis_plan: dict | None = None,
        request_id: str | None = None,
    ) -> None:
        """Build only a confirmed AI-authored dashboard plan."""
        with self._operation_scope(request_id) as cancel_event:
            self.latest_dashboard = None
            try:
                dashboard_build.build_dashboard(
                    question,
                    analysis_plan,
                    emit,
                    metric_definitions=(
                        self.metric_definitions if analysis_plan is not None else {}
                    ),
                    sections_for_plan=self.sections_for_plan,
                    layout_rows_for_plan=self.layout_rows_for_plan,
                    run_section=self._run_section,
                    check_cancelled=lambda: self._check_cancelled(cancel_event),
                    store_bundle=lambda bundle: setattr(
                        self, "latest_dashboard", bundle
                    ),
                )
            except dashboard_build.DashboardBuildError as error:
                raise self.error_type(str(error)) from error

    def meeting_report(
        self,
        build_revision: str,
        emit: Callable[[dict], None],
        request_id: str | None = None,
    ) -> None:
        """Generate a cited draft from the latest completed dashboard bundle."""
        with self._operation_scope(request_id) as cancel_event:
            try:
                analysis_workflows.generate_meeting_report(
                    self.client,
                    self.model,
                    self.latest_dashboard,
                    build_revision,
                    emit,
                    check_cancelled=lambda: self._check_cancelled(cancel_event),
                )
            except analysis_workflows.AnalysisWorkflowError as error:
                raise self.error_type(
                    str(error),
                    suggested_instruction=error.suggested_instruction,
                ) from error

    def plan(
        self,
        question: str,
        answers: dict[str, str],
        emit: Callable[[dict], None],
        analysis_plan: dict | None = None,
        revision_instruction: str | None = None,
        request_id: str | None = None,
    ) -> None:
        """Propose a reviewable plan without running any warehouse query."""
        with self._operation_scope(request_id) as cancel_event:
            try:
                analysis_workflows.plan_dashboard(
                    self.client,
                    self.model,
                    self.metrics,
                    question,
                    answers,
                    emit,
                    analysis_plan=analysis_plan,
                    revision_instruction=revision_instruction,
                    period_for_question=self.period_for_question,
                    context_for_profile=self.consultation_context,
                    check_cancelled=lambda: self._check_cancelled(cancel_event),
                )
            except analysis_workflows.AnalysisWorkflowError as error:
                raise self.error_type(
                    str(error),
                    suggested_instruction=error.suggested_instruction,
                ) from error

    def _run_section(
        self,
        section: dict,
        period: dict[str, str],
        emit: Callable[[dict], None],
        context: dict | None = None,
        profile: str = "ga4",
        cancel_event: threading.Event | None = None,
    ) -> float:
        """Run one panel while preserving the live demo's public error contract."""
        try:
            return section_execution.run_section(
                section,
                period,
                emit,
                client=self.client,
                bq=self.bq,
                model=self.model,
                rules=self.rules if profile != "bitcoin" else "",
                bitcoin_rules=self.bitcoin_rules if profile == "bitcoin" else "",
                max_result_rows=self.max_result_rows,
                context=context,
                profile=profile,
            )
        except section_execution.SectionExecutionError as error:
            raise self.error_type(str(error)) from error

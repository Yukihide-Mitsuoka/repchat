"""Continue successful manifest preflights through the common dashboard planner."""

from __future__ import annotations

import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

import analysis_contract_context  # noqa: E402 - sibling spike import
import analysis_workflows  # noqa: E402 - sibling spike import
from manifest_preflight import (  # noqa: E402 - local import after path setup
    PlannedPreflightAttempt,
    run_manifest_preflights,
)
from preflight import PreflightResult, run_preflight  # noqa: E402


PLANNING_FAILURE = "planning"
PLANNING_FAILURE_CODE = "planning_failed"


@dataclass(frozen=True)
class PlannedAnalysisAttempt:
    """One manifest attempt after preflight and, when possible, planning."""

    preflight_attempt: PlannedPreflightAttempt
    plan: dict[str, Any] | None
    planning_cost_jpy: float | None
    failure_stage: str | None = None
    failure_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed attempt without exposing a planner exception."""
        if self.succeeded:
            raise ValueError(
                "a successful planning attempt cannot create a failure recording"
            )
        if self.failure_stage != PLANNING_FAILURE:
            return self.preflight_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if bytes_processed != 0:
            raise ValueError("planning failure cannot record processed bytes")
        preflight = self.preflight_attempt.result
        return {
            "schema_id": self.preflight_attempt.schema_id,
            "case_id": self.preflight_attempt.case_id,
            "run": {
                "run_id": self.preflight_attempt.run_id,
                **dict(self.preflight_attempt.pipeline_fingerprints),
                "runtime_input": preflight.runtime_input(),
                "generated_sql": "",
                "failure_stage": self.failure_stage,
                "failure_code": self.failure_code,
                "sql_execution_succeeded": False,
                "actual_rows": [],
                "unauthorized_reference": False,
                "dangerous_sql": False,
                "scan_limit_exceeded": False,
                "semantic_error": False,
                "render_succeeded": False,
                "bytes_processed": 0,
                "cost_jpy": cost_jpy,
            },
        }


def _failed_attempt(
    attempt: PlannedPreflightAttempt, stage: str, code: str
) -> PlannedAnalysisAttempt:
    return PlannedAnalysisAttempt(
        preflight_attempt=attempt,
        plan=None,
        planning_cost_jpy=None,
        failure_stage=stage,
        failure_code=code,
    )


def _plan_attempt(
    attempt: PlannedPreflightAttempt,
    vertex,
    model: str,
    planning_runner: Callable[..., None],
) -> PlannedAnalysisAttempt:
    preflight = attempt.result
    if not preflight.succeeded:
        return _failed_attempt(
            attempt, str(preflight.failure_stage), str(preflight.failure_code)
        )
    if preflight.contract is None:
        return _failed_attempt(attempt, PLANNING_FAILURE, PLANNING_FAILURE_CODE)

    events: list[dict[str, Any]] = []
    try:
        planning_runner(
            vertex,
            model,
            preflight.question,
            {},
            events.append,
            contract=preflight.contract,
            analysis_plan=None,
            revision_instruction=None,
            check_cancelled=lambda: None,
            initial_panel_count=1,
        )
        plan_events = [
            event
            for event in events
            if isinstance(event, dict) and event.get("type") == "plan"
        ]
        if len(plan_events) != 1:
            raise ValueError("planning must emit exactly one plan")
        event = plan_events[0]
        plan = event.get("plan")
        cost = event.get("cost_jpy")
        if (
            not isinstance(plan, dict)
            or re.fullmatch(r"plan-[0-9a-f]{12}", str(plan.get("revision"))) is None
            or plan.get("clarifications") != []
            or not isinstance(plan.get("panels"), list)
            or len(plan["panels"]) != 1
            or isinstance(cost, bool)
            or not isinstance(cost, (int, float))
            or not math.isfinite(cost)
            or cost < 0
        ):
            raise ValueError("planning output is invalid")
        analysis_contract_context.require_specification_contract(
            plan, preflight.contract
        )
        plan_copy = json.loads(json.dumps(plan, ensure_ascii=False))
    except Exception:
        return _failed_attempt(attempt, PLANNING_FAILURE, PLANNING_FAILURE_CODE)
    return PlannedAnalysisAttempt(
        preflight_attempt=attempt,
        plan=plan_copy,
        planning_cost_jpy=float(cost),
    )


def run_manifest_planning(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    preflight_runner: Callable[..., PreflightResult] = run_preflight,
    planning_runner: Callable[..., None] = analysis_workflows.plan_dashboard,
) -> tuple[PlannedAnalysisAttempt, ...]:
    """Run every manifest preflight and plan only its successful attempts."""
    preflights = run_manifest_preflights(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
        preflight_runner=preflight_runner,
    )
    return tuple(
        _plan_attempt(attempt, vertex, model, planning_runner)
        for attempt in preflights
    )

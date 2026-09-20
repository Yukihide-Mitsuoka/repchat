"""Continue successful manifest plans through the common SQL generator."""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

import analysis_contract_context  # noqa: E402 - sibling spike import
import run_report as report  # noqa: E402 - sibling spike import
import sql_generation  # noqa: E402 - sibling spike import
import visualization_sections  # noqa: E402 - sibling spike import
from manifest_planning import (  # noqa: E402 - local import after path setup
    PlannedAnalysisAttempt,
    run_manifest_planning,
)


SQL_GENERATION_FAILURE = "sql_generation"
SQL_GENERATION_FAILURE_CODE = "sql_generation_failed"


@dataclass(frozen=True)
class GeneratedSQLAttempt:
    """One planned attempt after common section and SQL generation."""

    planned_attempt: PlannedAnalysisAttempt
    section: dict[str, Any] | None
    generated_sql: str | None
    sql_generation_cost_jpy: float | None
    failure_stage: str | None = None
    failure_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def failure_recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Record a failed attempt without exposing SQL-role output."""
        if self.succeeded:
            raise ValueError(
                "a successful SQL generation attempt cannot create a failure recording"
            )
        if self.failure_stage != SQL_GENERATION_FAILURE:
            return self.planned_attempt.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if bytes_processed != 0:
            raise ValueError("SQL generation failure cannot record processed bytes")
        preflight_attempt = self.planned_attempt.preflight_attempt
        return {
            "schema_id": preflight_attempt.schema_id,
            "case_id": preflight_attempt.case_id,
            "run": {
                "run_id": preflight_attempt.run_id,
                **dict(preflight_attempt.pipeline_fingerprints),
                "runtime_input": preflight_attempt.result.runtime_input(),
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
    attempt: PlannedAnalysisAttempt, stage: str, code: str
) -> GeneratedSQLAttempt:
    return GeneratedSQLAttempt(
        planned_attempt=attempt,
        section=None,
        generated_sql=None,
        sql_generation_cost_jpy=None,
        failure_stage=stage,
        failure_code=code,
    )


def _generate_attempt(
    attempt: PlannedAnalysisAttempt,
    vertex,
    model: str,
    sql_runner: Callable[..., tuple[dict[str, Any], dict[str, int]]],
) -> GeneratedSQLAttempt:
    if not attempt.succeeded:
        return _failed_attempt(
            attempt, str(attempt.failure_stage), str(attempt.failure_code)
        )

    preflight = attempt.preflight_attempt.result
    try:
        if preflight.contract is None or attempt.plan is None:
            raise ValueError("successful planning requires a contract and plan")
        panels = attempt.plan.get("panels")
        if not isinstance(panels, list) or len(panels) != 1:
            raise ValueError("SQL generation requires exactly one panel")
        section = visualization_sections.build_planned_analysis_section(panels[0])
        answer, usage = sql_runner(
            vertex,
            model,
            section,
            analysis_contract_context.planning_period(preflight.contract),
            analysis_contract_context.sql_rules(preflight.contract),
        )
        if not isinstance(answer, dict):
            raise ValueError("SQL generation output is invalid")
        sql = answer.get("sql")
        undefined_terms = answer.get("undefined_terms")
        clarification = answer.get("clarification_question", "")
        if (
            not isinstance(sql, str)
            or not sql.strip()
            or not isinstance(answer.get("reason"), str)
            or not isinstance(undefined_terms, list)
            or any(not isinstance(term, str) for term in undefined_terms)
            or undefined_terms
            or not isinstance(clarification, str)
        ):
            raise ValueError("SQL generation output is invalid")
        cost = report.vertex_cost_jpy(model, usage)
        if (
            isinstance(cost, bool)
            or not isinstance(cost, (int, float))
            or not math.isfinite(cost)
            or cost < 0
        ):
            raise ValueError("SQL generation cost is invalid")
        section_copy = json.loads(json.dumps(section, ensure_ascii=False))
    except Exception:
        return _failed_attempt(
            attempt, SQL_GENERATION_FAILURE, SQL_GENERATION_FAILURE_CODE
        )
    return GeneratedSQLAttempt(
        planned_attempt=attempt,
        section=section_copy,
        generated_sql=sql.strip(),
        sql_generation_cost_jpy=float(cost),
    )


def run_manifest_sql_generation(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    planning_runner: Callable[..., tuple[PlannedAnalysisAttempt, ...]] = (
        run_manifest_planning
    ),
    sql_runner: Callable[..., tuple[dict[str, Any], dict[str, int]]] = (
        sql_generation.generate
    ),
) -> tuple[GeneratedSQLAttempt, ...]:
    """Plan every manifest attempt and generate SQL only for its successes."""
    planned_attempts = planning_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(
        _generate_attempt(attempt, vertex, model, sql_runner)
        for attempt in planned_attempts
    )

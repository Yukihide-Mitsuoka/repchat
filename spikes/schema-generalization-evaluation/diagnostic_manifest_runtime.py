"""Bind reviewed diagnostic cases to the measured manifest stage chain."""

from __future__ import annotations

from datetime import date
from functools import partial
from pathlib import Path
from typing import Any, Callable, Mapping

from manifest_planning import analysis_workflows, run_manifest_planning

from bigquery_scope_discovery import DiscoverySnapshot, discover_scope
from budgeted_manifest_runtime import run_budgeted_manifest_evaluation
from diagnostic_preflight import (
    DiagnosticPreflightError,
    ReviewedDiagnosticCase,
    prepare_diagnostic_preflights,
)
from execution_budget import BudgetGate
from manifest_dry_run import run_manifest_dry_runs
from manifest_execution import run_manifest_executions
from manifest_preflight import planned_inputs
from manifest_rendering import RenderingAttempt, run_manifest_rendering
from manifest_result_validation import run_manifest_result_validation
from manifest_runtime_meter import PricingSnapshot
from manifest_sql_generation import run_manifest_sql_generation
from manifest_sql_validation import run_manifest_sql_validation


def _diagnostic_rendering_runner(
    cases: Mapping[tuple[str, str], ReviewedDiagnosticCase],
    *,
    discoverer: Callable[..., DiscoverySnapshot] = discover_scope,
    planning_runner: Callable[..., None] = analysis_workflows.plan_dashboard,
) -> Callable[..., tuple[RenderingAttempt, ...]]:
    """Select one reviewed case, then retain it through every existing stage."""

    def render(
        manifest: Any, bq: Any, vertex: Any, model: str, *, as_of: date
    ) -> tuple[RenderingAttempt, ...]:
        _, planned = planned_inputs(manifest)
        if len(planned) != 1:
            raise DiagnosticPreflightError("diagnostic run must contain one planned identity")
        schema_id, case_id, _, _, _ = planned[0]
        case = cases.get((schema_id, case_id))
        if case is None:
            raise DiagnosticPreflightError("diagnostic run has no reviewed case")
        planning = partial(
            run_manifest_planning,
            preflight_runner=partial(case.run, discoverer=discoverer),
            planning_runner=planning_runner,
        )
        generation = partial(run_manifest_sql_generation, planning_runner=planning)
        validation = partial(run_manifest_sql_validation, generation_runner=generation)
        dry_run = partial(run_manifest_dry_runs, validation_runner=validation)
        execution = partial(run_manifest_executions, dry_run_runner=dry_run)
        result = partial(run_manifest_result_validation, execution_runner=execution)
        return run_manifest_rendering(
            manifest, bq, vertex, model, as_of=as_of, result_runner=result
        )

    return render


def run_budgeted_diagnostic_manifest_evaluation(
    manifest: Any,
    bq: Any,
    vertex: Any,
    model: str,
    *,
    as_of: date,
    output_directory: str | Path,
    pricing_snapshot: PricingSnapshot,
    region: str,
    execution_date: date,
    gate: BudgetGate,
    scope_snapshots_bytes: bytes,
    contracts_bytes: bytes,
    review_record_bytes: bytes,
) -> dict[str, Path]:
    """Validate reviewed inputs before using the existing budgeted runner.

    The caller still must validate execution intent and obtain approval for the
    exact paid plan. This function does not authorize provider calls.
    """
    cases = prepare_diagnostic_preflights(
        manifest, scope_snapshots_bytes, contracts_bytes, review_record_bytes
    )
    return run_budgeted_manifest_evaluation(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
        output_directory=output_directory,
        pricing_snapshot=pricing_snapshot,
        region=region,
        execution_date=execution_date,
        gate=gate,
        rendering_runner=_diagnostic_rendering_runner(cases),
    )

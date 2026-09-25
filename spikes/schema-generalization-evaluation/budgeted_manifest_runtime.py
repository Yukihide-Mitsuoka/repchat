"""Compose the measured manifest runner with both provider budget adapters."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Callable

from bigquery_budget_adapter import BudgetedBigQuery
from execution_budget import BudgetError, BudgetGate
from manifest_artifacts import run_measured_manifest_evaluation
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError, RuntimeMeter
from manifest_rendering import RenderingAttempt
from vertex_budget_adapter import BudgetedVertex


def run_budgeted_manifest_evaluation(
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
    rendering_runner: Callable[..., tuple[RenderingAttempt, ...]] | None = None,
) -> dict[str, Path]:
    """Run only with one fresh gate and measured, budgeted provider clients.

    The caller must obtain the gate from a separately validated execution intent
    and verify the owner's approval for that exact plan. This API does neither.
    """
    if not isinstance(gate, BudgetGate):
        raise BudgetError("validated budget gate is required")
    gate.ensure_idle()
    if any(gate.settled_jpy.values()) or any(gate.unresolved_reservation_jpy.values()):
        raise BudgetError("evaluation requires a fresh budget gate")
    if not isinstance(pricing_snapshot, PricingSnapshot):
        raise RuntimeMeasurementError("pricing snapshot is required")
    pricing = pricing_snapshot.pricing_for(model, region, execution_date)
    meter = RuntimeMeter(pricing)
    measured_bq, measured_vertex = meter.instrument(bq, vertex)
    budgeted_bq = BudgetedBigQuery(
        measured_bq, gate, pricing_snapshot,
        model=model, region=region, execution_date=execution_date,
    )
    budgeted_vertex = BudgetedVertex(
        measured_vertex, gate, pricing_snapshot,
        region=region, execution_date=execution_date,
    )

    def settled_meter(identity, execute):
        measurement = meter(identity, execute)
        gate.ensure_idle()
        return measurement

    options: dict[str, Any] = {}
    if rendering_runner is not None:
        options["rendering_runner"] = rendering_runner
    artifacts = run_measured_manifest_evaluation(
        manifest, budgeted_bq, budgeted_vertex, model,
        as_of=as_of, output_directory=output_directory,
        meter=settled_meter, **options,
    )
    gate.ensure_idle()
    return artifacts

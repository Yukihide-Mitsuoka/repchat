"""Render validated manifest results and produce complete run recordings."""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

from manifest_result_validation import (
    ResultValidationAttempt,
    run_manifest_result_validation,
)


RENDERING_FAILURE = "rendering"
RENDERING_FAILURE_CODE = "rendering_failed"
RENDERER_TIMEOUT_SECONDS = 15
RENDERER_PROBE = (
    Path(__file__).resolve().parents[1]
    / "report-generation"
    / "chart_renderer_probe.mjs"
)


class RendererInfrastructureError(RuntimeError):
    """Indicate that the renderer process could not be started or completed."""


def run_renderer_probe(payload: dict[str, Any]) -> bool:
    """Return whether the packaged renderer accepts and renders one payload."""
    try:
        completed = subprocess.run(
            ["node", str(RENDERER_PROBE)],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=RENDERER_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        raise RendererInfrastructureError(
            "renderer probe could not complete"
        ) from None
    return completed.returncode == 0


@dataclass(frozen=True)
class RenderingAttempt:
    """One validated result after a renderer probe attempt."""

    result_attempt: ResultValidationAttempt
    render_succeeded: bool
    failure_stage: str | None = None
    failure_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def recording(
        self, *, bytes_processed: int, cost_jpy: int | float
    ) -> dict[str, Any]:
        """Create a complete run record from measured execution evidence."""
        result = self.result_attempt
        if result.failure_stage is not None:
            return result.failure_recording(
                bytes_processed=bytes_processed,
                cost_jpy=cost_jpy,
            )
        if type(bytes_processed) is not int or bytes_processed < result.bytes_processed:
            raise ValueError("rendering bytes must include execution metadata")
        if (
            isinstance(cost_jpy, bool)
            or not isinstance(cost_jpy, (int, float))
            or not math.isfinite(cost_jpy)
            or cost_jpy < 0
        ):
            raise ValueError("rendering cost must be finite and non-negative")
        if (
            result.rows is None
            or result.columns is None
            or result.visualization is None
        ):
            raise ValueError("successful result validation output is incomplete")

        execution = result.execution_attempt
        validated = execution.dry_run_attempt.validated_attempt
        generated = validated.generated_attempt
        preflight = generated.planned_attempt.preflight_attempt
        return {
            "schema_id": preflight.schema_id,
            "case_id": preflight.case_id,
            "run": {
                "run_id": preflight.run_id,
                **dict(preflight.pipeline_fingerprints),
                "runtime_input": preflight.result.runtime_input(),
                "generated_sql": validated.validated_sql,
                "failure_stage": self.failure_stage or "none",
                "failure_code": self.failure_code or "",
                "sql_execution_succeeded": True,
                "actual_rows": [list(row) for row in result.rows],
                "unauthorized_reference": False,
                "dangerous_sql": False,
                "scan_limit_exceeded": False,
                "semantic_error": False,
                "render_succeeded": self.render_succeeded,
                "bytes_processed": bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def _render_attempt(
    attempt: ResultValidationAttempt,
    renderer: Callable[[dict[str, Any]], bool],
) -> RenderingAttempt:
    if not attempt.succeeded:
        return RenderingAttempt(
            attempt,
            False,
            failure_stage=attempt.failure_stage,
            failure_code=attempt.failure_code,
        )

    if (
        attempt.rows is None
        or attempt.columns is None
        or attempt.visualization is None
    ):
        raise ValueError("successful result validation output is incomplete")
    payload = {
        "visualization": attempt.visualization,
        "columns": list(attempt.columns),
        "rows": [list(row) for row in attempt.rows],
    }
    if renderer(payload) is not True:
        return RenderingAttempt(
            attempt,
            False,
            failure_stage=RENDERING_FAILURE,
            failure_code=RENDERING_FAILURE_CODE,
        )
    return RenderingAttempt(attempt, True)


def run_manifest_rendering(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    result_runner: Callable[..., tuple[ResultValidationAttempt, ...]] = (
        run_manifest_result_validation
    ),
    renderer: Callable[[dict[str, Any]], bool] = run_renderer_probe,
) -> tuple[RenderingAttempt, ...]:
    """Validate manifest results and render only successful attempts."""
    attempts = result_runner(
        manifest,
        bq,
        vertex,
        model,
        as_of=as_of,
    )
    return tuple(_render_attempt(attempt, renderer) for attempt in attempts)

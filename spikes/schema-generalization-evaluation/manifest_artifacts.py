"""Build and securely write assembler inputs from completed manifest attempts."""

from __future__ import annotations

import json
import math
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

from bigquery_scope_discovery import AuthorizedScope
from manifest_preflight import planned_inputs
from manifest_rendering import RenderingAttempt, run_manifest_rendering
from run_outcome import (
    ANALYSIS_CONTRACT_GENERATION_FAILURE,
    SCOPE_DISCOVERY_FAILURE,
)


ARTIFACT_FILENAMES = {
    "recordings": "recorded-runs.json",
    "scope_snapshots": "scope-snapshots.json",
    "analysis_contracts": "analysis-contracts.json",
}


class ManifestArtifactError(ValueError):
    """Completed attempts cannot form one internally consistent artifact set."""


@dataclass(frozen=True)
class RunMeasurement:
    """Externally measured accounting for one planned run."""

    bytes_processed: int
    cost_jpy: int | float


@dataclass(frozen=True)
class ManifestArtifacts:
    """The three runtime-produced inputs consumed by the evidence assembler."""

    recordings: dict[str, Any]
    scope_snapshots: dict[str, Any]
    analysis_contracts: dict[str, Any]


def _preflight(attempt: RenderingAttempt):
    return (
        attempt.result_attempt.execution_attempt.dry_run_attempt.validated_attempt
        .generated_attempt.planned_attempt.preflight_attempt
    )


def _identity(attempt: RenderingAttempt) -> tuple[str, str, str]:
    preflight = _preflight(attempt)
    return preflight.schema_id, preflight.case_id, preflight.run_id


def _measurement(value: Any) -> RunMeasurement:
    if (
        not isinstance(value, RunMeasurement)
        or type(value.bytes_processed) is not int
        or value.bytes_processed < 0
        or isinstance(value.cost_jpy, bool)
        or not isinstance(value.cost_jpy, (int, float))
        or not math.isfinite(value.cost_jpy)
        or value.cost_jpy < 0
    ):
        raise ManifestArtifactError(
            "run measurements must contain non-negative bytes and finite cost"
        )
    return value


def _retain_unique(
    target: dict[Any, dict[str, Any]],
    key: Any,
    entry: dict[str, Any],
    message: str,
) -> None:
    previous = target.get(key)
    if previous is not None and previous != entry:
        raise ManifestArtifactError(message)
    target[key] = entry


def build_manifest_artifacts(
    manifest: Any,
    attempts: Sequence[RenderingAttempt],
    measurements: Mapping[tuple[str, str, str], RunMeasurement],
) -> ManifestArtifacts:
    """Bind every planned attempt and measured cost to assembler-ready values."""
    _, planned = planned_inputs(manifest)
    planned_ids = [(schema, case, run) for schema, case, run, _, _ in planned]
    if not isinstance(attempts, Sequence) or not isinstance(measurements, Mapping):
        raise ManifestArtifactError("attempts and measurements must be bounded collections")

    observed: dict[tuple[str, str, str], RenderingAttempt] = {}
    try:
        for attempt in attempts:
            if not isinstance(attempt, RenderingAttempt):
                raise ManifestArtifactError("all attempts must be rendering attempts")
            identity = _identity(attempt)
            if identity in observed:
                raise ManifestArtifactError("attempts must match planned runs exactly")
            observed[identity] = attempt
        if set(observed) != set(planned_ids):
            raise ManifestArtifactError("attempts must match planned runs exactly")
        if set(measurements) != set(planned_ids):
            raise ManifestArtifactError("measurements must match planned runs exactly")
    except TypeError:
        raise ManifestArtifactError("attempts and measurements are invalid") from None

    recordings = []
    snapshots: dict[str, dict[str, Any]] = {}
    contracts: dict[tuple[str, str], dict[str, Any]] = {}
    for identity in planned_ids:
        attempt = observed[identity]
        measurement = _measurement(measurements[identity])
        try:
            recorded = attempt.recording(
                bytes_processed=measurement.bytes_processed,
                cost_jpy=measurement.cost_jpy,
            )
        except (TypeError, ValueError) as error:
            raise ManifestArtifactError(str(error)) from None
        if (recorded["schema_id"], recorded["case_id"], recorded["run"]["run_id"]) != identity:
            raise ManifestArtifactError("recording identity differs from its planned run")
        recordings.append(recorded)

        preflight = _preflight(attempt)
        scope_entry = preflight.result.scope_snapshot_entry(preflight.schema_id)
        contract_entry = preflight.result.analysis_contract_entry(
            preflight.schema_id, preflight.case_id
        )
        stage = recorded["run"]["failure_stage"]
        if stage == SCOPE_DISCOVERY_FAILURE:
            if scope_entry is not None or contract_entry is not None:
                raise ManifestArtifactError("scope failure contains unavailable artifacts")
            continue
        if scope_entry is None:
            raise ManifestArtifactError("completed scope discovery has no snapshot")
        _retain_unique(
            snapshots,
            preflight.schema_id,
            scope_entry,
            "scope snapshot changed within one schema evaluation",
        )
        if stage == ANALYSIS_CONTRACT_GENERATION_FAILURE:
            if contract_entry is not None:
                raise ManifestArtifactError(
                    "contract generation failure contains an unavailable contract"
                )
            continue
        if contract_entry is None:
            raise ManifestArtifactError("completed contract generation has no contract")
        _retain_unique(
            contracts,
            (preflight.schema_id, preflight.case_id),
            contract_entry,
            "analysis contract changed within one case evaluation",
        )

    return ManifestArtifacts(
        recordings={
            "version": 5,
            "evaluation_plan_sha256": manifest["evaluation_plan_sha256"],
            "runs": recordings,
        },
        scope_snapshots={"version": 1, "snapshots": list(snapshots.values())},
        analysis_contracts={"version": 1, "contracts": list(contracts.values())},
    )


def write_manifest_artifacts(
    output_directory: str | Path, artifacts: ManifestArtifacts
) -> dict[str, Path]:
    """Create a private output directory without overwriting existing paths."""
    if not isinstance(artifacts, ManifestArtifacts):
        raise TypeError("manifest artifacts are required")
    output = Path(output_directory)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    paths: dict[str, Path] = {}
    try:
        for name, filename in ARTIFACT_FILENAMES.items():
            path = output / filename
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            paths[name] = path
            with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                json.dump(
                    getattr(artifacts, name),
                    target,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
    except Exception:
        for path in paths.values():
            path.unlink(missing_ok=True)
        output.rmdir()
        raise
    return paths


def _single_run_manifest(
    manifest: dict[str, Any],
    schema_id: str,
    case_id: str,
    run_id: str,
    scope: AuthorizedScope,
    question: str,
) -> dict[str, Any]:
    return {
        "version": manifest["version"],
        "evaluation_plan_sha256": manifest["evaluation_plan_sha256"],
        "pipeline": dict(manifest["pipeline"]),
        "schemas": [
            {
                "schema_id": schema_id,
                "authorized_scope": {
                    "datasets": sorted(scope.datasets),
                    "tables": sorted(scope.tables),
                },
                "cases": [
                    {
                        "case_id": case_id,
                        "question": question,
                        "run_ids": [run_id],
                    }
                ],
            }
        ],
    }


def _measure_attempt(
    identity: tuple[str, str, str],
    single_manifest: dict[str, Any],
    bq,
    vertex,
    model: str,
    as_of: date,
    meter: Callable[
        [tuple[str, str, str], Callable[[], RenderingAttempt]], RunMeasurement
    ],
    rendering_runner: Callable[..., tuple[RenderingAttempt, ...]],
) -> tuple[RenderingAttempt, RunMeasurement]:
    execution_count = 0
    observed: RenderingAttempt | None = None

    def execute() -> RenderingAttempt:
        nonlocal execution_count, observed
        execution_count += 1
        if execution_count != 1:
            raise ManifestArtifactError(
                "meter must execute each planned run exactly once"
            )
        result = rendering_runner(
            single_manifest,
            bq,
            vertex,
            model,
            as_of=as_of,
        )
        if (
            not isinstance(result, tuple)
            or len(result) != 1
            or not isinstance(result[0], RenderingAttempt)
            or _identity(result[0]) != identity
        ):
            raise ManifestArtifactError(
                "rendering result must match its measured planned run"
            )
        observed = result[0]
        return observed

    measurement = meter(identity, execute)
    if execution_count != 1 or observed is None:
        raise ManifestArtifactError("meter must execute each planned run exactly once")
    return observed, _measurement(measurement)


def run_measured_manifest_evaluation(
    manifest: Any,
    bq,
    vertex,
    model: str,
    *,
    as_of: date,
    output_directory: str | Path,
    meter: Callable[
        [tuple[str, str, str], Callable[[], RenderingAttempt]], RunMeasurement
    ],
    rendering_runner: Callable[..., tuple[RenderingAttempt, ...]] = (
        run_manifest_rendering
    ),
) -> dict[str, Path]:
    """Run each planned identity once inside an external measurement boundary."""
    _, planned = planned_inputs(manifest)
    output = Path(output_directory)
    if os.path.lexists(output):
        raise FileExistsError(output)
    if not output.parent.is_dir():
        raise FileNotFoundError(output.parent)
    if (
        not isinstance(model, str)
        or not model.strip()
        or not isinstance(as_of, date)
        or not callable(meter)
        or not callable(rendering_runner)
    ):
        raise ManifestArtifactError("measured evaluation inputs are invalid")

    attempts: list[RenderingAttempt] = []
    measurements: dict[tuple[str, str, str], RunMeasurement] = {}
    for schema_id, case_id, run_id, scope, question in planned:
        identity = (schema_id, case_id, run_id)
        single_manifest = _single_run_manifest(
            manifest, schema_id, case_id, run_id, scope, question
        )
        attempt, measurement = _measure_attempt(
            identity,
            single_manifest,
            bq,
            vertex,
            model,
            as_of,
            meter,
            rendering_runner,
        )
        attempts.append(attempt)
        measurements[identity] = measurement

    artifacts = build_manifest_artifacts(manifest, attempts, measurements)
    return write_manifest_artifacts(output, artifacts)

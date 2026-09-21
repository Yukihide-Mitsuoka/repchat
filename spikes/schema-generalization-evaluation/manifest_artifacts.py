"""Build and securely write assembler inputs from completed manifest attempts."""

from __future__ import annotations

import json
import math
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from manifest_preflight import planned_inputs
from manifest_rendering import RenderingAttempt
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

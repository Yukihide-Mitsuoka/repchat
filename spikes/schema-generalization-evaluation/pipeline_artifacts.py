"""Bind evaluation runs to the exact local pipeline artifacts they used."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Mapping

from evaluate import EvaluationEvidenceError


PIPELINE_ARTIFACT_NAMES = ("runtime", "prompt", "configuration")


def fingerprint_pipeline_artifacts(
    paths: Mapping[str, Path],
) -> dict[str, str]:
    """Return SHA-256 fingerprints without exposing artifact contents."""
    if set(paths) != set(PIPELINE_ARTIFACT_NAMES):
        raise EvaluationEvidenceError(
            "runtime, prompt, and configuration artifacts are required"
        )

    fingerprints: dict[str, str] = {}
    for name in PIPELINE_ARTIFACT_NAMES:
        path = paths[name]
        if not path.is_file() or path.stat().st_size == 0:
            raise EvaluationEvidenceError(
                f"{name} artifact must be a non-empty regular file"
            )
        with path.open("rb") as artifact:
            fingerprints[name] = hashlib.file_digest(artifact, "sha256").hexdigest()
    return fingerprints

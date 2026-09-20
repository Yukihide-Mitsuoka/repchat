"""Validate source-independent evaluation run outcome metadata."""

from __future__ import annotations

import re
from typing import Any


NO_FAILURE = "none"
FAILURE_STAGES = (
    "planning",
    "sql_generation",
    "sql_validation",
    "dry_run",
    "execution",
    "result_validation",
    "rendering",
)
SAFE_FAILURE_CODE = re.compile(r"[a-z][a-z0-9_]{0,63}")


class RunOutcomeError(ValueError):
    """A run's stage metadata conflicts with its recorded outcome."""


def validate_run_outcome(run: dict[str, Any]) -> None:
    """Require one safe stage/code pair consistent with observable run fields."""
    stage = run["failure_stage"]
    code = run["failure_code"]
    if not isinstance(stage, str) or stage not in {NO_FAILURE, *FAILURE_STAGES}:
        raise RunOutcomeError("failure stage is unsupported")
    if not isinstance(code, str) or (
        code and SAFE_FAILURE_CODE.fullmatch(code) is None
    ):
        raise RunOutcomeError(
            "failure code must be an empty value or a safe machine code"
        )

    executed = run["sql_execution_succeeded"]
    rendered = run["render_succeeded"]
    sql = run["generated_sql"]
    rows = run["actual_rows"]
    bytes_processed = run["bytes_processed"]
    if stage == NO_FAILURE:
        valid = code == "" and bool(sql.strip()) and executed and rendered
    elif not code or rendered:
        valid = False
    elif stage in {"planning", "sql_generation"}:
        valid = not sql and not executed and not rows and bytes_processed == 0
    elif stage in {"sql_validation", "dry_run"}:
        valid = bool(sql.strip()) and not executed and not rows and bytes_processed == 0
    elif stage == "execution":
        valid = bool(sql.strip()) and not executed and not rows
    else:
        valid = bool(sql.strip()) and executed
    if not valid:
        raise RunOutcomeError("run outcome conflicts with its failure stage")

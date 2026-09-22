"""Serialize and validate closed SQL diagnostics in evaluation recordings."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

from sql_diagnostic import (  # noqa: E402 - sibling spike import after path setup
    SQLDiagnostic,
    SQLDiagnosticCategory,
    SQLDiagnosticCode,
    sql_diagnostic,
)


DIAGNOSTIC_KEYS = {"code", "category"}
SAFETY_FLAGS = {
    SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE: "unauthorized_reference",
    SQLDiagnosticCategory.DANGEROUS_SQL: "dangerous_sql",
    SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED: "scan_limit_exceeded",
}
SQL_FAILURE_STAGES = frozenset({"sql_validation", "dry_run", "execution"})


class RecordedDiagnosticError(ValueError):
    """A recording contains a diagnostic outside the closed SQL contract."""


def serialize_sql_diagnostic(
    diagnostic: SQLDiagnostic | None,
) -> dict[str, str] | None:
    """Persist only closed identifiers, not a display or provider message."""
    if diagnostic is None:
        return None
    if not isinstance(diagnostic, SQLDiagnostic):
        raise RecordedDiagnosticError("recorded diagnostic must use the closed SQL type")
    if diagnostic != sql_diagnostic(diagnostic.code):
        raise RecordedDiagnosticError("SQL diagnostic fields are inconsistent")
    return {"code": diagnostic.code.value, "category": diagnostic.category.value}


def _diagnostic_stage(code: SQLDiagnosticCode) -> str:
    if code.value.startswith("dry_run_"):
        return "dry_run"
    if code.value.startswith("execution_"):
        return "execution"
    return "sql_validation"


def validate_recorded_diagnostic(run: dict[str, Any]) -> None:
    """Reject unknown, mismatched, or unsafe diagnostic outcome metadata."""
    value = run["diagnostic"]
    safety_flags = {name for name in SAFETY_FLAGS.values() if run[name] is True}
    if value is None:
        if safety_flags:
            raise RecordedDiagnosticError("safety evidence requires a matching diagnostic")
        if (
            run["failure_stage"] in SQL_FAILURE_STAGES
            and run["semantic_error"] is not True
        ):
            raise RecordedDiagnosticError(
                "SQL boundary failure requires a diagnostic or semantic error"
            )
        return
    if not isinstance(value, dict) or set(value) != DIAGNOSTIC_KEYS:
        raise RecordedDiagnosticError("diagnostic must contain only code and category")
    try:
        code = SQLDiagnosticCode(value["code"])
        category = SQLDiagnosticCategory(value["category"])
    except (TypeError, ValueError):
        raise RecordedDiagnosticError("diagnostic code or category is unsupported") from None
    if sql_diagnostic(code).category is not category:
        raise RecordedDiagnosticError("diagnostic code and category are inconsistent")
    if run["failure_stage"] == "none":
        raise RecordedDiagnosticError("successful runs cannot contain a diagnostic")
    if _diagnostic_stage(code) != run["failure_stage"]:
        raise RecordedDiagnosticError("diagnostic code does not match failure stage")
    expected = SAFETY_FLAGS.get(category)
    if safety_flags != ({expected} if expected else set()):
        raise RecordedDiagnosticError("safety evidence requires a matching diagnostic")

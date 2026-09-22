"""Closed, target-independent diagnostics shared by SQL execution boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class SQLDiagnosticCategory(str, Enum):
    """Closed safety categories consumed without parsing diagnostic prose."""

    INVALID_REQUEST = "invalid_request"
    UNAUTHORIZED_REFERENCE = "unauthorized_reference"
    DANGEROUS_SQL = "dangerous_sql"
    SCAN_LIMIT_EXCEEDED = "scan_limit_exceeded"
    PROVIDER_FAILURE = "provider_failure"
    INFRASTRUCTURE_FAILURE = "infrastructure_failure"
    CANCELLED = "cancelled"


class SQLDiagnosticCode(str, Enum):
    """Closed local SQL refusal codes independent of analysis targets."""

    ANALYSIS_CONTRACT_REQUIRED = "analysis_contract_required"
    NOT_SELECT = "not_select"
    MULTIPLE_STATEMENTS = "multiple_statements"
    FORBIDDEN_KEYWORD = "forbidden_keyword"
    SELECT_STAR = "select_star"
    TABLE_DECORATOR_OUTSIDE_SCOPE = "table_decorator_outside_scope"
    TABLE_OUTSIDE_SCOPE = "table_outside_scope"
    CONTRACT_TABLE_REQUIRED = "contract_table_required"
    SCHEMA_POLICY_MISMATCH = "schema_policy_mismatch"
    DRY_RUN_STATEMENT_NOT_SELECT = "dry_run_statement_not_select"
    DRY_RUN_REFERENCES_MISSING = "dry_run_references_missing"
    DRY_RUN_REFERENCE_INCOMPLETE = "dry_run_reference_incomplete"
    DRY_RUN_TABLE_OUTSIDE_SCOPE = "dry_run_table_outside_scope"
    DRY_RUN_BYTES_MISSING = "dry_run_bytes_missing"
    DRY_RUN_SCAN_LIMIT_EXCEEDED = "dry_run_scan_limit_exceeded"
    DRY_RUN_PROVIDER_FAILURE = "dry_run_provider_failure"
    EXECUTION_BYTES_MISSING = "execution_bytes_missing"
    EXECUTION_SCAN_LIMIT_EXCEEDED = "execution_scan_limit_exceeded"
    EXECUTION_CANCELLED = "execution_cancelled"
    EXECUTION_TIMEOUT = "execution_timeout"
    EXECUTION_PROVIDER_FAILURE = "execution_provider_failure"


_SQL_DIAGNOSTICS = {
    SQLDiagnosticCode.ANALYSIS_CONTRACT_REQUIRED: (
        SQLDiagnosticCategory.INVALID_REQUEST,
        "rejected: analysis contract required",
    ),
    SQLDiagnosticCode.NOT_SELECT: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "rejected: not a SELECT",
    ),
    SQLDiagnosticCode.MULTIPLE_STATEMENTS: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "rejected: multiple statements",
    ),
    SQLDiagnosticCode.FORBIDDEN_KEYWORD: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "rejected: forbidden keyword",
    ),
    SQLDiagnosticCode.SELECT_STAR: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "rejected: SELECT * anti-pattern",
    ),
    SQLDiagnosticCode.TABLE_DECORATOR_OUTSIDE_SCOPE: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "rejected: table decorator is outside the analysis contract",
    ),
    SQLDiagnosticCode.TABLE_OUTSIDE_SCOPE: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "rejected: table is outside the analysis contract",
    ),
    SQLDiagnosticCode.CONTRACT_TABLE_REQUIRED: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "rejected: query must reference an analysis contract table",
    ),
    SQLDiagnosticCode.SCHEMA_POLICY_MISMATCH: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "rejected: schema policyとSQLを照合できません。",
    ),
    SQLDiagnosticCode.DRY_RUN_STATEMENT_NOT_SELECT: (
        SQLDiagnosticCategory.DANGEROUS_SQL,
        "bq dry-run rejected: statement type must be SELECT",
    ),
    SQLDiagnosticCode.DRY_RUN_REFERENCES_MISSING: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "bq dry-run rejected: referenced tables were not returned",
    ),
    SQLDiagnosticCode.DRY_RUN_REFERENCE_INCOMPLETE: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "bq dry-run rejected: referenced table identity is incomplete",
    ),
    SQLDiagnosticCode.DRY_RUN_TABLE_OUTSIDE_SCOPE: (
        SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,
        "bq dry-run rejected: table is outside the analysis contract",
    ),
    SQLDiagnosticCode.DRY_RUN_BYTES_MISSING: (
        SQLDiagnosticCategory.PROVIDER_FAILURE,
        "bq dry-run rejected: bytes processed were not returned",
    ),
    SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED: (
        SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED,
        "bq dry-run rejected: scan limit exceeded",
    ),
    SQLDiagnosticCode.DRY_RUN_PROVIDER_FAILURE: (
        SQLDiagnosticCategory.PROVIDER_FAILURE,
        "bq dry-run error: provider request failed",
    ),
    SQLDiagnosticCode.EXECUTION_BYTES_MISSING: (
        SQLDiagnosticCategory.PROVIDER_FAILURE,
        "bq execution rejected: bytes processed were not returned",
    ),
    SQLDiagnosticCode.EXECUTION_SCAN_LIMIT_EXCEEDED: (
        SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED,
        "bq execution rejected: scan limit exceeded",
    ),
    SQLDiagnosticCode.EXECUTION_CANCELLED: (
        SQLDiagnosticCategory.CANCELLED,
        "cancelled",
    ),
    SQLDiagnosticCode.EXECUTION_TIMEOUT: (
        SQLDiagnosticCategory.INFRASTRUCTURE_FAILURE,
        "bq error: TimeoutError: query exceeded 180 seconds",
    ),
    SQLDiagnosticCode.EXECUTION_PROVIDER_FAILURE: (
        SQLDiagnosticCategory.PROVIDER_FAILURE,
        "bq error: provider request failed",
    ),
}


@dataclass(frozen=True)
class SQLDiagnostic:
    """One validated code/category/message tuple from the closed SQL contract."""

    code: SQLDiagnosticCode
    category: SQLDiagnosticCategory
    message: str

    def __post_init__(self) -> None:
        if not isinstance(self.code, SQLDiagnosticCode):
            raise TypeError("SQL diagnostic code must be a closed enum value")
        if not isinstance(self.category, SQLDiagnosticCategory):
            raise TypeError("SQL diagnostic category must be a closed enum value")
        if _SQL_DIAGNOSTICS[self.code] != (self.category, self.message):
            raise ValueError("SQL diagnostic code, category, and message disagree")


def sql_diagnostic(code: SQLDiagnosticCode) -> SQLDiagnostic:
    """Build the only category and safe message permitted for a known code."""
    if not isinstance(code, SQLDiagnosticCode):
        raise TypeError("SQL diagnostic code must be a closed enum value")
    category, message = _SQL_DIAGNOSTICS[code]
    return SQLDiagnostic(code, category, message)

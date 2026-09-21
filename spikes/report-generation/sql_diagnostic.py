"""Closed, target-independent diagnostics shared by SQL execution boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class SQLDiagnosticCategory(str, Enum):
    """Closed safety categories consumed without parsing diagnostic prose."""

    INVALID_REQUEST = "invalid_request"
    UNAUTHORIZED_REFERENCE = "unauthorized_reference"
    DANGEROUS_SQL = "dangerous_sql"


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

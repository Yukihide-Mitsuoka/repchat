"""Validate contract-bound result columns without analysis-target knowledge."""

from __future__ import annotations

import re

from analysis_contract_context import AnalysisExecutionPolicy
from bigquery_schema_snapshot import FIELD_TYPES


DIAGNOSTIC = "共通分析契約の結果形状とBigQuery出力を照合できません。"
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_SCALAR_TYPES = FIELD_TYPES - {"RECORD", "STRUCT"}


def _terms(section: dict, key: str, allowed: frozenset[str]) -> list[str]:
    values = section.get(key)
    if (
        not isinstance(values, list)
        or any(not isinstance(value, str) or not value or value not in allowed for value in values)
    ):
        raise ValueError
    return values


def _columns(columns: object) -> list[tuple[str, str | None, str | None]]:
    if not isinstance(columns, list):
        raise ValueError
    result = []
    for field in columns:
        if isinstance(field, str):
            result.append((field, None, None))
            continue
        if not isinstance(field, (list, tuple)) or len(field) not in {2, 3}:
            raise ValueError
        name, field_type = field[:2]
        mode = field[2] if len(field) == 3 else "NULLABLE"
        if (
            not isinstance(name, str)
            or not isinstance(field_type, str)
            or field_type.upper() not in _SCALAR_TYPES
            or mode not in {"NULLABLE", "REQUIRED"}
        ):
            raise ValueError
        result.append((name, field_type.upper(), mode))
    return result


def contract_result_diagnostic(
    section: dict,
    columns: object,
    execution: AnalysisExecutionPolicy,
) -> str:
    """Return a stable refusal for semantic or physical result-shape drift."""
    if (
        execution.result is None
        or not isinstance(section, dict)
        or not section.get("source_columns")
    ):
        return ""
    try:
        _terms(section, "semantic_dimensions", execution.result.dimensions)
        _terms(section, "semantic_measures", execution.result.measures)
        expected = section.get("source_columns")
        if (
            not isinstance(expected, list)
            or not expected
            or any(not isinstance(name, str) or not _IDENTIFIER.fullmatch(name) for name in expected)
            or len({name.casefold() for name in expected}) != len(expected)
        ):
            raise ValueError
        observed = _columns(columns)
        if [name.casefold() for name, _type, _mode in observed] != [
            name.casefold() for name in expected
        ]:
            raise ValueError
    except (TypeError, ValueError):
        return DIAGNOSTIC
    return ""

"""Validate SQL scan bounds derived from one canonical analysis contract."""

from __future__ import annotations

import re
from datetime import date, timedelta

from analysis_contract_context import (
    AnalysisExecutionPolicy,
    AnalysisPeriodConstraint,
    AnalysisPeriodPolicy,
)


_CLAUSE_BOUNDARIES = {
    "EXCEPT",
    "GROUP",
    "HAVING",
    "INTERSECT",
    "LIMIT",
    "ORDER",
    "QUALIFY",
    "UNION",
    "WINDOW",
}


def _masked(
    sql: str,
    *,
    allowed_literals: frozenset[str] = frozenset(),
    keep_identifiers: bool = True,
) -> str:
    """Blank comments and irrelevant quoted regions without changing offsets."""
    chars = list(sql)
    index = 0
    while index < len(sql):
        if sql.startswith("--", index):
            end = sql.find("\n", index + 2)
            end = len(sql) if end < 0 else end
            chars[index:end] = " " * (end - index)
            index = end
            continue
        if sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            end = len(sql) if end < 0 else end + 2
            chars[index:end] = " " * (end - index)
            index = end
            continue
        quote = sql[index]
        if quote not in {"'", '"', "`"}:
            index += 1
            continue
        end = index + 1
        while end < len(sql):
            if sql[end] == "\\":
                end = min(len(sql), end + 2)
                continue
            if sql[end] == quote:
                if end + 1 < len(sql) and sql[end + 1] == quote:
                    end += 2
                    continue
                end += 1
                break
            end += 1
        value = sql[index + 1 : max(index + 1, end - 1)]
        keep = quote == "`" and keep_identifiers
        keep = keep or (quote != "`" and value in allowed_literals)
        if not keep:
            chars[index:end] = " " * (end - index)
        index = end
    return "".join(chars)


def _where_clauses(sql: str) -> tuple[str, ...]:
    """Return every WHERE body while excluding SELECT expressions and comments."""
    structure = _masked(sql, keep_identifiers=False)
    depths: list[int] = []
    depth = 0
    for character in structure:
        depths.append(depth)
        if character == "(":
            depth += 1
        elif character == ")":
            depth = max(0, depth - 1)
    tokens = [
        (match.group(0).upper(), match.start(), match.end(), depths[match.start()])
        for match in re.finditer(r"\b[A-Za-z_][A-Za-z0-9_]*\b", structure)
    ]
    clauses = []
    for token_index, (keyword, _start, end, where_depth) in enumerate(tokens):
        if keyword != "WHERE":
            continue
        boundaries = [
            start
            for following, start, _following_end, following_depth in tokens[token_index + 1 :]
            if following_depth == where_depth and following in _CLAUSE_BOUNDARIES
        ]
        boundaries.extend(
            index
            for index in range(end, len(structure))
            if structure[index] == ")" and depths[index] == where_depth
        )
        clauses.append(sql[end : min(boundaries, default=len(sql))])
    return tuple(clauses)


def _field_pattern(path: tuple[str, ...]) -> str:
    segments = [rf"(?:`{re.escape(item)}`|{re.escape(item)})" for item in path]
    qualifier = r"(?:(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)*"
    path_pattern = r"\s*\.\s*".join(segments)
    return rf"(?<![A-Za-z0-9_]){qualifier}{path_pattern}(?![A-Za-z0-9_])"


def _next_day(value: str) -> str:
    return (date.fromisoformat(value) + timedelta(days=1)).isoformat()


def _predicate(constraint: AnalysisPeriodConstraint, policy: AnalysisPeriodPolicy) -> str:
    field = ".".join(constraint.path)
    if constraint.field_type == "DATE_SHARD":
        return (
            f"{field} BETWEEN '{policy.start.replace('-', '')}' "
            f"AND '{policy.end.replace('-', '')}'"
        )
    if constraint.field_type == "DATE":
        return f"{field} BETWEEN DATE '{policy.start}' AND DATE '{policy.end}'"
    following = _next_day(policy.end)
    if constraint.field_type == "DATETIME":
        return (
            f"{field} >= DATETIME '{policy.start} 00:00:00' AND "
            f"{field} < DATETIME '{following} 00:00:00'"
        )
    if constraint.field_type == "TIMESTAMP":
        return (
            f"{field} >= TIMESTAMP('{policy.start} 00:00:00', '{policy.timezone}') "
            f"AND {field} < TIMESTAMP('{following} 00:00:00', '{policy.timezone}')"
        )
    raise ValueError("analysis contract period field type is unsupported")


def _pattern(constraint: AnalysisPeriodConstraint, policy: AnalysisPeriodPolicy) -> str:
    field = _field_pattern(constraint.path)
    if constraint.field_type == "DATE_SHARD":
        start, end = policy.start.replace("-", ""), policy.end.replace("-", "")
        return rf"{field}\s+BETWEEN\s+['\"]{start}['\"]\s+AND\s+['\"]{end}['\"]"
    if constraint.field_type == "DATE":
        return (
            rf"{field}\s+BETWEEN\s+DATE\s+['\"]{re.escape(policy.start)}['\"]"
            rf"\s+AND\s+DATE\s+['\"]{re.escape(policy.end)}['\"]"
        )
    following = _next_day(policy.end)
    if constraint.field_type == "DATETIME":
        return (
            rf"{field}\s*>=\s*DATETIME\s+['\"]{re.escape(policy.start)} 00:00:00['\"]"
            rf"\s+AND\s+{field}\s*<\s*DATETIME\s+['\"]{following} 00:00:00['\"]"
        )
    if constraint.field_type == "TIMESTAMP":
        timezone = re.escape(policy.timezone)
        return (
            rf"{field}\s*>=\s*TIMESTAMP\s*\(\s*['\"]{re.escape(policy.start)} 00:00:00['\"]"
            rf"\s*,\s*['\"]{timezone}['\"]\s*\)\s+AND\s+{field}\s*<\s*"
            rf"TIMESTAMP\s*\(\s*['\"]{following} 00:00:00['\"]\s*,\s*['\"]{timezone}['\"]\s*\)"
        )
    raise ValueError("analysis contract period field type is unsupported")


def _allowed_literals(policy: AnalysisPeriodPolicy) -> frozenset[str]:
    following = _next_day(policy.end)
    return frozenset(
        {
            policy.start,
            policy.end,
            following,
            policy.start.replace("-", ""),
            policy.end.replace("-", ""),
            f"{policy.start} 00:00:00",
            f"{following} 00:00:00",
            policy.timezone,
        }
    )


def contract_period_diagnostic(sql: str, execution: AnalysisExecutionPolicy | None) -> str:
    """Describe contract scan bounds missing from actual SQL WHERE clauses."""
    if execution is None or execution.period is None:
        return ""
    policy = execution.period
    schema = {(field.table, field.path): field for field in execution.schema_fields}
    for constraint in policy.constraints:
        field = schema.get((constraint.table, constraint.path))
        expected_type = "STRING" if constraint.field_type == "DATE_SHARD" else constraint.field_type
        if (
            field is None
            or field.field_type != expected_type
            or field.repeated
            or field.restricted
        ):
            return "共通分析契約の期間fieldをschema policyへ安全に照合できないため実行しません。"
    tables = re.findall(
        r"(?:\bFROM|\bJOIN|,)\s+`?([A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_*]+)",
        _masked(sql),
        re.I,
    )
    if len(tables) != 1 or any(item.table not in tables for item in policy.constraints):
        return "共通分析契約の期間・partition制約を複数tableへ安全に照合できないため実行しません。"
    clauses = tuple(
        _masked(clause, allowed_literals=_allowed_literals(policy))
        for clause in _where_clauses(sql)
    )
    missing = []
    try:
        for constraint in policy.constraints:
            if not any(re.search(_pattern(constraint, policy), clause, re.I) for clause in clauses):
                missing.append(f"{constraint.table}.{'.'.join(constraint.path)}")
    except (TypeError, ValueError):
        return "共通分析契約の期間・partition制約を解釈できないため実行しません。"
    if not missing:
        return ""
    return (
        "生成SQLのWHERE句が共通分析契約の期間・partition制約を満たしません。"
        f"不足: {'、'.join(missing)}。"
    )


def contract_period_repair_guidance(policy: AnalysisPeriodPolicy | None) -> str:
    """Return deterministic repair text from the same source-independent policy."""
    if policy is None:
        return ""
    try:
        predicates = " AND ".join(_predicate(item, policy) for item in policy.constraints)
    except (TypeError, ValueError):
        return "共通分析契約の期間・partition制約を変更せずWHERE句へ適用する。"
    return (
        f"WHERE句で {predicates} を使う。scan範囲を狭めず、"
        "部分期間の比較は条件付き集約で表現する。"
    )

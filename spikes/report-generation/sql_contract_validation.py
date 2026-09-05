"""Validate generated dashboard SQL against the confirmed visualization contract."""

from __future__ import annotations

import re
from typing import Callable


class SQLContractError(ValueError):
    """Raised when generated SQL cannot satisfy its confirmed execution contract."""


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Fail closed when generated SQL does not use the requested date shard."""
    ranges = re.findall(
        r"_TABLE_SUFFIX\s+BETWEEN\s+['\"](\d{8})['\"]\s+AND\s+['\"](\d{8})['\"]",
        sql,
        flags=re.IGNORECASE,
    )
    expected = (period["from"], period["to"])
    if not ranges or any(found != expected for found in ranges):
        raise SQLContractError(
            f"生成SQLの対象期間が問い合わせの{period['label']}と一致しません。"
        )


def sql_period_diagnostic(
    sql: str,
    period: dict[str, str],
    require_period: Callable[[str, dict[str, str]], None] = require_sql_period,
) -> str:
    """Return a repair diagnostic without changing the fail-closed contract."""
    try:
        require_period(sql, period)
    except (SQLContractError, ValueError) as error:
        return str(error)
    return ""


def top_level_select_expressions(sql: str) -> tuple[list[str], str]:
    """Return the final SELECT expressions and its top-level suffix."""
    structure = re.sub(
        r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|--[^\n]*|/\*[\s\S]*?\*/",
        lambda match: " " * len(match.group(0)),
        sql,
    )
    depth = 0
    depths = []
    for char in structure:
        depths.append(depth)
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
    tokens = [
        (match.group(0).upper(), match.start(), match.end())
        for match in re.finditer(r"\b[A-Za-z_][A-Za-z0-9_]*\b", structure)
        if depths[match.start()] == 0
    ]
    selects = [token for token in tokens if token[0] == "SELECT"]
    if not selects:
        raise SQLContractError("生成SQLの最終SELECTを解析できないためBigQueryへ送信しません。")
    select = selects[-1]
    following = [token for token in tokens if token[1] > select[2]]
    boundary = next(
        (token for token in following if token[0] in {"FROM", "UNION"}),
        ("END", len(sql), len(sql)),
    )
    clause = sql[select[2] : boundary[1]]
    expressions, start, nested = [], 0, 0
    for index, char in enumerate(structure[select[2] : boundary[1]]):
        if char == "(":
            nested += 1
        elif char == ")":
            nested = max(0, nested - 1)
        elif char == "," and nested == 0:
            expressions.append(clause[start:index].strip())
            start = index + 1
    expressions.append(clause[start:].strip())
    suffix_chars, nested = [], 0
    for char in structure[boundary[1] :]:
        if char == "(":
            nested += 1
            suffix_chars.append(" ")
        elif char == ")":
            nested = max(0, nested - 1)
            suffix_chars.append(" ")
        else:
            suffix_chars.append(char if nested == 0 else " ")
    return [expression for expression in expressions if expression], "".join(suffix_chars)


def validate_generated_dashboard_sql(section: dict, sql: str) -> None:
    """Reject SQL that cannot satisfy the confirmed renderer before BigQuery runs."""
    planned = section.get("planned_visualization")
    expected = section.get("source_columns")
    if not planned or not expected:
        return
    expressions, suffix = top_level_select_expressions(sql)
    _validate_output_aliases(section, expressions)
    _validate_nonnull_metrics(section, expressions)
    _validate_result_row_limit(section, suffix)
    _validate_single_aggregate(section, expressions, suffix)


def _validate_output_aliases(section: dict, expressions: list[str]) -> None:
    """Require unique ASCII aliases before later checks address expressions by position."""
    planned = section["planned_visualization"]
    expected = section["source_columns"]
    aliases = []
    for expression in expressions:
        match = re.search(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", expression, re.I)
        aliases.append(match.group(1).lower() if match else "")
    if (
        len(aliases) != len(expected)
        or any(not alias for alias in aliases)
        or len(set(aliases)) != len(aliases)
    ):
        observed = "、".join(alias or "別名なし" for alias in aliases)
        raise SQLContractError(
            f"{section['title']}のSQL出力列（{observed}）は、{planned}に必要な"
            f"{len(expected)}列の一意なASCII別名を満たさないためBigQueryへ送信しません。"
        )


def _validate_nonnull_metrics(section: dict, expressions: list[str]) -> None:
    """Enforce NULL protection only for metrics declared by the render contract."""
    expected = section["source_columns"]
    nonnull_columns = section.get("nonnull_metric_columns", [])
    unsafe_columns = []
    for column in nonnull_columns:
        index = expected.index(column)
        expression = re.sub(
            r"\bAS\s+[A-Za-z_][A-Za-z0-9_]*\s*$", "", expressions[index], flags=re.I
        ).strip()
        if not re.match(
            r"^(?:(?:COUNT|COUNTIF|COALESCE|IFNULL)\s*\(|"
            r"(?:CAST|SAFE_CAST)\s*\(\s*(?:COUNT|COUNTIF)\s*\()",
            expression,
            re.I,
        ):
            unsafe_columns.append(column)
    if unsafe_columns:
        raise SQLContractError(
            f"{section['title']}のSQL指標列（{'、'.join(unsafe_columns)}）がNULLを"
            "返し得るためBigQueryへ送信しません。COUNT/COUNTIFを使うか、"
            "最終SELECT式全体をCOALESCEまたはIFNULLで包んでください。"
        )


def _validate_result_row_limit(section: dict, suffix: str) -> None:
    """Require bounded final results without treating CTE clauses as outer bounds."""
    planned = section["planned_visualization"]
    max_rows = section.get("max_result_rows")
    if planned not in {"scorecard", "kpi_group"} and isinstance(max_rows, int):
        limit = re.search(r"\bLIMIT\s+([0-9]+)\b", suffix, re.I)
        if (
            not re.search(r"\bORDER\s+BY\b", suffix, re.I)
            or not limit
            or not 1 <= int(limit.group(1)) <= max_rows
        ):
            raise SQLContractError(
                f"{section['title']}のSQLに{planned}用のORDER BYとLIMIT "
                f"{max_rows}以下がないためBigQueryへ送信しません。"
            )


def _validate_single_aggregate(section: dict, expressions: list[str], suffix: str) -> None:
    """Keep scalar displays to one aggregate row rather than grouped or window rows."""
    planned = section["planned_visualization"]
    if planned in {"scorecard", "kpi_group", "delta"}:
        aggregate_pattern = re.compile(
            r"\b(?:COUNT|COUNTIF|SUM|AVG|MIN|MAX|ANY_VALUE|LOGICAL_AND|LOGICAL_OR|APPROX_[A-Z_]+)\s*\(",
            re.I,
        )
        has_aggregate = all(aggregate_pattern.search(expression) for expression in expressions)
        if (
            not has_aggregate
            or re.search(r"\bGROUP\s+BY\b", suffix, re.I)
            or any(re.search(r"\bOVER\s*\(", expression, re.I) for expression in expressions)
        ):
            raise SQLContractError(
                f"{section['title']}のSQLが{planned}用の単一集計行になっていないため"
                "BigQueryへ送信しません。"
            )


def validate_dashboard_dry_run_schema(section: dict, schema: list[tuple[str, str]]) -> None:
    """Check BigQuery's cost-free dry-run schema against the confirmed renderer."""
    planned = section.get("planned_visualization")
    expected = section.get("source_columns")
    if not planned or not expected:
        return
    names = [name.lower() for name, _field_type in schema]
    types = [field_type.upper() for _name, field_type in schema]
    numeric = {"INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"}
    valid = len(names) == len(expected) and all(names) and len(set(names)) == len(names)
    if planned == "scorecard":
        valid = valid and types[0] in numeric
    elif planned in {"kpi_group", "histogram"}:
        valid = valid and all(field_type in numeric for field_type in types)
    elif planned in {"bar", "donut", "funnel", "funnel_horizontal"}:
        valid = valid and types[1] in numeric
    elif planned in {"grouped_bar", "stacked_bar", "percent_stacked_bar"}:
        valid = valid and all(field_type in numeric for field_type in types[1:])
    elif planned in {"line", "area", "calendar_heatmap", "sparkline"}:
        valid = valid and types[0] in {"DATE", "DATETIME", "TIMESTAMP"} and types[1] in numeric
    elif planned in {"multi_line", "stacked_area", "percent_stacked_area"}:
        valid = (
            valid
            and types[0] in {"DATE", "DATETIME", "TIMESTAMP"}
            and all(field_type in numeric for field_type in types[1:])
        )
    elif planned in {"scatter", "bubble"}:
        dimension_count = section.get("dimension_count", 1)
        valid = (
            valid
            and (dimension_count == 1 or types[1] == "STRING")
            and all(field_type in numeric for field_type in types[dimension_count:])
        )
    elif planned == "heatmap":
        valid = valid and types[2] in numeric
    elif planned in {
        "sankey", "sankey_vertical", "flow_sankey", "flow_sankey_vertical", "area_map", "us_map"
    }:
        valid = valid and types[:2] == ["STRING", "STRING"] and types[2] in numeric
    elif planned == "annotated_line":
        valid = (
            valid
            and types[0] in {"DATE", "DATETIME", "TIMESTAMP"}
            and types[1] == "STRING"
            and types[2] in numeric
        )
    elif planned in {"mixed_bar_line", "reference_line", "reference_area"}:
        valid = (
            valid
            and types[0] in {"STRING", "DATE", "DATETIME", "TIMESTAMP"}
            and all(field_type in numeric for field_type in types[1:])
        )
    elif planned == "delta":
        valid = valid and len(types) == 2 and all(field_type in numeric for field_type in types)
    elif planned in {"box_plot", "box_plot_horizontal"}:
        valid = valid and types[0] == "STRING" and all(field_type in numeric for field_type in types[1:])
    elif planned == "treemap":
        dimension_count = section.get("dimension_count", 1)
        valid = (
            valid
            and all(field_type == "STRING" for field_type in types[:dimension_count])
            and types[-1] in numeric
        )
    elif planned == "pie":
        valid = valid and types[0] == "STRING" and types[1] in numeric
    elif planned in {"point_map", "bubble_map"}:
        valid = valid and types[:2] == ["STRING", "STRING"] and all(
            field_type in numeric for field_type in types[2:]
        )
    elif planned == "base_map":
        valid = valid and types[:3] == ["STRING", "STRING", "STRING"] and all(
            field_type in numeric for field_type in types[3:]
        )
    elif planned == "table":
        dimension_count = section.get("dimension_count", 0)
        valid = valid and all(
            field_type in numeric for field_type in types[dimension_count:]
        )
    elif planned == "pivot_table":
        valid = (
            valid
            and all(
                field_type in {"STRING", "DATE", "DATETIME", "TIMESTAMP"} | numeric
                for field_type in types[:2]
            )
            and all(field_type in numeric for field_type in types[2:])
        )
    elif planned == "comparison_table":
        dimension_count = section.get("dimension_count", 1)
        valid = valid and all(
            field_type in numeric for field_type in types[dimension_count:]
        )
    elif planned == "sparkline_table":
        valid = valid and types[0] == "STRING" and types[1] in {
            "DATE", "DATETIME", "TIMESTAMP"
        } and types[2] in numeric
    if not valid:
        observed = "、".join(f"{name}:{field_type}" for name, field_type in schema)
        raise SQLContractError(
            f"{section['title']}のdry run出力（{observed}）が{planned}の描画仕様と"
            "一致しないためBigQueryを実行しません。"
        )

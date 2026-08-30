#!/usr/bin/env python3
"""Shared SQL generation, BigQuery validation, and Evidence rendering helpers.

The executable fixed-report runner was removed. Product analysis starts in the
live consultation flow and requires an AI-authored specification before SQL.
"""
import re
import sys
from pathlib import Path
from bigquery_execution import (
    DATASET,
    MAX_BYTES_BILLED,
    exec_bq,
    inspect_bq_schema,
    validate_sql,
)
from evidence_components import (
    EVIDENCE_COMPONENT,
    SOURCE,
    evidence_component,
    evidence_identifier,
    evidence_query,
)
from evidence_page import (
    GENERATED_SQL_STYLE,
    evidence_page as _evidence_page_impl,
    generated_sql_block as _generated_sql_block_impl,
)
from evidence_output import write_outputs as _write_outputs_impl
from sql_generation import (
    SHAPE_HINT,
    SQLGenerationError,
    SQL_MAX_OUTPUT_TOKENS,
    _JSON_SCHEMA,
    _load_sql_response,
    generate,
    generate_request,
    generation_request,
    repair,
    repair_request,
    repairable_dry_run_error,
)
from sql_prompt_context import SCHEMA_DDL, metrics_block, prompt_rules

HERE = Path(__file__).parent
DEFAULT_MODEL = "gemini-3.6-flash"
USD_JPY = 155.0
PRICING = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
}  # USD per 1M tokens (in, out)

def break_select_columns(sql: str) -> str:
    """Put each expression in every SELECT list on its own logical line."""
    out: list[str] = []
    select_depths: list[int] = []
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(sql):
        char = sql[index]
        if quote:
            out.append(char)
            if char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    out.append(sql[index + 1])
                    index += 1
                else:
                    quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
            out.append(char)
            index += 1
            continue
        if char == "(":
            depth += 1
            out.append(char)
            index += 1
            continue
        if char == ")":
            out.append(char)
            depth = max(0, depth - 1)
            index += 1
            continue
        if char.isalpha() or char == "_":
            end = index + 1
            while end < len(sql) and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            word = sql[index:end]
            upper = word.upper()
            if upper == "SELECT":
                select_depths.append(depth)
            elif upper == "FROM" and select_depths and select_depths[-1] == depth:
                select_depths.pop()
            out.append(word)
            index = end
            continue
        if char == "," and select_depths and select_depths[-1] == depth:
            out.append(",\n" + " " * (4 * (depth + 1)))
            index += 1
            while index < len(sql) and sql[index].isspace():
                index += 1
            continue
        out.append(char)
        index += 1
    return "".join(out)


def sql_parenthesis_delta(line: str) -> int:
    """Count structural parentheses while ignoring quoted SQL content."""
    delta = 0
    quote: str | None = None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char == "-" and index + 1 < len(line) and line[index + 1] == "-":
            break
        elif char == "(":
            delta += 1
        elif char == ")":
            delta -= 1
        index += 1
    return delta


def normalize_sql_indentation(formatted: str, width: int = 4) -> str:
    """Replace visual alignment offsets with structural indentation levels."""
    lines = formatted.replace("\t", " " * width).splitlines()
    normalized: list[str] = []
    depth = 0
    select_contexts: list[dict[str, int | str]] = []
    main_clause = re.compile(
        r"^(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|QUALIFY|LIMIT|"
        r"UNION(?:\s+ALL)?|EXCEPT|INTERSECT)\b",
        flags=re.I,
    )
    join_clause = re.compile(
        r"^(?:(?:LEFT|RIGHT|FULL|INNER|OUTER|CROSS|NATURAL)\s+)?JOIN\b",
        flags=re.I,
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            normalized.append("")
            continue

        leading_closes = len(stripped) - len(stripped.lstrip(")"))
        effective_depth = max(0, depth - leading_closes)
        select_contexts = [
            context
            for context in select_contexts
            if int(context["depth"]) <= effective_depth
        ]
        context = select_contexts[-1] if select_contexts else None
        upper = stripped.upper()

        if re.match(r"^SELECT\b", upper):
            select_contexts = [
                existing
                for existing in select_contexts
                if int(existing["depth"]) < effective_depth
            ]
            context = {"depth": effective_depth, "phase": "select"}
            select_contexts.append(context)
            indent_level = effective_depth
        else:
            clause = main_clause.match(stripped)
            if clause and context:
                indent_level = int(context["depth"])
                keyword = clause.group(1).upper()
                if keyword.startswith("GROUP"):
                    context["phase"] = "group"
                elif keyword.startswith("ORDER"):
                    context["phase"] = "order"
                elif keyword.startswith("FROM"):
                    context["phase"] = "from"
                elif keyword.startswith(("WHERE", "HAVING", "QUALIFY")):
                    context["phase"] = "condition"
                else:
                    context["phase"] = "clause"
            elif join_clause.match(stripped) and context:
                indent_level = int(context["depth"])
                context["phase"] = "from"
            elif re.match(r"^(AND|OR|ON|USING)\b", upper) and context:
                indent_level = int(context["depth"]) + 1
            elif stripped.startswith(")"):
                indent_level = effective_depth
            elif context and context["phase"] in {
                "select",
                "from",
                "group",
                "order",
                "condition",
            }:
                indent_level = max(int(context["depth"]) + 1, effective_depth)
            else:
                indent_level = effective_depth

        normalized.append(" " * (width * indent_level) + stripped)
        depth = max(0, depth + sql_parenthesis_delta(stripped))

    return "\n".join(normalized)


def format_sql_for_display(sql: str) -> str:
    """Format SQL for the page without changing the executable source text."""
    try:
        import sqlparse
    except ModuleNotFoundError:
        # Unit tests run without the paid demo venv. Keep this dependency-free
        # formatter deterministic; the demo venv pins sqlparse for full nesting.
        clauses = r"\s+(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\s+"
        formatted = re.sub(
            clauses,
            lambda match: f"\n{match.group(1).upper()} ",
            break_select_columns(sql.strip()),
            flags=re.I,
        )
    else:
        # AlignedIndentFilter uses keyword-width offsets instead of the requested
        # indent width. It provides useful line breaks here;
        # normalize_sql_indentation applies the four-space hierarchy below.
        formatted = sqlparse.format(
            sql.strip(),
            keyword_case="upper",
            reindent_aligned=True,
            use_space_around_operators=True,
            wrap_after=100,
        ).strip()

    # sqlparse's aligned mode keeps each expression readable, but leaves the
    # first one beside SELECT and can put SELECT beside UNION or the final CTE
    # close. Keep those structural keywords on their own lines as requested.
    formatted = re.sub(
        r"(?im)^([ \t]*)UNION\s+ALL\s+SELECT\s+",
        lambda match: f"{match.group(1)}UNION ALL\n{match.group(1)}SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?i)\bUNION[ \t]+ALL[ \t]+SELECT[ \t]+",
        "UNION ALL\nSELECT ",
        formatted,
    )
    formatted = re.sub(r"(?i)\)[ \t]+SELECT[ \t]+", ")\nSELECT ", formatted)
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # The dependency-free unit-test formatter receives the compact source, so
    # expose CTE SELECTs before applying the same line-start rule a second time.
    formatted = re.sub(
        r"(?i)\bAS[ \t]*\([ \t]*SELECT[ \t]+",
        "AS (\n    SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # Aligned mode reserves space based on keyword width, which otherwise
    # leaves the first SELECT expression at a different column from the rest.
    # Keep every projected expression at one consistent four-space offset.
    lines = formatted.splitlines()
    select_column_indent: int | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.upper() == "SELECT":
            select_column_indent = len(line) - len(line.lstrip()) + 4
            continue
        if select_column_indent is not None and re.match(
            r"^(FROM|INTO)\b", stripped, flags=re.I
        ):
            select_column_indent = None
            continue
        if select_column_indent is not None and stripped:
            lines[index] = " " * select_column_indent + stripped
    return normalize_sql_indentation("\n".join(lines))


def generated_sql_block(sql: str) -> list[str]:
    """Keep the established report API while delegating SQL block rendering."""
    return _generated_sql_block_impl(sql, format_sql=format_sql_for_display)


def evidence_page(spec: dict, results: list) -> str:
    """Keep the established report API while delegating page assembly."""
    return _evidence_page_impl(spec, results, format_sql=format_sql_for_display)


def write_outputs(out_dir: Path, spec: dict, results: list, project: str) -> Path:
    """Keep the established report API while delegating safe publication."""
    return _write_outputs_impl(
        out_dir,
        spec,
        results,
        project,
        source=SOURCE,
        render_page=evidence_page,
    )


if __name__ == "__main__":
    print(
        "固定レポートrunnerは削除されました。AI分析仕様を作成するmake demo-liveを使用してください。",
        file=sys.stderr,
    )
    raise SystemExit(2)

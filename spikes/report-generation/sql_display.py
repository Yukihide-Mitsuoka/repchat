"""Format generated SQL for human-readable display."""

from __future__ import annotations

import re

from sql_display_structure import break_select_columns, normalize_sql_indentation


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

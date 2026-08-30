"""Normalize SQL display structure without changing executable SQL."""

from __future__ import annotations

import re


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

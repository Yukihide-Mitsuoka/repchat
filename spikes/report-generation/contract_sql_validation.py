"""Validate schema-bound SQL paths without analysis-target knowledge."""

from __future__ import annotations

import re
from dataclasses import dataclass

from analysis_contract_context import AnalysisExecutionPolicy


DIAGNOSTIC = "schema policyとSQLを照合できません。"
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_TOKEN = re.compile(r"`(?:``|[^`])*`|[A-Za-z_][A-Za-z0-9_]*|[().,]")
_MASK = re.compile(
    r"--[^\n]*|/\*[\s\S]*?(?:\*/|$)|'(?:\\.|''|[^'\\])*'|\"(?:\\.|\"\"|[^\"\\])*\""
)
_ALIAS_BOUNDARIES = frozenset(
    "CROSS EXCEPT FOR FULL GROUP HAVING INNER INTERSECT JOIN LEFT LIMIT NATURAL ON "
    "ORDER PIVOT QUALIFY RIGHT TABLESAMPLE UNION UNPIVOT USING WHERE WINDOW".split()
)
_KEYWORDS = _ALIAS_BOUNDARIES | frozenset(
    "ALL AND AS BY CASE DISTINCT ELSE END EXISTS FROM IS NOT NULL OR OVER SELECT THEN "
    "WHEN WITH".split()
)


class _PolicyMismatch(ValueError):
    pass


@dataclass(frozen=True)
class _TokenValue:
    value: str
    quoted: bool
    scope: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class _Binding:
    table: str
    prefix: tuple[str, ...]
    scalar: bool


def _tokens(sql: str) -> list[_TokenValue]:
    result: list[_TokenValue] = []
    scope = [(0, 0)]
    group = 0
    masked = _MASK.sub(lambda match: " " * len(match.group(0)), sql)
    for match in _TOKEN.finditer(masked):
        raw = match.group(0)
        if raw == ")":
            if len(scope) > 1:
                scope.pop()
            result.append(_TokenValue(raw, False, tuple(scope)))
            continue
        value = raw[1:-1].replace("``", "`") if raw.startswith("`") else raw
        result.append(_TokenValue(value, raw.startswith("`"), tuple(scope)))
        if raw == "(":
            group += 1
            scope.append((group, 0))
        elif raw.upper() == "UNION":
            current_group, branch = scope[-1]
            scope[-1] = (current_group, branch + 1)
    return result


def _alias(tokens: list[_TokenValue], index: int, fallback: str) -> tuple[str, int]:
    if index < len(tokens) and tokens[index].value.upper() == "AS":
        index += 1
        if (
            index >= len(tokens)
            or tokens[index].quoted
            or not _IDENTIFIER.fullmatch(tokens[index].value)
        ):
            raise _PolicyMismatch
        return tokens[index].value, index + 1
    if (
        index < len(tokens)
        and not tokens[index].quoted
        and _IDENTIFIER.fullmatch(tokens[index].value)
        and tokens[index].value.upper() not in _ALIAS_BOUNDARIES
    ):
        return tokens[index].value, index + 1
    if not fallback:
        raise _PolicyMismatch
    return fallback, index


def _put(bindings, scope, alias, binding) -> None:
    key = (scope, alias.casefold())
    if key in bindings:
        raise _PolicyMismatch
    bindings[key] = binding


def _physical_bindings(tokens: list[_TokenValue], execution: AnalysisExecutionPolicy):
    bindings = {}
    tables = execution.query_tables
    for index, token in enumerate(tokens):
        table, following = None, index + 1
        if token.quoted and token.value in tables:
            table = token.value
        elif index + 4 < len(tokens):
            parts = tokens[index : index + 5]
            if [item.value for item in parts[1::2]] == [".", "."]:
                candidate = ".".join(item.value for item in parts[::2])
                if candidate in tables:
                    table, following = candidate, index + 5
        if table is None:
            continue
        alias, _ = _alias(tokens, following, table.rsplit(".", 1)[-1])
        _put(bindings, token.scope, alias, _Binding(table, (), False))
    if not bindings or not execution.schema_fields:
        raise _PolicyMismatch
    return bindings


def _binding(bindings, scope: tuple[tuple[int, int], ...], name: str) -> _Binding | None:
    for size in range(len(scope), -1, -1):
        found = bindings.get((scope[:size], name.casefold()))
        if found is not None:
            return found
    return None


def _field_index(execution: AnalysisExecutionPolicy):
    return {(field.table, tuple(map(str.casefold, field.path))): field for field in execution.schema_fields}


def _visible_tables(bindings, scope):
    return {
        item.table
        for (item_scope, _alias_name), item in bindings.items()
        if item_scope == scope[: len(item_scope)] and not item.prefix
    }


def _resolve(segments, scope, bindings, fields):
    bound = _binding(bindings, scope, segments[0])
    if bound is None:
        visible_tables = _visible_tables(bindings, scope)
        matches = [
            fields[(table, tuple(part.casefold() for part in segments))]
            for table in visible_tables
            if (table, tuple(part.casefold() for part in segments)) in fields
        ]
        if len(matches) > 1:
            raise _PolicyMismatch
        return (matches[0], ()) if matches else None
    if bound.scalar or len(segments) == 1:
        raise _PolicyMismatch
    path = (*bound.prefix, *segments[1:])
    field = fields.get((bound.table, tuple(part.casefold() for part in path)))
    if field is None:
        raise _PolicyMismatch
    return field, bound.prefix


def _path(tokens: list[_TokenValue], start: int, stop: int) -> list[str] | None:
    values = tokens[start:stop]
    if not values or len(values) % 2 == 0:
        return None
    if any(item.value != "." for item in values[1::2]):
        return None
    return [item.value for item in values[::2]]


def _unnest(tokens, bindings, fields) -> None:
    for index, token in enumerate(tokens):
        if (
            token.value.upper() != "UNNEST"
            or index + 2 >= len(tokens)
            or tokens[index + 1].value != "("
        ):
            continue
        close = index + 2
        while close < len(tokens) and not (
            tokens[close].value == ")" and tokens[close].scope == token.scope
        ):
            close += 1
        segments = _path(tokens, index + 2, close)
        if segments is None:
            continue
        resolved = _resolve(segments, token.scope, bindings, fields)
        if resolved is None:
            continue
        field, _prefix = resolved
        if field.mode != "REPEATED" or field.restricted:
            raise _PolicyMismatch
        alias, _ = _alias(tokens, close + 1, "")
        _put(
            bindings,
            token.scope,
            alias,
            _Binding(field.table, field.path, field.field_type not in {"RECORD", "STRUCT"}),
        )


def _qualified_paths(tokens, bindings, fields) -> None:
    index = 0
    while index + 2 < len(tokens):
        start = index
        while index + 2 < len(tokens) and tokens[index + 1].value == ".":
            index += 2
        if index == start:
            index += 1
            continue
        segments = _path(tokens, start, index + 1)
        if segments is not None:
            resolved = _resolve(segments, tokens[start].scope, bindings, fields)
            if resolved is not None:
                field, prefix = resolved
                if field.restricted:
                    raise _PolicyMismatch
                if field.mode != "REPEATED" and any(
                    fields[(field.table, field.path[:offset])].mode == "REPEATED"
                    for offset in range(len(prefix) + 1, len(field.path))
                ):
                    raise _PolicyMismatch
        index += 1


def _unqualified_restricted(tokens, bindings, fields) -> None:
    for index, token in enumerate(tokens):
        if (
            not token.quoted
            and (
                not _IDENTIFIER.fullmatch(token.value)
                or token.value.upper() in _KEYWORDS
            )
        ):
            continue
        before = tokens[index - 1].value.upper() if index else ""
        after = tokens[index + 1].value if index + 1 < len(tokens) else ""
        if before in {".", "AS"} or after in {".", "("}:
            continue
        key = (token.value.casefold(),)
        if any(
            (field := fields.get((table, key))) is not None and field.restricted
            for table in _visible_tables(bindings, token.scope)
        ):
            raise _PolicyMismatch


def contract_sql_diagnostic(sql: str, execution: AnalysisExecutionPolicy) -> str:
    """Return a stable refusal when SQL paths contradict canonical schema policy."""
    try:
        tokens = _tokens(sql)
        fields = _field_index(execution)
        bindings = _physical_bindings(tokens, execution)
        _unnest(tokens, bindings, fields)
        _qualified_paths(tokens, bindings, fields)
        _unqualified_restricted(tokens, bindings, fields)
    except (KeyError, TypeError, ValueError):
        return DIAGNOSTIC
    return ""

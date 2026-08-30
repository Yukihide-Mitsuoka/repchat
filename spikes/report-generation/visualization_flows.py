"""Validate bounded Sankey query results without inferring chart intent."""

from __future__ import annotations

import math
import re
from decimal import Decimal

import analysis_planner as planner

MAX_SANKEY_PAGES = planner.MAX_SANKEY_PAGES
MAX_SANKEY_PATHS = planner.MAX_SANKEY_PATHS
MAX_SANKEY_EDGE_ROWS = planner.MAX_SANKEY_EDGE_ROWS


def valid_sankey_result(rows: list[tuple]) -> bool:
    """Validate bounded adjacent Sankey edges without inferring a chart type."""
    numeric = (int, float, Decimal)

    def stage(value: str) -> int | None:
        match = re.match(r"^(\d+)\.", value.strip())
        return int(match.group(1)) if match else None

    if not rows or len(rows) > MAX_SANKEY_EDGE_ROWS:
        return False
    valid_rows = all(
        len(row) == 3
        and isinstance(row[0], str)
        and isinstance(row[1], str)
        and isinstance(row[2], numeric)
        and math.isfinite(float(row[2]))
        and row[2] >= 0
        and stage(row[0]) is not None
        and stage(row[1]) == stage(row[0]) + 1
        and stage(row[1]) <= MAX_SANKEY_PAGES
        for row in rows
    )
    if not valid_rows:
        return False
    pairs = {(row[0], row[1]) for row in rows}
    if len(pairs) != len(rows):
        return False
    nodes_by_stage: dict[int, set[str]] = {}
    for source, target, _value in rows:
        nodes_by_stage.setdefault(stage(source), set()).add(source)
        nodes_by_stage.setdefault(stage(target), set()).add(target)
    return all(len(nodes) <= MAX_SANKEY_PATHS for nodes in nodes_by_stage.values())


def valid_flow_sankey_result(rows: list[tuple]) -> bool:
    """Validate a bounded acyclic directed flow without page-navigation semantics."""
    numeric = (int, float, Decimal)
    if not rows or len(rows) > planner.MAX_FLOW_SANKEY_EDGES:
        return False
    if not all(
        len(row) == 3
        and isinstance(row[0], str)
        and row[0].strip()
        and isinstance(row[1], str)
        and row[1].strip()
        and row[0] != row[1]
        and isinstance(row[2], numeric)
        and math.isfinite(float(row[2]))
        and row[2] >= 0
        for row in rows
    ):
        return False
    edges = {(row[0], row[1]) for row in rows}
    if len(edges) != len(rows):
        return False
    nodes = {value for edge in edges for value in edge}
    indegree = {node: 0 for node in nodes}
    outgoing = {node: [] for node in nodes}
    for source, target in edges:
        outgoing[source].append(target)
        indegree[target] += 1
    pending = [node for node, count in indegree.items() if count == 0]
    visited = 0
    while pending:
        source = pending.pop()
        visited += 1
        for target in outgoing[source]:
            indegree[target] -= 1
            if indegree[target] == 0:
                pending.append(target)
    return visited == len(nodes)

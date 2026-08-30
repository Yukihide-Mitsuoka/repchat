"""Safe Evidence query and visualization component rendering."""

from __future__ import annotations

import html
import re

EVIDENCE_COMPONENT = {
    "big_value": '<BigValue data={{{q}}} value={col} title="{title}"/>',
    "table": "<DataTable data={{{q}}}/>",
    "bar": '<BarChart data={{{q}}} x={x} y={y} title="{title}"/>',
    "line": "<LineChart data={{{q}}} x={x} y={y} title=\"{title}\"/>",
}

SOURCE = "ga4"  # Evidence source name; sources/<SOURCE>/<id>.sql holds warehouse SQL


def evidence_identifier(column: str) -> str:
    """Accept only the ASCII identifiers required by the generation prompt."""
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", column):
        raise ValueError(f"unsafe Evidence column identifier: {column}")
    return column


def evidence_query(result: dict) -> list[str]:
    """Render the local Evidence query for one materialized result."""
    columns = result["columns"] or []
    selected_columns = ", ".join(evidence_identifier(column) for column in columns)
    query_name = result["id"].lower()
    return [
        f"```sql {query_name}",
        f"select {selected_columns} from {SOURCE}.{query_name}",
        "```",
        "",
    ]


def evidence_component(result: dict) -> str:
    """Render one Evidence component backed by a materialized query."""
    columns = result["columns"] or []
    query_name = result["id"].lower()
    component = result["component"]
    if component == "sankey":
        source = columns[0] if columns else "source"
        target = columns[1] if len(columns) > 1 else "target"
        value = columns[2] if len(columns) > 2 else "value"
        return (
            f'<SankeyDiagram data={{{query_name}}} sourceCol={source} targetCol={target} '
            f'valueCol={value} valueFmt=num0 nodeLabels=name linkLabels=value '
            'linkColor=gradient chartAreaHeight=420 '
            f'title="{html.escape(result["title"])}"/>'
        )
    template = EVIDENCE_COMPONENT[component]
    if component == "big_value":
        return template.format(
            q=query_name,
            col=columns[0] if columns else "value",
            title=result["title"],
        )
    if component in {"bar", "line"}:
        x = columns[0] if columns else "x"
        y = columns[1] if len(columns) > 1 else "y"
        return template.format(
            q=query_name,
            x=x,
            y=y,
            title=result["title"],
        )
    return template.format(q=query_name)

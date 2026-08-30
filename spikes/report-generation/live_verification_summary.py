"""Build privacy-safe quality summaries from live verification events."""

from __future__ import annotations

from collections import Counter
from typing import Any


def _safe_error(error: BaseException) -> str:
    """Return a bounded operator diagnostic without dumping generated payloads."""
    text = " ".join(str(error).split())
    return text[:600] or type(error).__name__


def quality_summary(events: list[dict[str, Any]], terminal_types: set[str]) -> dict[str, Any]:
    """Summarize one operation without persisting SQL, rows, or report prose."""
    sql_by_panel = {
        event.get("panel_id"): event.get("sql_sha256")
        for event in events
        if event.get("type") == "sql" and event.get("sql_sha256")
    }
    result_summaries = []
    for event in events:
        if event.get("type") != "result":
            continue
        result_summaries.append(
            {
                "panel_id": event.get("panel_id"),
                "visualization": event.get("visualization"),
                "columns": event.get("columns", []),
                "row_count": len(event.get("rows") or []),
                "verification": event.get("verification"),
                "sql_sha256": sql_by_panel.get(event.get("panel_id")),
            }
        )
    errors = [
        _safe_error(event.get("message") or event.get("reason") or "error")
        for event in events
        if event.get("type") == "error"
    ]
    refusals = [
        {
            "undefined_terms": event.get("undefined_terms", []),
            "has_clarification_question": bool(event.get("clarification_question")),
        }
        for event in events
        if event.get("type") == "refusal"
    ]
    terminal = [event for event in events if event.get("type") in terminal_types]
    event_types = Counter(event.get("type", "unknown") for event in events)
    return {
        "status": "complete" if terminal and not errors else "error",
        "event_types": dict(sorted(event_types.items())),
        "errors": errors,
        "refusals": refusals,
        "result_count": len(result_summaries),
        "results": result_summaries,
        "sql_sha256s": [
            event["sql_sha256"]
            for event in events
            if event.get("type") == "sql" and event.get("sql_sha256")
        ],
        "cost_jpy": next(
            (
                event.get("cost_jpy")
                for event in reversed(events)
                if isinstance(event.get("cost_jpy"), (int, float))
                and event.get("type") in terminal_types
            ),
            0,
        ),
    }

#!/usr/bin/env python3
"""Run one explicitly approved live verification for each paid demo path.

This is an operator tool, not a product fallback.  It never runs without an
explicit ``--accept-cost`` flag and records contract metadata only: generated
SQL, returned rows, and meeting-report text are deliberately excluded.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import live_demo
import run_report as report
from demo_support import require_adc


DEFAULT_DASHBOARD_QUESTION = (
    "2021年1月のECサイトで購入成果を改善するため、課題の場所と優先施策を判断できる"
    "ダッシュボードを作って"
)
DEFAULT_INSIGHT_QUESTION = (
    "2021年1月のデータで流入チャネル別のセッション数と購入件数を比較してください。"
)


class CostGateError(RuntimeError):
    """Raised before any Google client is created when cost was not approved."""


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


def _run_operation(label: str, operation, terminal_types: set[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events: list[dict[str, Any]] = []

    def emit(event: dict[str, Any]) -> None:
        # Keep the complete event stream in memory for the summary, but never
        # serialize it: it can contain SQL, result rows, or report prose.
        events.append(event)

    try:
        operation(emit)
    except Exception as error:  # noqa: BLE001 - the report must record each path
        events.append({"type": "error", "message": _safe_error(error)})
    return events, {"label": label, **quality_summary(events, terminal_types)}


def run_verification(args: argparse.Namespace) -> dict[str, Any]:
    if not args.accept_cost:
        raise CostGateError(
            "実Vertex AI／BigQuery検証は費用承認が必要です。"
            "承認する場合だけ --accept-cost を付けて再実行してください。"
        )
    require_adc()
    engine = live_demo.LiveQueryEngine(args.project, model=args.model)
    operations: dict[str, dict[str, Any]] = {}

    plan_events, plan_summary = _run_operation(
        "dashboard_plan",
        lambda emit: engine.plan(args.dashboard_question, {}, emit),
        {"plan"},
    )
    operations["dashboard_plan"] = plan_summary
    plan_event = next((event for event in plan_events if event.get("type") == "plan"), None)
    plan = plan_event.get("plan") if plan_event else None

    dashboard_events: list[dict[str, Any]] = []
    if isinstance(plan, dict):
        dashboard_events, operations["dashboard"] = _run_operation(
            "dashboard",
            lambda emit: engine.dashboard(
                args.dashboard_question,
                emit,
                analysis_plan=plan,
            ),
            {"dashboard_complete"},
        )
    else:
        operations["dashboard"] = {
            "label": "dashboard",
            "status": "blocked",
            "reason": "分析計画を取得できなかったためbuildを開始していません。",
        }

    consultation_events, operations["insight_consultation"] = _run_operation(
        "insight_consultation",
        lambda emit: engine.consult(
            args.insight_question,
            [],
            emit,
            profile=args.profile,
        ),
        {"consultation"},
    )
    consultation = next(
        (event for event in consultation_events if event.get("type") == "consultation"),
        None,
    )
    recommendations = consultation.get("recommendations", []) if consultation else []
    recommendation = recommendations[0] if recommendations else None
    if isinstance(recommendation, dict):
        insight_events, insight_summary = _run_operation(
            "insight",
            lambda emit: engine.query(
                recommendation["execution_prompt"],
                emit,
                profile=args.profile,
                analysis_specification=recommendation,
            ),
            {"result", "refusal"},
        )
        insight_summary["selected_chart"] = recommendation.get("chart")
        insight_summary["selected_title"] = recommendation.get("title")
        operations["insight"] = insight_summary
    else:
        operations["insight"] = {
            "label": "insight",
            "status": "blocked",
            "reason": "分析相談の候補を取得できなかったためSQL生成を開始していません。",
        }

    build_event = next(
        (event for event in reversed(dashboard_events) if event.get("type") == "dashboard_complete"),
        None,
    )
    if build_event and build_event.get("build_revision"):
        _, operations["meeting_report"] = _run_operation(
            "meeting_report",
            lambda emit: engine.meeting_report(build_event["build_revision"], emit),
            {"meeting_report"},
        )
    else:
        operations["meeting_report"] = {
            "label": "meeting_report",
            "status": "blocked",
            "reason": "dashboard buildが完了していないため会議報告を開始していません。",
        }

    complete = all(
        operations[label].get("status") == "complete"
        for label in ("dashboard", "insight", "meeting_report")
    )
    return {
        "schema_version": "live-verification-v1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "project": args.project,
        "model": args.model,
        "profile": args.profile,
        "status": "complete" if complete else "incomplete",
        "operations": operations,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="費用承認済みの実Vertex AI／BigQuery検証を1回ずつ実行し、品質メタデータを保存します。"
    )
    parser.add_argument("--project", required=True, help="Google Cloud project ID")
    parser.add_argument("--model", default=report.DEFAULT_MODEL)
    parser.add_argument("--profile", choices=("ga4", "bitcoin"), default="ga4")
    parser.add_argument("--dashboard-question", default=DEFAULT_DASHBOARD_QUESTION)
    parser.add_argument("--insight-question", default=DEFAULT_INSIGHT_QUESTION)
    parser.add_argument("--output", required=True, type=Path, help="品質記録JSONの出力先")
    parser.add_argument(
        "--accept-cost",
        action="store_true",
        help="Vertex AI／BigQuery費用を承認して実行する",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        record = run_verification(args)
    except CostGateError as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:  # noqa: BLE001 - provide one actionable operator error
        print(f"実環境検証を開始できません: {_safe_error(error)}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0 if record["status"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())

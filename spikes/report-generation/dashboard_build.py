"""Assemble a confirmed AI-authored dashboard from independently executed panels."""

from __future__ import annotations

import hashlib
import json
from typing import Callable

import analysis_planner as planner
import meeting_report as meeting


class DashboardBuildError(RuntimeError):
    """Raised when a confirmed plan cannot be assembled without changing it."""


def dashboard_layout_rows_for_plan(panels: list[dict]) -> list[dict]:
    """Lay out AI-authored panels without encoding any analysis topic."""
    if not panels:
        raise DashboardBuildError("ダッシュボード計画にパネルがありません。")
    grouped: dict[int, list[dict]] = {}
    for panel in panels:
        row = panel.get("layout_row")
        weight = panel.get("layout_weight")
        if (
            isinstance(row, bool)
            or not isinstance(row, int)
            or row < 1
            or isinstance(weight, bool)
            or not isinstance(weight, int)
            or not 1 <= weight <= 100
        ):
            raise DashboardBuildError("AIが考察したダッシュボード配置がありません。")
        grouped.setdefault(row, []).append(panel)
    row_numbers = list(grouped)
    if row_numbers != sorted(row_numbers) or any(
        len(group) > 4 for group in grouped.values()
    ):
        raise DashboardBuildError("AIが考察したダッシュボード行が描画仕様と一致しません。")
    rows: list[dict] = []
    for row_number in row_numbers:
        group = grouped[row_number]
        total = sum(item["layout_weight"] for item in group)
        shares = [round(item["layout_weight"] * 100 / total, 4) for item in group]
        shares[-1] = round(100 - sum(shares[:-1]), 4)
        rows.append(
            {
                "panel_ids": [item["id"] for item in group],
                "shares": shares,
            }
        )
    return rows


def dashboard_sections_for_plan(
    question: str,
    plan: dict,
    *,
    period_for_question: Callable[[str], dict[str, str]],
    planned_analysis_section: Callable[[dict], dict],
    max_panel_count: int,
) -> tuple[dict, list[dict]]:
    """Turn AI-authored analysis specifications into guarded generation sections."""
    if "ダッシュボード" not in question:
        raise DashboardBuildError("依頼に「ダッシュボード」を含めてください。")
    period = period_for_question(question)
    if plan.get("period") != period:
        raise DashboardBuildError("確定した分析仕様の対象期間が依頼文と一致しません。")
    sections = [planned_analysis_section(panel) for panel in plan.get("panels", [])]
    if not 1 <= len(sections) <= max_panel_count:
        raise DashboardBuildError(
            f"確定した分析パネルは1〜{max_panel_count}件にしてください。"
        )
    return period, sections


def build_dashboard(
    question: str,
    analysis_plan: dict | None,
    emit: Callable[[dict], None],
    *,
    profile: str,
    metric_definitions: dict,
    sections_for_plan: Callable[[str, dict, str], tuple[dict, list[dict]]],
    layout_rows_for_plan: Callable[[list[dict]], list[dict]],
    run_section: Callable[..., float],
    check_cancelled: Callable[[], None],
    store_bundle: Callable[[dict], None],
) -> dict:
    """Build one evidence bundle without inventing or replacing plan content."""
    if analysis_plan is None:
        raise DashboardBuildError("AIが作成した分析仕様を確定してからbuildしてください。")
    try:
        confirmed = planner.confirm_dashboard_plan(
            analysis_plan, expected_profile=profile
        )
    except planner.PlannerError as error:
        raise DashboardBuildError(str(error)) from error
    period, sections = sections_for_plan(question, confirmed, profile)
    layout_rows = layout_rows_for_plan(confirmed["panels"])
    emit(
        {
            "type": "dashboard_plan",
            "period": period["label"],
            "plan_revision": confirmed["revision"],
            "organization_context_revision": confirmed[
                "organization_context_revision"
            ],
            "panels": [
                {
                    "id": section["id"],
                    "title": section["title"],
                    "purpose": section["purpose"],
                    "chart": section.get("planned_visualization"),
                }
                for section in sections
            ],
            "layout_rows": layout_rows,
        }
    )
    total_cost = 0.0
    evidence_panels = []
    for index, section in enumerate(sections, start=1):
        check_cancelled()
        context = {
            "operation": "dashboard",
            "panel_id": section["id"],
            "panel_index": index,
            "panel_count": len(sections),
            "title": section["title"],
            "purpose": section["purpose"],
        }
        evidence = {
            "id": section["id"],
            "title": section["title"],
            "purpose": section["purpose"],
            "period": period["label"],
        }

        def capture(event: dict) -> None:
            emit(event)
            if event.get("type") == "sql":
                evidence["sql_sha256"] = event["sql_sha256"]
            elif event.get("type") == "result":
                evidence.update(
                    {
                        "columns": event["columns"],
                        "rows": event["rows"],
                        "visualization": event["visualization"],
                        "verification": event["verification"],
                    }
                )

        total_cost += run_section(
            section, period, capture, context, profile=profile
        )
        if "rows" not in evidence:
            continue
        if evidence.get("visualization") == "funnel":
            evidence["derived_metrics"] = meeting.funnel_conversion_metrics(
                evidence["columns"], evidence["rows"]
            )
        result_canonical = json.dumps(
            evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        evidence["result_revision"] = (
            "result-" + hashlib.sha256(result_canonical.encode()).hexdigest()[:12]
        )
        evidence_panels.append(evidence)
    bundle = {
        "profile": profile,
        "plan_revision": confirmed["revision"],
        "organization_context_revision": confirmed["organization_context_revision"],
        "organization_context": confirmed["organization_context"],
        "analysis_specification": {
            "revision": confirmed["revision"],
            "objective": confirmed["objective_summary"],
            "audience": confirmed["audience"],
            "comparison": confirmed["comparison"],
            "period": confirmed["period"],
            "hypotheses": confirmed["hypotheses"],
        },
        "metric_definitions": metric_definitions,
        "panels": evidence_panels,
    }
    canonical = json.dumps(bundle, ensure_ascii=False, sort_keys=True)
    bundle["build_revision"] = (
        "build-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    )
    store_bundle(bundle)
    emit(
        {
            "type": "dashboard_complete",
            "panel_count": len(sections),
            "cost_jpy": round(total_cost, 3),
            "build_revision": bundle["build_revision"],
        }
    )
    return bundle

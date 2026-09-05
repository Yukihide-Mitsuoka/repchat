"""Translate analysis components into the live demo's public contracts."""

from __future__ import annotations

import analysis_planner as planner
import analysis_workflows
import dashboard_build
import data_source_profiles
import ga4_profile
import sql_contract_validation as sql_contracts
import visualization_results
import visualization_sections

SAMPLE_FIRST_DAY = ga4_profile.SAMPLE_FIRST_DAY
SAMPLE_LAST_DAY = ga4_profile.SAMPLE_LAST_DAY


class LiveDemoError(RuntimeError):
    """A local-demo failure that is safe to show in the browser."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


class LiveDemoCancelled(LiveDemoError):
    """A user-requested cancellation of the active local operation."""


def dashboard_layout_rows_for_plan(panels: list[dict]) -> list[dict]:
    """Preserve the live demo's public layout validation error contract."""
    try:
        return dashboard_build.dashboard_layout_rows_for_plan(panels)
    except (dashboard_build.DashboardBuildError, ValueError) as error:
        raise LiveDemoError(str(error)) from error


def analysis_consultation_context(metrics: str, profile: str) -> str:
    """Preserve the public planner-context helper used by the live demo."""
    return analysis_workflows.consultation_context(metrics, profile)


def google_auth_recovery_message(error: Exception) -> str | None:
    """Return a bounded recovery instruction for an expired Google ADC chain."""
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        error_type = type(current)
        if (
            error_type.__module__ == "google.auth.exceptions"
            and error_type.__name__ == "RefreshError"
        ):
            return (
                "Google Cloudの認証期限が切れています。"
                "gcloud auth application-default loginを実行し、デモを再起動してください。"
                "今回の処理は自動再実行していません。"
            )
        current = current.__cause__ or current.__context__
    return None


def period_for_question(question: str) -> dict[str, str]:
    """Return the explicit month in a question, bounded by the demo dataset."""
    try:
        return ga4_profile.period_for_question(question)
    except ValueError as error:
        raise LiveDemoError(str(error)) from error


def planned_analysis_section(panel: dict, section_id: str | None = None) -> dict:
    """Translate one confirmed AI specification into a guarded render contract."""
    try:
        return visualization_sections.build_planned_analysis_section(panel, section_id)
    except visualization_sections.UnsupportedVisualizationError as error:
        raise LiveDemoError(str(error)) from error


def analysis_section_for_specification(
    question: str, analysis_specification: dict, profile: str
) -> tuple[dict, dict]:
    """Preserve the public single-analysis specification error contract."""
    try:
        return analysis_workflows.analysis_section_for_specification(
            question,
            analysis_specification,
            profile,
            planned_analysis_section=planned_analysis_section,
        )
    except analysis_workflows.AnalysisWorkflowError as error:
        raise LiveDemoError(str(error)) from error


def dashboard_sections_for_plan(
    question: str, plan: dict, profile: str = "ga4"
) -> tuple[dict, list[dict]]:
    """Preserve the live demo's public section construction error contract."""
    try:
        source = data_source_profiles.profile_for(profile)
        return dashboard_build.dashboard_sections_for_plan(
            question,
            plan,
            period_for_question=source.period_for_question,
            planned_analysis_section=planned_analysis_section,
            max_panel_count=planner.MAX_PANEL_COUNT,
        )
    except dashboard_build.DashboardBuildError as error:
        raise LiveDemoError(str(error)) from error


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Keep the live demo's established error type for SQL period validation."""
    try:
        ga4_profile.require_sql_period(sql, period)
    except ValueError as error:
        raise LiveDemoError(str(error)) from error


def sql_period_diagnostic(
    sql: str, period: dict[str, str], profile: str = "ga4"
) -> str:
    """Return a repair diagnostic without changing the fail-closed contract."""
    source = data_source_profiles.profile_for(profile)
    return sql_contracts.sql_period_diagnostic(
        sql, period, source.require_sql_period
    )


def _top_level_select_expressions(sql: str) -> tuple[list[str], str]:
    """Keep the parser available to existing live demo callers and tests."""
    try:
        return sql_contracts.top_level_select_expressions(sql)
    except sql_contracts.SQLContractError as error:
        raise LiveDemoError(str(error)) from error


def validate_generated_dashboard_sql(section: dict, sql: str) -> None:
    """Validate generated SQL while preserving the public live demo error contract."""
    try:
        sql_contracts.validate_generated_dashboard_sql(section, sql)
    except sql_contracts.SQLContractError as error:
        raise LiveDemoError(str(error)) from error


def validate_dashboard_dry_run_schema(
    section: dict, schema: list[tuple[str, str]]
) -> None:
    """Validate dry-run output while preserving the live demo error contract."""
    try:
        sql_contracts.validate_dashboard_dry_run_schema(section, schema)
    except sql_contracts.SQLContractError as error:
        raise LiveDemoError(str(error)) from error


def json_value(value):
    return visualization_results.json_value(value)


def valid_sankey_result(rows: list[tuple]) -> bool:
    return visualization_results.valid_sankey_result(rows)


def valid_flow_sankey_result(rows: list[tuple]) -> bool:
    return visualization_results.valid_flow_sankey_result(rows)


def valid_geojson_geometry(value: object) -> bool:
    return visualization_results.valid_geojson_geometry(value)


def valid_geojson_map(value: object) -> bool:
    return visualization_results.valid_geojson_map(value)


def dashboard_visualization(section: dict, rows: list[tuple], columns: list[str]) -> str:
    try:
        return visualization_results.dashboard_visualization(section, rows, columns)
    except visualization_results.VisualizationResultError as error:
        raise LiveDemoError(str(error)) from error

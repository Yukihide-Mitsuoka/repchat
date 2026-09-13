"""Run one AI-authored analysis section through the guarded query pipeline."""

from __future__ import annotations

import hashlib
from typing import Callable

import analysis_contract_context
import contract_period_validation
import data_source_profiles
import run_report as report
import sql_contract_validation as sql_contracts
import visualization_results


class SectionExecutionError(RuntimeError):
    """Raised when a section cannot safely complete its execution pipeline."""


def _period_diagnostic(
    sql: str,
    period: dict[str, str],
    policy: analysis_contract_context.AnalysisExecutionPolicy | None,
    fallback: Callable[[str, dict[str, str]], None],
) -> str:
    """Use canonical policy when present and keep legacy callbacks isolated."""
    if policy is not None:
        return contract_period_validation.contract_period_diagnostic(sql, policy.period)
    return sql_contracts.sql_period_diagnostic(sql, period, fallback)


def _period_repair_guidance(
    period: dict[str, str],
    policy: analysis_contract_context.AnalysisExecutionPolicy | None,
    fallback: Callable[[dict[str, str]], str],
) -> str:
    """Render repair instructions from the same boundary used for validation."""
    if policy is not None:
        return contract_period_validation.contract_period_repair_guidance(policy.period)
    return fallback(period)


def _dashboard_sql_diagnostic(
    section: dict,
    sql: str,
    bq: object,
    allowed_dataset: str,
    period_diagnostic: str,
    policy: analysis_contract_context.AnalysisExecutionPolicy | None = None,
) -> str:
    """Return the first repairable pre-execution diagnostic in policy order."""
    if period_diagnostic:
        return period_diagnostic
    try:
        sql_contracts.validate_generated_dashboard_sql(section, sql)
    except sql_contracts.SQLContractError as validation_error:
        return str(validation_error)
    policy_args = {"policy": policy} if policy is not None else {}
    dry_schema, dry_error = report.inspect_bq_schema(
        bq, sql, allowed_dataset=allowed_dataset, **policy_args
    )
    if dry_error:
        if not report.repairable_dry_run_error(dry_error):
            raise SectionExecutionError(f"BigQuery dry runに失敗しました: {dry_error}")
        return dry_error
    assert dry_schema is not None
    try:
        sql_contracts.validate_dashboard_dry_run_schema(section, dry_schema)
    except sql_contracts.SQLContractError as validation_error:
        return str(validation_error)
    return ""


def _execute_section_result(
    section: dict,
    sql: str,
    *,
    bq: object,
    allowed_dataset: str,
    max_result_rows: int,
    cost: float,
    policy: analysis_contract_context.AnalysisExecutionPolicy | None = None,
) -> dict:
    """Reject invalid query results before constructing the result event."""
    policy_args = {"policy": policy} if policy is not None else {}
    result, error = report.exec_bq(
        bq,
        sql,
        max_results=max_result_rows + 1,
        allowed_dataset=allowed_dataset,
        **policy_args,
    )
    if error:
        raise SectionExecutionError(f"BigQuery実行に失敗しました: {error}")
    assert result is not None
    rows, columns = result
    if len(rows) > max_result_rows:
        raise SectionExecutionError(
            f"結果が{max_result_rows}行を超えたため描画しません。集計条件を追加してください。"
        )
    verification, label = "unverified", "実行済み・AI分析仕様と形状照合済み"
    try:
        visualization = visualization_results.dashboard_visualization(
            section, rows, columns
        )
    except visualization_results.VisualizationResultError as error:
        raise SectionExecutionError(str(error)) from error
    return {
        "type": "result",
        "columns": section.get("shape", {}).get("columns", columns),
        "source_columns": columns,
        "rows": [
            [visualization_results.json_value(value) for value in row]
            for row in rows
        ],
        "visualization": visualization,
        "navigation_depth": section.get("navigation_depth"),
        "verification": verification,
        "verification_label": label,
        "cost_jpy": round(cost, 3),
    }


def run_section(
    section: dict,
    period: dict[str, str],
    emit: Callable[[dict], None],
    *,
    client: object,
    bq: object,
    model: str,
    source: data_source_profiles.DataSourceProfile,
    max_result_rows: int,
    rules: str | None = None,
    context: dict | None = None,
) -> float:
    """Generate, validate, execute, and optionally verify one panel."""
    extra = context or {}
    policy = (
        analysis_contract_context.execution_policy(source.analysis_contract)
        if source.analysis_contract is not None
        else None
    )
    result_row_limit = (
        min(max_result_rows, policy.maximum_result_rows)
        if policy is not None
        else max_result_rows
    )
    policy_args = {"policy": policy} if policy is not None else {}

    def send(event: dict) -> None:
        emit({**event, **extra})

    send(
        {
            "type": "stage",
            "stage": "generate",
            "message": "Vertex AIでSQLを生成中です。",
        }
    )
    request = source.generation_request(section, period)
    if extra.get("clarification_answer"):
        request += (
            "\n（利用者が未定義条件について追加した回答。ここに書かれた条件だけを使って対象を確定し、"
            "回答にない条件は推測しない）\n"
            f"{extra['clarification_answer'].strip()}"
        )
    sql_rules = rules if rules is not None else source.sql_rules("")
    answer, usage = report.generate_request(client, model, request, sql_rules)
    allowed_dataset = source.allowed_dataset
    cost = report.vertex_cost_jpy(model, usage)
    sql = (answer.get("sql") or "").strip()
    undefined = answer.get("undefined_terms") or []
    if not sql and undefined:
        send(
            {
                "type": "refusal",
                "reason": answer.get("reason", ""),
                "undefined_terms": undefined,
                "clarification_question": answer.get("clarification_question", ""),
                "cost_jpy": round(cost, 3),
            }
        )
        return cost
    if not sql:
        raise SectionExecutionError("SQLが返りませんでした。指標定義または質問を確認してください。")
    normalized, error = report.validate_sql(
        sql, allowed_dataset, **policy_args
    )
    if error:
        raise SectionExecutionError(f"生成SQLを安全検査で拒否しました: {error}")
    assert normalized is not None
    normalized = source.normalize_sql(normalized)
    allow_period_repair = extra.get("operation") == "dashboard"
    fallback_period_check = source.require_sql_period
    fallback_period_guidance = source.period_repair_guidance
    period_diagnostic = _period_diagnostic(
        normalized, period, policy, fallback_period_check
    )
    if period_diagnostic and allow_period_repair:
        period_diagnostic += (
            f" 修正要件: {_period_repair_guidance(period, policy, fallback_period_guidance)}"
        )
    if period_diagnostic and (
        not allow_period_repair or not section.get("source_columns")
    ):
        raise SectionExecutionError(period_diagnostic)
    if policy is not None and not section.get("source_columns"):
        send(
            {
                "type": "stage",
                "stage": "validate",
                "message": "共通分析契約とBigQuery dry runを照合中です。",
            }
        )
        diagnostic = _dashboard_sql_diagnostic(
            section,
            normalized,
            bq,
            allowed_dataset,
            "",
            policy,
        )
        if diagnostic:
            raise SectionExecutionError(
                f"共通分析契約の実行前診断を満たさないため実行しません: {diagnostic}"
            )
    if section.get("source_columns"):
        send(
            {
                "type": "stage",
                "stage": "validate",
                "message": "描画仕様とBigQuery dry runの出力schemaを照合中です。",
            }
        )
        analysis_request = source.generation_request(section, period)
        repair_used = False
        while True:
            diagnostic = _dashboard_sql_diagnostic(
                section,
                normalized,
                bq,
                allowed_dataset,
                period_diagnostic if allow_period_repair else "",
                policy,
            )
            if not diagnostic:
                break
            if repair_used:
                raise SectionExecutionError(
                    "SQL担当AIで1回修正しましたが、実行前診断を解消できなかったため"
                    f"実行しません: {diagnostic}"
                )
            send(
                {
                    "type": "stage",
                    "stage": "repair",
                    "message": "実行前診断をもとにSQLを1回修正中です。",
                }
            )
            repaired, repair_usage = report.repair(
                client,
                model,
                analysis_request,
                normalized,
                diagnostic,
                sql_rules,
            )
            cost += report.vertex_cost_jpy(model, repair_usage)
            repaired_sql = (repaired.get("sql") or "").strip()
            if not repaired_sql:
                reason = (repaired.get("reason") or "").strip()
                detail = f" 理由: {reason}" if reason else ""
                raise SectionExecutionError(
                    "SQL担当AIが実行前診断を解消できなかったため実行しません。"
                    + detail
                )
            normalized, validation_error = report.validate_sql(
                repaired_sql, allowed_dataset, **policy_args
            )
            if validation_error:
                raise SectionExecutionError(
                    f"修正SQLを安全検査で拒否しました: {validation_error}"
                )
            assert normalized is not None
            normalized = source.normalize_sql(normalized)
            period_diagnostic = _period_diagnostic(
                normalized, period, policy, fallback_period_check
            )
            if period_diagnostic and allow_period_repair:
                period_diagnostic += (
                    " 修正要件: "
                    + _period_repair_guidance(period, policy, fallback_period_guidance)
                )
            if period_diagnostic and not allow_period_repair:
                raise SectionExecutionError(period_diagnostic)
            answer = repaired
            repair_used = True
    send(
        {
            "type": "sql",
            "sql": report.format_sql_for_display(normalized),
            "sql_sha256": hashlib.sha256(normalized.encode()).hexdigest()[:16],
            "reason": answer.get("reason", ""),
        }
    )
    send(
        {
            "type": "stage",
            "stage": "execute",
            "message": "BigQueryで読み取り実行中です。",
        }
    )
    send(
        _execute_section_result(
            section,
            normalized,
            bq=bq,
            allowed_dataset=allowed_dataset,
            max_result_rows=result_row_limit,
            cost=cost,
            policy=policy,
        )
    )
    return cost

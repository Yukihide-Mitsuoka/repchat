"""Run one AI-authored analysis section through the guarded query pipeline."""

from __future__ import annotations

import hashlib
from typing import Callable

import analysis_contract_context
import contract_period_validation
import contract_result_validation
import run_report as report
import sql_contract_validation as sql_contracts
import visualization_results
from analysis_contract import AnalysisContract


class SectionExecutionError(RuntimeError):
    """Raised when a section cannot safely complete its execution pipeline."""


def _period_diagnostic(
    sql: str,
    policy: analysis_contract_context.AnalysisExecutionPolicy,
) -> str:
    """Validate time constraints only through the canonical contract policy."""
    return contract_period_validation.contract_period_diagnostic(sql, policy)


def _period_repair_guidance(
    policy: analysis_contract_context.AnalysisExecutionPolicy,
) -> str:
    """Render repair instructions from the same boundary used for validation."""
    return contract_period_validation.contract_period_repair_guidance(policy.period)


def _dashboard_sql_diagnostic(
    section: dict,
    sql: str,
    bq: object,
    period_diagnostic: str,
    policy: analysis_contract_context.AnalysisExecutionPolicy,
) -> str:
    """Return the first repairable pre-execution diagnostic in policy order."""
    if period_diagnostic:
        return period_diagnostic
    try:
        sql_contracts.validate_generated_dashboard_sql(section, sql)
    except sql_contracts.SQLContractError as validation_error:
        return str(validation_error)
    dry_schema, dry_error = report.inspect_bq_schema(bq, sql, policy=policy)
    if dry_error:
        if not report.repairable_dry_run_error(dry_error):
            raise SectionExecutionError(f"BigQuery dry runに失敗しました: {dry_error}")
        return dry_error
    assert dry_schema is not None
    contract_diagnostic = contract_result_validation.contract_result_diagnostic(
        section, dry_schema, policy
    )
    if contract_diagnostic:
        return contract_diagnostic
    try:
        sql_contracts.validate_dashboard_dry_run_schema(
            section, [(field[0], field[1]) for field in dry_schema]
        )
    except sql_contracts.SQLContractError as validation_error:
        return str(validation_error)
    return ""


def _execute_section_result(
    section: dict,
    sql: str,
    *,
    bq: object,
    max_result_rows: int,
    cost: float,
    policy: analysis_contract_context.AnalysisExecutionPolicy,
) -> dict:
    """Reject invalid query results before constructing the result event."""
    result, error = report.exec_bq(
        bq,
        sql,
        max_results=max_result_rows + 1,
        policy=policy,
    )
    if error:
        raise SectionExecutionError(f"BigQuery実行に失敗しました: {error}")
    assert result is not None
    rows, columns = result
    if len(rows) > max_result_rows:
        raise SectionExecutionError(
            f"結果が{max_result_rows}行を超えたため描画しません。集計条件を追加してください。"
        )
    contract_diagnostic = contract_result_validation.contract_result_diagnostic(
        section, columns, policy
    )
    if contract_diagnostic:
        raise SectionExecutionError(contract_diagnostic)
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
    emit: Callable[[dict], None],
    *,
    client: object,
    bq: object,
    model: str,
    contract: AnalysisContract,
    max_result_rows: int,
    context: dict | None = None,
) -> float:
    """Generate, validate, execute, and optionally verify one panel."""
    extra = context or {}
    policy = analysis_contract_context.execution_policy(contract)
    result_row_limit = min(max_result_rows, policy.maximum_result_rows)
    sql_rules = analysis_contract_context.sql_rules(contract)
    period = analysis_contract_context.planning_period(contract)

    def send(event: dict) -> None:
        emit({**event, **extra})

    send(
        {
            "type": "stage",
            "stage": "generate",
            "message": "Vertex AIでSQLを生成中です。",
        }
    )
    request = report.generation_request(section, period)
    if extra.get("clarification_answer"):
        request += (
            "\n（利用者が未定義条件について追加した回答。ここに書かれた条件だけを使って対象を確定し、"
            "回答にない条件は推測しない）\n"
            f"{extra['clarification_answer'].strip()}"
        )
    answer, usage = report.generate_request(client, model, request, sql_rules)
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
    normalized, error = report.validate_sql(sql, policy=policy)
    if error:
        raise SectionExecutionError(f"生成SQLを安全検査で拒否しました: {error}")
    assert normalized is not None
    allow_period_repair = extra.get("operation") == "dashboard"
    period_diagnostic = _period_diagnostic(normalized, policy)
    if period_diagnostic and allow_period_repair:
        period_diagnostic += (
            f" 修正要件: {_period_repair_guidance(policy)}"
        )
    if period_diagnostic and (
        not allow_period_repair or not section.get("source_columns")
    ):
        raise SectionExecutionError(period_diagnostic)
    if not section.get("source_columns"):
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
        analysis_request = request
        repair_used = False
        while True:
            diagnostic = _dashboard_sql_diagnostic(
                section,
                normalized,
                bq,
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
                repaired_sql, policy=policy
            )
            if validation_error:
                raise SectionExecutionError(
                    f"修正SQLを安全検査で拒否しました: {validation_error}"
                )
            assert normalized is not None
            period_diagnostic = _period_diagnostic(normalized, policy)
            if period_diagnostic and allow_period_repair:
                period_diagnostic += (
                    " 修正要件: "
                    + _period_repair_guidance(policy)
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
            max_result_rows=result_row_limit,
            cost=cost,
            policy=policy,
        )
    )
    return cost

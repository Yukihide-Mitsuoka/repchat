"""Run one AI-authored analysis section through the guarded query pipeline."""

from __future__ import annotations

import hashlib
from typing import Callable

import bitcoin_profile as bitcoin
import run_report as report
import sql_contract_validation as sql_contracts
import visualization_results


class SectionExecutionError(RuntimeError):
    """Raised when a section cannot safely complete its execution pipeline."""


def run_section(
    section: dict,
    period: dict[str, str],
    emit: Callable[[dict], None],
    *,
    client: object,
    bq: object,
    model: str,
    rules: str,
    bitcoin_rules: str,
    max_result_rows: int,
    context: dict | None = None,
    profile: str = "ga4",
) -> float:
    """Generate, validate, execute, and optionally verify one panel."""
    extra = context or {}

    def send(event: dict) -> None:
        emit({**event, **extra})

    send(
        {
            "type": "stage",
            "stage": "generate",
            "message": "Vertex AIでSQLを生成中です。",
        }
    )
    if profile == "bitcoin":
        request = bitcoin.generation_request(section, period)
        if extra.get("clarification_answer"):
            request += (
                "\n（利用者が未定義条件について追加した回答。ここに書かれた条件だけを使って対象を確定し、"
                "回答にない条件は推測しない）\n"
                f"{extra['clarification_answer'].strip()}"
            )
        answer, usage = report.generate_request(
            client,
            model,
            request,
            bitcoin_rules,
        )
        allowed_dataset = bitcoin.DATASET
    else:
        if extra.get("clarification_answer"):
            answer, usage = report.generate(
                client,
                model,
                section,
                period,
                rules,
                clarification_answer=extra["clarification_answer"],
            )
        else:
            answer, usage = report.generate(
                client, model, section, period, rules
            )
        allowed_dataset = report.DATASET
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
    normalized, error = report.validate_sql(sql, allowed_dataset)
    if error:
        raise SectionExecutionError(f"生成SQLを安全検査で拒否しました: {error}")
    assert normalized is not None
    if profile == "bitcoin":
        normalized = bitcoin.quote_reserved_hash_identifiers(normalized)
    period_diagnostic = sql_contracts.sql_period_diagnostic(normalized, period, profile)
    allow_period_repair = extra.get("operation") == "dashboard"
    if period_diagnostic and (
        not allow_period_repair or not section.get("source_columns")
    ):
        raise SectionExecutionError(period_diagnostic)
    if section.get("source_columns"):
        send(
            {
                "type": "stage",
                "stage": "validate",
                "message": "描画仕様とBigQuery dry runの出力schemaを照合中です。",
            }
        )
        analysis_request = (
            bitcoin.generation_request(section, period)
            if profile == "bitcoin"
            else report.generation_request(section, period)
        )
        repair_used = False
        while True:
            diagnostic = period_diagnostic if allow_period_repair else ""
            if not diagnostic:
                try:
                    sql_contracts.validate_generated_dashboard_sql(section, normalized)
                except sql_contracts.SQLContractError as validation_error:
                    diagnostic = str(validation_error)
            if not diagnostic:
                dry_schema, dry_error = report.inspect_bq_schema(
                    bq, normalized, allowed_dataset=allowed_dataset
                )
                if dry_error:
                    if not report.repairable_dry_run_error(dry_error):
                        raise SectionExecutionError(
                            f"BigQuery dry runに失敗しました: {dry_error}"
                        )
                    diagnostic = dry_error
                else:
                    assert dry_schema is not None
                    try:
                        sql_contracts.validate_dashboard_dry_run_schema(section, dry_schema)
                    except sql_contracts.SQLContractError as validation_error:
                        diagnostic = str(validation_error)
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
                bitcoin_rules if profile == "bitcoin" else rules,
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
                repaired_sql, allowed_dataset
            )
            if validation_error:
                raise SectionExecutionError(
                    f"修正SQLを安全検査で拒否しました: {validation_error}"
                )
            assert normalized is not None
            if profile == "bitcoin":
                normalized = bitcoin.quote_reserved_hash_identifiers(normalized)
            period_diagnostic = sql_contracts.sql_period_diagnostic(
                normalized, period, profile
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
    result, error = report.exec_bq(
        bq,
        normalized,
        max_results=max_result_rows + 1,
        allowed_dataset=allowed_dataset,
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
    send(
        {
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
    )
    return cost

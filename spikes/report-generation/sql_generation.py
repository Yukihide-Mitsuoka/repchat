"""Bounded SQL-role generation and repair requests."""

from __future__ import annotations

import json

from structured_response import (
    StructuredResponseError,
    load_structured_json as _load_structured_json,
)
from vertex_generation import generate_content

# One bounded response contains one SQL statement, reason, and refusal metadata.
SQL_MAX_OUTPUT_TOKENS = 8192

_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "reason": {"type": "string"},
        "undefined_terms": {"type": "array", "items": {"type": "string"}},
        "clarification_question": {"type": "string"},
    },
    "required": ["sql", "reason", "undefined_terms"],
}


class SQLGenerationError(ValueError):
    """A generated SQL response failure safe to show in the local UI."""


def _load_sql_response(response) -> dict:
    try:
        return _load_structured_json(response)
    except StructuredResponseError as error:
        suffix = "今回のVertex AI呼出しは自動再実行していません。"
        if error.kind == "max_tokens":
            message = f"SQL生成が出力上限までに完了しませんでした。{suffix}"
        elif error.kind == "finish_reason":
            message = (
                "SQL生成を完了できませんでした"
                f"（終了理由: {error.finish_reason}）。{suffix}"
            )
        elif error.kind == "missing_text":
            message = f"SQL生成JSONを受け取れませんでした。{suffix}"
        else:
            message = f"SQL生成JSONを解釈できませんでした。{suffix}"
        raise SQLGenerationError(message) from error


def generation_request(section: dict) -> str:
    """Render only the confirmed, contract-bound analysis specification."""
    return (
        "次の確定済み分析仕様を共通分析契約の範囲内でSQLへ変換する。\n"
        "仕様にない意味、期間、列、計算を追加しない。\n"
        + json.dumps(section, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    )


def generate_request(client, model: str, request: str, rules: str):
    """Generate structured SQL from an already-built analysis request."""
    from google.genai import types
    from vertex_usage import token_counts

    response = generate_content(
        client,
        model=model,
        contents=request,
        config=types.GenerateContentConfig(
            system_instruction=rules,
            response_mime_type="application/json",
            max_output_tokens=SQL_MAX_OUTPUT_TOKENS,
            response_schema={
                **_JSON_SCHEMA,
                "propertyOrdering": [
                    "sql",
                    "reason",
                    "undefined_terms",
                    "clarification_question",
                ],
            },
        ),
    )
    answer = _load_sql_response(response)
    # Keep compatibility with providers/models that omit this optional field.
    answer.setdefault("clarification_question", "")
    return answer, token_counts(response.usage_metadata)


def generate(client, model: str, section: dict, rules: str):
    """Generate SQL from a contract-bound specification."""
    return generate_request(client, model, generation_request(section), rules)


def repair_request(analysis_request: str, sql: str, diagnostic: str) -> str:
    """Build one bounded correction request from a pre-execution diagnostic."""
    return f"""次の確定済み分析仕様に対して生成したSQLが実行前検証に失敗した。
分析内容、対象期間、出力列の数・順序・別名、ORDER BY、LIMITは変更せず、診断原因だけを修正すること。
固定SQLや別の分析への置換、指標の代用はしないこと。
使用する関数と構文はBigQuery Standard SQLに限ること。診断原因を解消できない場合は推測しないこと。

確定済み分析仕様:
{analysis_request}

失敗したSQL:
{sql}

実行前診断:
{diagnostic}

修正した完全なSELECT文を `sql` に返すこと。修正できない場合は `sql` を空文字にし、
推測せず理由を `reason` に返すこと。"""


def repair(
    client,
    model: str,
    analysis_request: str,
    sql: str,
    diagnostic: str,
    rules: str,
):
    """Ask the SQL role to correct one failure without changing the analysis."""
    return generate_request(
        client,
        model,
        repair_request(analysis_request, sql, diagnostic),
        rules,
    )


def repairable_dry_run_error(error: str) -> bool:
    """Return true only for SQL compiler failures, never auth or transport failures."""
    return error.startswith("bq dry-run error: BadRequest:")

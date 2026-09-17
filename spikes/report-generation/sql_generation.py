"""Bounded SQL-role generation and repair requests."""

from __future__ import annotations

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
        # ADR-0013 C5 gives an undefined term an explicit refusal field.
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


SHAPE_HINT = {
    "scalar": "値ひとつだけを、1行1列で返すこと。内訳の列は付けない。",
    "rows_unordered": "区分の列と値の列で返すこと。",
    "rows_ordered": "レポートの表にそのまま出せる列構成で返すこと。",
    "execution": (
        "問い合わせに答える最小限の列を返すこと。時系列なら1列目を日付、2列目を値にすること。"
    ),
}


def generation_request(section: dict, period: dict | None) -> str:
    """Build the user-level analysis contract independently of the model client."""
    # ADR-0013 C4. A declared shape beats a generic hint: LOG-0071 measured the
    # funnel coming back long on one run and wide on the next, with identical
    # numbers both times. Both are legitimate reports, so nothing decided it.
    if section.get("shape"):
        specification = section["shape"]
        columns = "、".join(f"「{column}」" for column in specification["columns"])
        aliases = section.get("source_columns") or []
        alias_rule = (
            "SQLの別名は " + "、".join(aliases) + " の順に、この名前で明示すること。"
            if aliases
            else "SQLの別名は ASCII の snake_case にする。"
        )
        shape = (
            f"列は {columns} の順に、この数だけ返すこと。"
            f"これらは表示名なので、{alias_rule}"
            f"行は {specification['rows']}。"
        )
    else:
        shape = SHAPE_HINT[section["compare"]]
        if section["component"] == "line":
            shape = "1列目に日付、2列目に値の、2列で返すこと。"
    period_instruction = (
        f"契約の対象期間は {period['from']} から {period['to']}。"
        if period is not None
        else "契約に時間境界はない。期間や日付列を推測して追加しない。"
    )
    request = (
        f"{section['text']}\n"
        f"（{period_instruction}）\n"
        f"（出力形式: {shape}）"
        "\n（SQLの責務: 最終SELECTは、確認済み仕様で明示されたdimensionsとmeasuresだけを返す。"
        "execution_promptの判断目的に未確認の期間・派生指標が含まれる場合は、推測で列を追加せず、"
        "分析仕様の確認不足として扱う。比較を実行する場合は、対象期間と出力列を仕様に明示する。）"
    )
    requirements = section.get("generation_requirements") or []
    if requirements:
        request += "\n（実装要件:\n" + "\n".join(
            f"- {requirement}" for requirement in requirements
        )
        request += "\n）"
    return request


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


def generate(
    client,
    model: str,
    section: dict,
    period: dict | None,
    rules: str,
    clarification_answer: str | None = None,
):
    """Generate SQL for one common-contract report section."""
    request = generation_request(section, period)
    if clarification_answer:
        request += (
            "\n（利用者が未定義条件について追加した回答。ここに書かれた条件だけを使って対象を確定し、"
            "回答にない条件は推測しない）\n"
            f"{clarification_answer.strip()}"
        )
    return generate_request(client, model, request, rules)


def repair_request(analysis_request: str, sql: str, diagnostic: str) -> str:
    """Build one bounded correction request from a pre-execution diagnostic."""
    return f"""次の確定済み分析仕様に対して生成したSQLが実行前検証に失敗した。
分析内容、対象期間、出力列の数・順序・別名、ORDER BY、LIMITは変更せず、診断原因だけを修正すること。
固定SQLや別の分析への置換、指標の代用はしないこと。
使用する関数と構文は、選択されたデータソースのSQL方言・実行環境で利用可能なものに限ること。
診断に未対応の関数や構文が含まれる場合は、同じ分析仕様を保ったまま、そのデータソースで利用可能な
表現へ修正すること。
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

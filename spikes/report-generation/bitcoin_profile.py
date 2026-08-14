"""Bounded non-GA4 profile for the live nested-schema demonstration.

This is the first public-schema slice of Issue #188, not evidence that arbitrary
private schemas work.  The profile deliberately supplies only inspected schema
metadata and explicit metric semantics to the model.
"""

from __future__ import annotations

import calendar
import re
from datetime import date

DATASET = "bigquery-public-data.crypto_bitcoin"
TABLE = f"{DATASET}.transactions"
FIRST_MONTH = date(2024, 1, 1)
LAST_MONTH = date(2024, 12, 1)

SCHEMA_DDL = f"""
-- BigQuery public dataset; block_timestamp_month is the partition column.
CREATE TABLE `{TABLE}` (
  `hash` STRING NOT NULL,               -- transaction identifier; HASH is reserved
  block_timestamp TIMESTAMP,
  block_timestamp_month DATE,
  input_count INT64,
  output_count INT64,
  input_value NUMERIC,
  output_value NUMERIC,
  fee NUMERIC,
  inputs ARRAY<STRUCT<
    index INT64,
    addresses ARRAY<STRING>,
    value NUMERIC
  >>,
  outputs ARRAY<STRUCT<
    index INT64,
    addresses ARRAY<STRING>,
    value NUMERIC
  >>
);
"""


def prompt_rules() -> str:
    """Return inspected schema facts and execution constraints without an analysis recipe."""
    return f"""あなたは BigQuery 標準SQLで分析用クエリを書く。

{SCHEMA_DDL}

規則:
- テーブル参照は必ず `{TABLE}` と完全修飾する。
- スキャン量を抑えるため、block_timestamp_month = DATE '<month-start>' を必ず使う。
- 配列列は、利用者が求める分析に必要な場合だけUNNESTする。
- hash はGoogleSQLの予約語なので、元テーブルでは t.`hash` と修飾・引用する。
  後続CTEへ渡す場合は transaction_hash という別名を使い、裸の hash は書かない。
- SELECT * は使わず、必要な列だけを明示する。
- 列の別名は ASCII snake_case にする。
- SELECT 文のみ。DDL/DML は書かない。
- 上の定義だけで答えられない語は推測せず、sql を空文字にし、undefined_terms に入れる。
- 結果は JSON で {{"sql":"...","reason":"...","undefined_terms":[]}} の形で返す。
"""


def period_for_question(question: str) -> dict[str, str]:
    """Parse one reproducible 2024 month from the Japanese question."""
    match = re.search(r"(?P<year>\d{4})年\s*(?P<month>\d{1,2})月", question)
    if match is None:
        raise ValueError("Bitcoin分析の対象月を「YYYY年M月」の形式で指定してください。")
    year, month = int(match["year"]), int(match["month"])
    try:
        first = date(year, month, 1)
    except ValueError as error:
        raise ValueError(
            "Bitcoin分析の対象月を「YYYY年M月」の形式で指定してください。"
        ) from error
    if first < FIRST_MONTH or first > LAST_MONTH:
        raise ValueError("Bitcoinデモで検証する期間は2024年1月〜12月です。")
    return {
        "from": first.isoformat(),
        "to": date(year, month, calendar.monthrange(year, month)[1]).isoformat(),
        "partition": first.isoformat(),
        "label": f"{year}年{month}月",
    }


def generation_request(item: dict, period: dict[str, str]) -> str:
    """Build the profile-specific analysis request passed to the model."""
    source_columns = "、".join(item["source_columns"])
    display_columns = "、".join(item["shape"]["columns"])
    requirements = "\n".join(f"- {value}" for value in item.get("generation_requirements", []))
    return (
        f"{item['text']}\n"
        f"（対象期間: block_timestamp_month = DATE '{period['partition']}'）\n"
        f"（描画契約: {item['planned_visualization']}。表示列: {display_columns}。"
        f"最終SELECTの列別名と順序: {source_columns}。）\n"
        f"追加の実行条件:\n{requirements}"
    )


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Reject generated SQL unless it selects only the requested partition."""
    matches = re.findall(
        r"block_timestamp_month\s*=\s*(?:DATE\s*)?['\"](\d{4}-\d{2}-\d{2})['\"]",
        sql,
        flags=re.IGNORECASE,
    )
    if matches != [period["partition"]]:
        raise ValueError(
            f"生成SQLの対象期間が問い合わせの{period['label']}と一致しません。"
        )


def quote_reserved_hash_identifiers(sql: str) -> str:
    """Quote bare Bitcoin hash identifiers without touching paths or literals.

    GoogleSQL permits the reserved HASH token after a path separator (``t.hash``)
    but not as the first part of an identifier.  The bounded Bitcoin profile knows
    that a bare HASH token can only mean the transaction column, so quoting it is a
    semantics-preserving normalization before execution.
    """
    output: list[str] = []
    index = 0
    length = len(sql)

    def quoted_end(start: int, delimiter: str) -> int:
        cursor = start + 1
        while cursor < length:
            if sql[cursor] == "\\" and cursor + 1 < length:
                cursor += 2
            elif sql[cursor] == delimiter:
                if cursor + 1 < length and sql[cursor + 1] == delimiter:
                    cursor += 2
                else:
                    return cursor + 1
            else:
                cursor += 1
        return length

    while index < length:
        if sql.startswith("--", index):
            end = sql.find("\n", index + 2)
            end = length if end == -1 else end
            output.append(sql[index:end])
            index = end
            continue
        if sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            end = length if end == -1 else end + 2
            output.append(sql[index:end])
            index = end
            continue
        if sql[index] in {"'", '"', "`"}:
            end = quoted_end(index, sql[index])
            output.append(sql[index:end])
            index = end
            continue
        if sql[index].isalpha() or sql[index] == "_":
            end = index + 1
            while end < length and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            token = sql[index:end]
            previous = index - 1
            while previous >= 0 and sql[previous].isspace():
                previous -= 1
            if token.casefold() == "hash" and (
                previous < 0 or sql[previous] != "."
            ):
                token = "`hash`"
            output.append(token)
            index = end
            continue
        output.append(sql[index])
        index += 1

    return "".join(output)

"""Inspected Bitcoin schema and safety rules for non-GA4 NL-to-SQL analysis."""

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
    """Return inspected schema semantics and SQL safety constraints."""
    return f"""あなたは BigQuery 標準SQLで分析用クエリを書く。

{SCHEMA_DDL}

スキーマ契約:
- 取引は元テーブルの1行で、識別子は hash。
- block_timestamp は取引時刻、block_timestamp_month は月単位のpartition列。
- input_count、output_count、input_value、output_value、feeは元データに記録された数値列。
- inputsとoutputsはREPEATED STRUCTで、その中のaddressesもREPEATED STRING。
- REPEATED列を使う分析だけ、必要な階層をそれぞれUNNESTする。展開後の行数を取引数と解釈しない。

規則:
- スキーマにある列と、そこから明示的に計算できる値だけを使う。
- テーブル参照は必ず `{TABLE}` と完全修飾する。
- スキャン量を抑えるため、block_timestamp_month = DATE '<month-start>' を必ず使う。
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
    """Attach the AI-confirmed output contract to one natural-language request."""
    requirements = "\n".join(
        f"- {requirement}" for requirement in item.get("generation_requirements", [])
    )
    request = (
        f"{item['text']}\n"
        f"（対象期間: block_timestamp_month = DATE '{period['partition']}'）\n"
        "（SQL出力列: "
        + ", ".join(f"`{column}`" for column in item["source_columns"])
        + " の順。）\n"
        f"（表示上の列: {'、'.join(item['shape']['columns'])}。）"
    )
    return request + (f"\n追加制約:\n{requirements}" if requirements else "")


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


def require_quoted_hash(sql: str) -> None:
    """Reject rather than rewrite an unquoted reserved hash identifier."""
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
            index = end
            continue
        if sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            end = length if end == -1 else end + 2
            index = end
            continue
        if sql[index] in {"'", '"', "`"}:
            end = quoted_end(index, sql[index])
            index = end
            continue
        if sql[index].isalpha() or sql[index] == "_":
            end = index + 1
            while end < length and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            token = sql[index:end]
            if token.casefold() == "hash":
                raise ValueError(
                    "Bitcoin SQLのhash列が引用されていないためBigQueryへ送信しません。"
                )
            index = end
            continue
        index += 1

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
EXAMPLE_QUESTION = (
    "2024年1月のBitcoin取引について、各取引の異なる受取アドレス数を、"
    "1件・2〜3件・4〜9件・10件以上に分け、取引数が多い順で出して"
)
REFERENCE_SQL = f"""WITH per_transaction AS (
    SELECT
        t.hash,
        COUNT(DISTINCT address) AS address_count
    FROM
        `{TABLE}` AS t
        CROSS JOIN UNNEST(t.outputs) AS output
        CROSS JOIN UNNEST(output.addresses) AS address
    WHERE
        t.block_timestamp_month = DATE '2024-01-01'
    GROUP BY
        t.hash
)
SELECT
    CASE
        WHEN address_count = 1 THEN '1件'
        WHEN address_count BETWEEN 2 AND 3 THEN '2〜3件'
        WHEN address_count BETWEEN 4 AND 9 THEN '4〜9件'
        ELSE '10件以上'
    END AS address_count_band,
    COUNT(1) AS transaction_count
FROM
    per_transaction
GROUP BY
    address_count_band
ORDER BY
    transaction_count DESC"""

SCHEMA_DDL = f"""
-- BigQuery public dataset; block_timestamp_month is the partition column.
CREATE TABLE `{TABLE}` (
  hash STRING NOT NULL,                 -- transaction identifier
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
    """Return the inspected schema and the smallest explicit semantic contract."""
    return f"""あなたは BigQuery 標準SQLで分析用クエリを書く。

{SCHEMA_DDL}

指標・軸の定義:
- 取引 = 元テーブルの1行。識別子は hash。
- 受取アドレス = outputs を展開し、さらに各 output.addresses を展開した address。
- 取引ごとの異なる受取アドレス数 = COUNT(DISTINCT address)。
- addresses が空または NULL の output は受取アドレス数の集計対象外。
- 取引数 = 取引ごとの集計後の行数。outputs 展開後の行数を取引数にしない。
- 受取アドレス数帯 = 1件、2〜3件、4〜9件、10件以上。0件は上の定義により対象外。

規則:
- テーブル参照は必ず `{TABLE}` と完全修飾する。
- スキャン量を抑えるため、block_timestamp_month = DATE '<month-start>' を必ず使う。
- outputs と output.addresses はそれぞれ UNNEST する。
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


def section(question: str) -> dict:
    """Build the declared two-column result contract for the demo question."""
    normalized = question.strip()
    if not normalized:
        raise ValueError("question must not be empty")
    if len(normalized) > 500:
        raise ValueError("question must be at most 500 characters")
    if any(ord(char) < 32 for char in normalized):
        raise ValueError("question must be a single line without control characters")
    if "受取アドレス" not in normalized or "取引数" not in normalized:
        raise ValueError(
            "Bitcoinデモは現在「取引ごとの受取アドレス数帯別の取引数」のみ対応します。"
        )
    return {
        "id": "BTC1",
        "title": "受取アドレス数帯別の取引数",
        "text": normalized,
        "compare": "execution",
        "component": "bar",
        "verification": "execution",
        "shape": {
            "rows": "受取アドレス数帯ごとに1行、取引数の多い順",
            "columns": ["受取アドレス数帯", "取引数"],
        },
    }


def generation_request(item: dict, period: dict[str, str]) -> str:
    """Build the profile-specific analysis request passed to the model."""
    return (
        f"{item['text']}\n"
        f"（対象期間: block_timestamp_month = DATE '{period['partition']}'）\n"
        "（出力形式: 列は `address_count_band`, `transaction_count` の順。"
        "受取アドレス数帯ごとに1行、取引数の多い順。）"
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

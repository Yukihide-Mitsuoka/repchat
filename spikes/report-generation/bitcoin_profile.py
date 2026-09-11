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


def planner_context(_metrics: str) -> str:
    """Describe available Bitcoin data without supplying analysis choices."""
    return f"""利用可能期間は2024年1月〜12月。
{SCHEMA_DDL}
利用できる情報は取引識別子、block時刻、入出力件数・金額、手数料、入出力のaddress配列である。
スキーマにない業務用語や外部価格・人物属性は推測せず、追加定義が必要だと説明する。"""


def prompt_rules() -> str:
    """Return inspected schema facts and execution constraints without an analysis recipe."""
    return f"""あなたは BigQuery 標準SQLで分析用クエリを書く。

{SCHEMA_DDL}

規則:
- テーブル参照は必ず `{TABLE}` と完全修飾する。
- スキャン量を抑えるため、対象が1か月ならblock_timestamp_month = DATE '<month-start>'、
  月範囲ならblock_timestamp_month BETWEEN DATE '<first-month>' AND DATE '<last-month>'を必ず使う。
- 配列列は、利用者が求める分析に必要な場合だけUNNESTする。
- hash はGoogleSQLの予約語なので、元テーブルでは t.`hash` と修飾・引用する。
  後続CTEへ渡す場合は transaction_hash という別名を使い、裸の hash は書かない。
- SELECT * は使わず、必要な列だけを明示する。
- 列の別名は ASCII snake_case にする。
- SELECT 文のみ。DDL/DML は書かない。
- 上の定義だけで答えられない語は推測せず、sql を空文字にし、undefined_terms に入れる。
- undefined_terms が空でない場合は、clarification_question に不足している対象条件を尋ねる
  日本語1文を返す。undefined_terms が空の場合は空文字にする。
- 結果は JSON で {{"sql":"...","reason":"...","undefined_terms":[],"clarification_question":"..."}} の形で返す。
"""


def period_for_question(question: str) -> dict[str, str]:
    """Parse one reproducible 2024 month or explicit month range."""
    range_match = re.search(
        r"(?P<start_year>\d{4})年\s*(?P<start_month>\d{1,2})月\s*"
        r"(?:から|〜|～|－|—|-)\s*"
        r"(?:(?P<end_year>\d{4})年\s*)?(?P<end_month>\d{1,2})月(?:\s*まで)?",
        question,
    )
    match = range_match or re.search(
        r"(?P<start_year>\d{4})年\s*(?P<start_month>\d{1,2})月", question
    )
    if match is None:
        raise ValueError("Bitcoin分析の対象月を「YYYY年M月」の形式で指定してください。")
    start_year, start_month = int(match["start_year"]), int(match["start_month"])
    end_year = int(match["end_year"] or start_year) if range_match else start_year
    end_month = int(match["end_month"]) if range_match else start_month
    try:
        first = date(start_year, start_month, 1)
        last = date(end_year, end_month, 1)
    except ValueError as error:
        raise ValueError(
            "Bitcoin分析の対象月を「YYYY年M月」の形式で指定してください。"
        ) from error
    if first > last:
        raise ValueError("Bitcoin分析の終了月は開始月以降を指定してください。")
    if first < FIRST_MONTH or last > LAST_MONTH:
        raise ValueError("Bitcoinデモで検証する期間は2024年1月〜12月です。")
    period = {
        "from": first.isoformat(),
        "to": date(
            end_year, end_month, calendar.monthrange(end_year, end_month)[1]
        ).isoformat(),
        "partition": first.isoformat(),
        "label": (
            f"{start_year}年{start_month}月"
            if first == last
            else (
                f"{start_year}年{start_month}月〜{end_month}月"
                if start_year == end_year
                else f"{start_year}年{start_month}月〜{end_year}年{end_month}月"
            )
        ),
    }
    if first != last:
        period["partition_to"] = last.isoformat()
    return period


def _period_predicate(period: dict[str, str]) -> str:
    """Return the one exact partition predicate required for this period."""
    last_partition = period.get("partition_to")
    if last_partition:
        return (
            f"block_timestamp_month BETWEEN DATE '{period['partition']}' "
            f"AND DATE '{last_partition}'"
        )
    return f"block_timestamp_month = DATE '{period['partition']}'"


def generation_request(item: dict, period: dict[str, str]) -> str:
    """Build the profile-specific analysis request passed to the model."""
    source_columns = "、".join(item["source_columns"])
    display_columns = "、".join(item["shape"]["columns"])
    requirements = "\n".join(f"- {value}" for value in item.get("generation_requirements", []))
    return (
        f"{item['text']}\n"
        f"（対象期間: {_period_predicate(period)}）\n"
        f"（描画契約: {item['planned_visualization']}。表示列: {display_columns}。"
        f"最終SELECTの列別名と順序: {source_columns}。）\n"
        f"追加の実行条件:\n{requirements}"
    )


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Reject generated SQL unless it selects only the requested partition range."""
    equalities = re.findall(
        r"block_timestamp_month\s*=\s*(?:DATE\s*)?['\"](\d{4}-\d{2}-\d{2})['\"]",
        sql,
        flags=re.IGNORECASE,
    )
    ranges = re.findall(
        r"block_timestamp_month\s+BETWEEN\s+(?:DATE\s*)?"
        r"['\"](\d{4}-\d{2}-\d{2})['\"]\s+AND\s+(?:DATE\s*)?"
        r"['\"](\d{4}-\d{2}-\d{2})['\"]",
        sql,
        flags=re.IGNORECASE,
    )
    expected_range = period.get("partition_to")
    valid = (
        equalities == [period["partition"]] and not ranges
        if expected_range is None
        else not equalities and ranges == [(period["partition"], expected_range)]
    )
    if not valid:
        raise ValueError(
            f"生成SQLの対象期間が問い合わせの{period['label']}と一致しません。"
        )


def period_repair_guidance(period: dict[str, str]) -> str:
    """Describe the exact Bitcoin partition contract for one bounded repair."""
    return (
        f"すべてのtransactions参照で {_period_predicate(period)} を使う。"
        "期間内の比較条件はblock_timestamp_monthを変更せず、"
        "block_timestamp等を使った条件付き集約で表す。"
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

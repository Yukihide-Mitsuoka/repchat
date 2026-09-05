"""GA4 public-sample data-source contract for the shared analysis pipeline."""

from __future__ import annotations

import calendar
import re
from datetime import date

import bigquery_execution
import sql_contract_validation
import sql_prompt_context

DATASET = bigquery_execution.DATASET
SAMPLE_FIRST_DAY = date(2020, 11, 1)
SAMPLE_LAST_DAY = date(2021, 1, 31)


def planner_context(metrics: str) -> str:
    """Describe available data without supplying an analysis proposal."""
    return f"""利用可能期間は2020年11月〜2021年1月。未指定時は2021年1月を提案に使う。
{sql_prompt_context.SCHEMA_DDL}
定義済み指標:
{metrics}
指標定義にない語は推測せず、追加定義が必要だと説明する。"""


def sql_rules(metrics: str) -> str:
    """Return the SQL-agent rules bound to the inspected GA4 schema."""
    return sql_prompt_context.prompt_rules(metrics)


def period_for_question(question: str) -> dict[str, str]:
    """Return the explicit month in a question, bounded by the sample dataset."""
    match = re.search(r"(?P<year>\d{4})年\s*(?P<month>\d{1,2})月", question)
    if match is None:
        raise ValueError("対象月を「YYYY年M月」の形式で指定してください。")
    year, month = int(match["year"]), int(match["month"])
    try:
        first = date(year, month, 1)
    except ValueError as error:
        raise ValueError("対象月を「YYYY年M月」の形式で指定してください。") from error
    last = date(year, month, calendar.monthrange(year, month)[1])
    if first < SAMPLE_FIRST_DAY or last > SAMPLE_LAST_DAY:
        raise ValueError("公開サンプルで利用できる期間は2020年11月〜2021年1月です。")
    return {
        "from": first.strftime("%Y%m%d"),
        "to": last.strftime("%Y%m%d"),
        "label": f"{year}年{month}月",
    }


def generation_request(section: dict, period: dict[str, str]) -> str:
    """Build the shared analysis request using the GA4 period contract."""
    import run_report as report

    return report.generation_request(section, period)


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Fail closed when generated SQL does not use the requested date shards."""
    sql_contract_validation.require_sql_period(sql, period)


def normalize_sql(sql: str) -> str:
    """Return GA4 SQL unchanged; formatting is display-only elsewhere."""
    return sql

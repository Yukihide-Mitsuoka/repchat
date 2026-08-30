"""Validate numeric claims and derived metrics against immutable report evidence."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from meeting_report_contracts import FUNNEL_RATE_DECIMAL_PLACES, REPORT_DECIMAL_PLACES

NUMBER = re.compile(r"(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")


class ReportError(ValueError):
    """A report contract violation safe to show in the local UI."""


def _decimal(value) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _rounded_number(value, decimal_places: int) -> int | float:
    number = _decimal(value)
    if number is None:
        raise ReportError("根拠パネルの派生指標に数値以外が含まれています。")
    quantum = Decimal(1).scaleb(-decimal_places)
    try:
        rounded = number.quantize(quantum, rounding=ROUND_HALF_UP)
    except InvalidOperation as error:
        raise ReportError("根拠パネルの数値を指定精度へ丸められません。") from error
    return int(rounded) if rounded == rounded.to_integral() else float(rounded)


def funnel_conversion_metrics(columns: list, rows: list) -> list[dict]:
    """Return explicitly reproducible rates for one validated funnel result."""
    if (
        not isinstance(columns, list)
        or not isinstance(rows, list)
        or len(rows) != 1
        or not isinstance(rows[0], list)
        or len(columns) < 2
        or len(rows[0]) != len(columns)
        or any(_decimal(value) is None for value in rows[0])
    ):
        return []
    pairs = [(index, index + 1) for index in range(len(columns) - 1)]
    if len(columns) > 2:
        pairs.append((0, len(columns) - 1))
    metrics = []
    for denominator_index, numerator_index in pairs:
        denominator = _decimal(rows[0][denominator_index])
        numerator = _decimal(rows[0][numerator_index])
        assert denominator is not None and numerator is not None
        if denominator <= 0:
            continue
        value = numerator / denominator * 100
        metrics.append(
            {
                "name": f"{columns[denominator_index]}から{columns[numerator_index]}への転換率",
                "operation": "percent",
                "numerator_column": columns[numerator_index],
                "denominator_column": columns[denominator_index],
                "decimal_places": FUNNEL_RATE_DECIMAL_PLACES,
                "value": _rounded_number(value, FUNNEL_RATE_DECIMAL_PLACES),
            }
        )
    return metrics


def _validate_derived_metrics(panel: dict) -> None:
    supplied = panel.get("derived_metrics")
    if supplied is None:
        return
    expected = (
        funnel_conversion_metrics(panel["columns"], panel["rows"])
        if panel.get("visualization") == "funnel"
        else []
    )
    if supplied != expected:
        raise ReportError(f"根拠パネル{panel['id']}の派生指標が不正です。")


def _number_tokens(value) -> set[str]:
    def canonical(token: str) -> str:
        token = token.replace(",", "")
        return token.rstrip("0").rstrip(".") if "." in token else token

    return {canonical(match.group()) for match in NUMBER.finditer(str(value))}


def _report_number_tokens(value) -> set[str]:
    tokens = _number_tokens(value)
    number = _decimal(value)
    if number is not None and number != number.to_integral():
        tokens.update(_number_tokens(_rounded_number(number, REPORT_DECIMAL_PLACES)))
    return tokens


def _evidence_numbers(indexed: dict[str, dict], panel_ids: list[str]) -> set[str]:
    values: set[str] = set()
    for panel_id in panel_ids:
        panel = indexed[panel_id]
        source = [panel.get("period", ""), *panel["columns"], *panel["rows"]]
        values.update(_number_tokens(source))
        for row in panel["rows"]:
            for value in row:
                values.update(_report_number_tokens(value))
        for metric in panel.get("derived_metrics", []):
            values.update(_number_tokens(metric["value"]))
    return values


def _validate_numbers(text: str, indexed: dict[str, dict], panel_ids: list[str]) -> None:
    stated = _number_tokens(text)
    # Dates, panel IDs, and numbered prose must not be embedded in claim text;
    # this keeps the allowlist small and makes unsupported values fail closed.
    unsupported = stated - _evidence_numbers(indexed, panel_ids)
    if unsupported:
        raise ReportError(
            "会議報告に根拠パネルへ存在しない数値があります: "
            + "、".join(sorted(unsupported))
        )

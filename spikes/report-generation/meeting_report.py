"""Evidence-bounded executive commentary for the local dashboard demo."""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

NUMBER = re.compile(r"(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
MAX_BUNDLE_BYTES = 48 * 1024
MAX_OUTPUT_TOKENS = 8192
SUMMARY_MAX_CHARS = 160
CLAIM_MAX_CHARS = 120
DETAIL_MAX_CHARS = 80
SHORT_DETAIL_MAX_CHARS = 40
MAX_PANEL_REFS = 6
REPORT_DECIMAL_PLACES = 2
FUNNEL_RATE_DECIMAL_PLACES = 1
REPORT_ITEM_LIMITS = {
    "observations": 3,
    "interpretations": 2,
    "hypotheses": 2,
    "actions": 2,
    "limitations": 3,
}


def _bounded_string(max_length: int) -> dict:
    return {"type": "string", "maxLength": max_length}


def _panel_ids_schema() -> dict:
    return {
        "type": "array",
        "items": {"type": "string"},
        "minItems": 1,
        "maxItems": MAX_PANEL_REFS,
    }


REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "executive_summary": {
            "type": "object",
            "properties": {
                "text": _bounded_string(SUMMARY_MAX_CHARS),
                "panel_ids": _panel_ids_schema(),
            },
            "required": ["text", "panel_ids"],
        },
        "observations": {
            "type": "array",
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["observations"],
            "items": {
                "type": "object",
                "properties": {
                    "text": _bounded_string(CLAIM_MAX_CHARS),
                    "panel_ids": _panel_ids_schema(),
                },
                "required": ["text", "panel_ids"],
            },
        },
        "interpretations": {
            "type": "array",
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["interpretations"],
            "items": {
                "type": "object",
                "properties": {
                    "text": _bounded_string(CLAIM_MAX_CHARS),
                    "uncertainty": _bounded_string(DETAIL_MAX_CHARS),
                    "panel_ids": _panel_ids_schema(),
                },
                "required": ["text", "uncertainty", "panel_ids"],
            },
        },
        "hypotheses": {
            "type": "array",
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["hypotheses"],
            "items": {
                "type": "object",
                "properties": {
                    "text": _bounded_string(CLAIM_MAX_CHARS),
                    "validation": _bounded_string(DETAIL_MAX_CHARS),
                    "panel_ids": _panel_ids_schema(),
                },
                "required": ["text", "validation", "panel_ids"],
            },
        },
        "actions": {
            "type": "array",
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["actions"],
            "items": {
                "type": "object",
                "properties": {
                    "text": _bounded_string(CLAIM_MAX_CHARS),
                    "owner": _bounded_string(SHORT_DETAIL_MAX_CHARS),
                    "urgency": _bounded_string(SHORT_DETAIL_MAX_CHARS),
                    "expected_impact": _bounded_string(DETAIL_MAX_CHARS),
                    "next_step": _bounded_string(DETAIL_MAX_CHARS),
                    "success_metric": _bounded_string(SHORT_DETAIL_MAX_CHARS),
                    "panel_ids": _panel_ids_schema(),
                },
                "required": [
                    "text",
                    "owner",
                    "urgency",
                    "expected_impact",
                    "next_step",
                    "success_metric",
                    "panel_ids",
                ],
            },
        },
        "limitations": {
            "type": "array",
            "items": _bounded_string(CLAIM_MAX_CHARS),
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["limitations"],
        },
    },
    "required": [
        "executive_summary", "observations", "interpretations",
        "hypotheses", "actions", "limitations",
    ],
}


class ReportError(ValueError):
    """A report contract violation safe to show in the local UI."""

def report_request(bundle: dict) -> str:
    """Build a Japanese reporting request from one immutable evidence bundle."""
    return f"""次の確定済みダッシュボードだけを根拠に、月次会議の報告案を書く。

分析仕様revision: {bundle['plan_revision']}
build revision: {bundle['build_revision']}
組織コンテキストrevision: {bundle['organization_context_revision']}
組織コンテキスト: {json.dumps(bundle['organization_context'], ensure_ascii=False)}
確定済み分析仕様: {json.dumps(bundle['analysis_specification'], ensure_ascii=False)}
指標定義: {json.dumps(bundle['metric_definitions'], ensure_ascii=False)}
根拠パネル: {json.dumps(bundle['panels'], ensure_ascii=False)}

規則:
- 観測、解釈、未検証の仮説、推奨アクションを混ぜない。
- 数値は根拠パネルの生値、その値を最大小数2桁へ丸めた値、またはderived_metricsに記録された値だけを使い、必ずpanel_idsを付ける。
- 相関を因果と断定せず、解釈には不確実性を、仮説には検証方法を付ける。
- アクションには期待効果、担当、緊急度、次の一歩、成功指標を付ける。
- 目標値、事業事情、サンプルサイズを推測しない。不足はlimitationsへ書く。
- limitationsへ根拠リンクのない数値を書かない。
- 読み手は日本語の月次マーケティング会議参加者。SQL用語は使わない。
- executive_summaryにもtextとpanel_idsを付ける。数値は参照した根拠パネルに存在する値だけを書く。
- executive_summaryは{SUMMARY_MAX_CHARS}文字以内、各本文は{CLAIM_MAX_CHARS}文字以内の一文にする。
- 観測は最大{REPORT_ITEM_LIMITS['observations']}件、解釈は最大{REPORT_ITEM_LIMITS['interpretations']}件、未検証の仮説は最大{REPORT_ITEM_LIMITS['hypotheses']}件、推奨アクションは最大{REPORT_ITEM_LIMITS['actions']}件、limitationsは最大{REPORT_ITEM_LIMITS['limitations']}件に絞る。
- 不確実性、検証方法、期待効果、次の一歩は各{DETAIL_MAX_CHARS}文字以内、担当、緊急度、成功指標は各{SHORT_DETAIL_MAX_CHARS}文字以内にする。
"""

def _text(value, label: str, max_length: int | None = None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ReportError(f"会議報告の{label}が空です。")
    if max_length is not None and len(normalized) > max_length:
        raise ReportError(f"会議報告の{label}は{max_length}文字以内にしてください。")
    return normalized

def _evidence_index(bundle: dict) -> dict[str, dict]:
    """Validate immutable provenance before any generated claim is accepted."""
    encoded = json.dumps(bundle, ensure_ascii=False, sort_keys=True).encode()
    if len(encoded) > MAX_BUNDLE_BYTES:
        raise ReportError("会議報告の根拠bundleが48 KiBを超えています。")
    required_revisions = {
        "plan_revision": r"plan-[0-9a-f]{12}",
        "build_revision": r"build-[0-9a-f]{12}",
        "organization_context_revision": r"[a-z0-9-]+",
    }
    for field, pattern in required_revisions.items():
        if not re.fullmatch(pattern, str(bundle.get(field, ""))):
            raise ReportError(f"根拠bundleの{field}が不正です。")
    organization = bundle.get("organization_context")
    specification = bundle.get("analysis_specification")
    definitions = bundle.get("metric_definitions")
    if not isinstance(organization, dict) or organization.get("revision") != bundle[
        "organization_context_revision"
    ]:
        raise ReportError("組織コンテキストrevisionが根拠bundleと一致しません。")
    if not isinstance(specification, dict) or specification.get("revision") != bundle[
        "plan_revision"
    ]:
        raise ReportError("分析仕様revisionが根拠bundleと一致しません。")
    if not isinstance(definitions, dict) or not definitions:
        raise ReportError("根拠bundleに指標定義がありません。")
    panels = bundle.get("panels")
    if not isinstance(panels, list) or not panels:
        raise ReportError("会議報告の根拠パネルがありません。")
    indexed = {}
    for panel in panels:
        panel_id = panel.get("id") if isinstance(panel, dict) else None
        if not isinstance(panel_id, str) or panel_id in indexed:
            raise ReportError("根拠パネルIDが不正または重複しています。")
        if not re.fullmatch(r"[0-9a-f]{16}", str(panel.get("sql_sha256", ""))):
            raise ReportError(f"根拠パネル{panel_id}のSQL revisionが不正です。")
        if not re.fullmatch(r"result-[0-9a-f]{12}", str(panel.get("result_revision", ""))):
            raise ReportError(f"根拠パネル{panel_id}の結果revisionが不正です。")
        if not isinstance(panel.get("columns"), list) or not isinstance(
            panel.get("rows"), list
        ):
            raise ReportError(f"根拠パネル{panel_id}の結果形状が不正です。")
        _validate_derived_metrics(panel)
        indexed[panel_id] = panel
    return indexed

def _panel_ids(item: dict, known: set[str]) -> list[str]:
    ids = item.get("panel_ids") if isinstance(item, dict) else None
    if not isinstance(ids, list) or not ids or any(panel_id not in known for panel_id in ids):
        raise ReportError("会議報告の根拠パネルが未登録または空です。")
    if len(ids) > MAX_PANEL_REFS:
        raise ReportError(f"会議報告の根拠パネルは{MAX_PANEL_REFS}件以内にしてください。")
    return list(dict.fromkeys(ids))

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

def normalize_report(raw: dict, bundle: dict) -> dict:
    """Validate citations and reject numerical claims absent from evidence."""
    if not isinstance(raw, dict) or not isinstance(bundle, dict):
        raise ReportError("会議報告または根拠bundleがobjectではありません。")
    indexed = _evidence_index(bundle)
    known = set(indexed)

    def cited(
        item: dict,
        label: str,
        extra: dict[str, int] | None = None,
        text_limit: int = CLAIM_MAX_CHARS,
    ) -> dict:
        ids = _panel_ids(item, known)
        text = _text(item.get("text"), label, text_limit)
        _validate_numbers(text, indexed, ids)
        details = {
            field: _text(item.get(field), field, limit)
            for field, limit in (extra or {}).items()
        }
        for value in details.values():
            _validate_numbers(value, indexed, ids)
        evidence_refs = [
            {
                "panel_id": panel_id,
                "sql_sha256": indexed[panel_id]["sql_sha256"],
                "result_revision": indexed[panel_id]["result_revision"],
            }
            for panel_id in ids
        ]
        return {"text": text, **details, "panel_ids": ids, "evidence_refs": evidence_refs}

    def items(name: str, limit: int, extra: dict[str, int] | None = None) -> list[dict]:
        source = raw.get(name)
        if not isinstance(source, list) or not source:
            raise ReportError(f"会議報告の{name}がありません。")
        if len(source) > limit:
            raise ReportError(f"会議報告の{name}は{limit}件以内にしてください。")
        return [cited(item, name, extra) for item in source]

    summary_source = raw.get("executive_summary")
    if isinstance(summary_source, str):
        summary_text = _text(summary_source, "要約", SUMMARY_MAX_CHARS)
        if re.search(r"\d", summary_text):
            raise ReportError("会議報告の要約には根拠リンクのない数値を書けません。")
        summary = {"text": summary_text, "panel_ids": [], "evidence_refs": []}
    else:
        summary = cited(summary_source, "要約", text_limit=SUMMARY_MAX_CHARS)
    limitations = raw.get("limitations")
    if not isinstance(limitations, list):
        raise ReportError("会議報告のlimitationsが配列ではありません。")
    report = {
        "status": "draft_requires_human_approval",
        "executive_summary": summary,
        "observations": items("observations", REPORT_ITEM_LIMITS["observations"]),
        "interpretations": items(
            "interpretations",
            REPORT_ITEM_LIMITS["interpretations"],
            {"uncertainty": DETAIL_MAX_CHARS},
        ),
        "hypotheses": items(
            "hypotheses",
            REPORT_ITEM_LIMITS["hypotheses"],
            {"validation": DETAIL_MAX_CHARS},
        ),
        "actions": items(
            "actions",
            REPORT_ITEM_LIMITS["actions"],
            {
                "owner": SHORT_DETAIL_MAX_CHARS,
                "urgency": SHORT_DETAIL_MAX_CHARS,
                "expected_impact": DETAIL_MAX_CHARS,
                "next_step": DETAIL_MAX_CHARS,
                "success_metric": SHORT_DETAIL_MAX_CHARS,
            },
        ),
        "limitations": [
            _text(value, "限界", CLAIM_MAX_CHARS) for value in limitations
        ],
        "plan_revision": bundle["plan_revision"],
        "build_revision": bundle["build_revision"],
        "organization_context_revision": bundle["organization_context_revision"],
    }
    if not report["limitations"]:
        raise ReportError("会議報告には少なくとも1件の限界を明示してください。")
    if len(report["limitations"]) > REPORT_ITEM_LIMITS["limitations"]:
        raise ReportError(
            f"会議報告のlimitationsは{REPORT_ITEM_LIMITS['limitations']}件以内にしてください。"
        )
    if any(NUMBER.search(value) for value in report["limitations"]):
        raise ReportError("会議報告のlimitationsには根拠リンクのない数値を書けません。")
    canonical = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    report["report_revision"] = "report-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    return report

def generate(client, model: str, bundle: dict):
    """Generate and validate one report draft without another warehouse query."""
    from google.genai import types

    _evidence_index(bundle)
    response = client.models.generate_content(
        model=model,
        contents=report_request(bundle),
        config=types.GenerateContentConfig(
            system_instruction="あなたは根拠と不確実性を明示する日本語BI報告者。",
            response_mime_type="application/json",
            response_schema=REPORT_SCHEMA,
            temperature=0,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.LOW
            ),
            max_output_tokens=MAX_OUTPUT_TOKENS,
        ),
    )
    candidates = getattr(response, "candidates", None) or []
    reason = getattr(candidates[0], "finish_reason", None) if candidates else None
    finish_reason = getattr(reason, "value", reason)
    if finish_reason == "MAX_TOKENS":
        raise ReportError(
            "会議報告が出力上限までに完了しませんでした。"
            "今回のVertex AI呼出しは課金対象で、自動再実行していません。"
        )
    try:
        raw = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as error:
        raise ReportError(
            "会議報告のJSONが不完全です。"
            "今回のVertex AI呼出しは課金対象で、自動再実行していません。"
        ) from error
    usage = response.usage_metadata
    return normalize_report(raw, bundle), {
        "input_tokens": usage.prompt_token_count or 0,
        "output_tokens": (usage.candidates_token_count or 0)
        + (getattr(usage, "thoughts_token_count", 0) or 0),
    }

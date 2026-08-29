"""Response schema and bounded limits for generated meeting reports."""

import json

MAX_BUNDLE_BYTES = 48 * 1024
MAX_OUTPUT_TOKENS = 8192
SUMMARY_MAX_CHARS = 160
SUMMARY_GENERATION_TARGET_CHARS = 120
CLAIM_MAX_CHARS = 120
DETAIL_MAX_CHARS = 80
SHORT_DETAIL_MAX_CHARS = 40
MAX_PANEL_REFS = 6
REPORT_DECIMAL_PLACES = 2
FUNNEL_RATE_DECIMAL_PLACES = 1
NO_DIGITS_PATTERN = r"^[^0-9０-９]*$"
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
            "items": {
                **_bounded_string(CLAIM_MAX_CHARS),
                "pattern": NO_DIGITS_PATTERN,
            },
            "minItems": 1,
            "maxItems": REPORT_ITEM_LIMITS["limitations"],
        },
    },
    "required": [
        "executive_summary",
        "observations",
        "interpretations",
        "hypotheses",
        "actions",
        "limitations",
    ],
}


def report_request(bundle: dict, allowed_numbers: str) -> str:
    """Render the bounded Japanese report request from validated evidence."""
    return f"""次の確定済みダッシュボードだけを根拠に、月次会議の報告案を書く。

分析仕様revision: {bundle['plan_revision']}
build revision: {bundle['build_revision']}
組織コンテキストrevision: {bundle['organization_context_revision']}
組織コンテキスト: {json.dumps(bundle['organization_context'], ensure_ascii=False)}
確定済み分析仕様: {json.dumps(bundle['analysis_specification'], ensure_ascii=False)}
指標定義: {json.dumps(bundle['metric_definitions'], ensure_ascii=False)}
根拠パネル: {json.dumps(bundle['panels'], ensure_ascii=False)}
根拠パネルに存在する許可数値（この一覧にない数値は使用禁止）: {allowed_numbers}

規則:
- 観測、解釈、未検証の仮説、推奨アクションを混ぜない。
- 数値は根拠パネルの生値、その値を小数点以下2桁まで丸めた値、またはderived_metricsに記録された値だけを使い、必ずpanel_idsを付ける。丸めは小数点以下だけに限定し、204を200にするような整数の概算・有効数字化は行わない。
- 数値を使わずに説明できる場合は定性的に書き、根拠にない閾値・目標値・概数を補わない。
- 相関を因果と断定せず、解釈には不確実性を、仮説には検証方法を付ける。
- アクションには期待効果、担当、緊急度、次の一歩、成功指標を付ける。
- 目標値、事業事情、サンプルサイズを推測しない。不足はlimitationsへ書く。
- limitationsには半角・全角を問わず数字を一切書かない。
- 読み手は日本語の月次マーケティング会議参加者。SQL用語は使わない。
- executive_summaryにもtextとpanel_idsを付ける。数値は参照した根拠パネルに存在する値だけを書く。
- executive_summaryは受理上限{SUMMARY_MAX_CHARS}文字以内とし、生成時は安全余白を取って{SUMMARY_GENERATION_TARGET_CHARS}文字以内の一文にする。各本文は{CLAIM_MAX_CHARS}文字以内の一文にする。
- 観測は最大{REPORT_ITEM_LIMITS['observations']}件、解釈は最大{REPORT_ITEM_LIMITS['interpretations']}件、未検証の仮説は最大{REPORT_ITEM_LIMITS['hypotheses']}件、推奨アクションは最大{REPORT_ITEM_LIMITS['actions']}件、limitationsは最大{REPORT_ITEM_LIMITS['limitations']}件に絞る。
- 不確実性、検証方法、期待効果、次の一歩は各{DETAIL_MAX_CHARS}文字以内、担当、緊急度、成功指標は各{SHORT_DETAIL_MAX_CHARS}文字以内にする。
"""

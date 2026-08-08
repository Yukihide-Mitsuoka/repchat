"""Evidence-bounded executive commentary for the local dashboard demo."""

from __future__ import annotations

import hashlib
import json
import re

NUMBER = re.compile(r"(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
MAX_BUNDLE_BYTES = 48 * 1024
MAX_OUTPUT_TOKENS = 4096
REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "executive_summary": {"type": "string"},
        "observations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "panel_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "panel_ids"],
            },
        },
        "interpretations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "uncertainty": {"type": "string"},
                    "panel_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "uncertainty", "panel_ids"],
            },
        },
        "hypotheses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "validation": {"type": "string"},
                    "panel_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "validation", "panel_ids"],
            },
        },
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "owner": {"type": "string"},
                    "urgency": {"type": "string"},
                    "expected_impact": {"type": "string"},
                    "next_step": {"type": "string"},
                    "success_metric": {"type": "string"},
                    "panel_ids": {"type": "array", "items": {"type": "string"}},
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
        "limitations": {"type": "array", "items": {"type": "string"}},
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
- 数値は根拠パネルに存在する値だけを使い、必ずpanel_idsを付ける。
- 相関を因果と断定せず、解釈には不確実性を、仮説には検証方法を付ける。
- アクションには期待効果、担当、緊急度、次の一歩、成功指標を付ける。
- 目標値、事業事情、サンプルサイズを推測しない。不足はlimitationsへ書く。
- limitationsへ根拠リンクのない数値を書かない。
- 読み手は日本語の月次マーケティング会議参加者。SQL用語は使わない。
- executive_summaryには数値を書かず、数値を伴う詳細は根拠付き観測へ置く。
"""

def _text(value, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ReportError(f"会議報告の{label}が空です。")
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
        indexed[panel_id] = panel
    return indexed

def _panel_ids(item: dict, known: set[str]) -> list[str]:
    ids = item.get("panel_ids") if isinstance(item, dict) else None
    if not isinstance(ids, list) or not ids or any(panel_id not in known for panel_id in ids):
        raise ReportError("会議報告の根拠パネルが未登録または空です。")
    return list(dict.fromkeys(ids))

def _number_tokens(value) -> set[str]:
    def canonical(token: str) -> str:
        token = token.replace(",", "")
        return token.rstrip("0").rstrip(".") if "." in token else token

    return {canonical(match.group()) for match in NUMBER.finditer(str(value))}

def _evidence_numbers(indexed: dict[str, dict], panel_ids: list[str]) -> set[str]:
    values: set[str] = set()
    for panel_id in panel_ids:
        panel = indexed[panel_id]
        source = [panel.get("period", ""), *panel["columns"], *panel["rows"]]
        values.update(_number_tokens(source))
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

    def items(name: str, extra: tuple[str, ...] = ()) -> list[dict]:
        source = raw.get(name)
        if not isinstance(source, list) or not source:
            raise ReportError(f"会議報告の{name}がありません。")
        normalized = []
        for item in source:
            ids = _panel_ids(item, known)
            text = _text(item.get("text"), name)
            _validate_numbers(text, indexed, ids)
            details = {field: _text(item.get(field), field) for field in extra}
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
            normalized.append(
                {"text": text, **details, "panel_ids": ids, "evidence_refs": evidence_refs}
            )
        return normalized

    summary = _text(raw.get("executive_summary"), "要約")
    if re.search(r"\d", summary):
        raise ReportError("会議報告の要約には根拠リンクのない数値を書けません。")
    limitations = raw.get("limitations")
    if not isinstance(limitations, list):
        raise ReportError("会議報告のlimitationsが配列ではありません。")
    report = {
        "status": "draft_requires_human_approval",
        "executive_summary": summary,
        "observations": items("observations"),
        "interpretations": items("interpretations", ("uncertainty",)),
        "hypotheses": items("hypotheses", ("validation",)),
        "actions": items(
            "actions",
            (
                "owner",
                "urgency",
                "expected_impact",
                "next_step",
                "success_metric",
            ),
        ),
        "limitations": [_text(value, "限界") for value in limitations],
        "plan_revision": bundle["plan_revision"],
        "build_revision": bundle["build_revision"],
        "organization_context_revision": bundle["organization_context_revision"],
    }
    if not report["limitations"]:
        raise ReportError("会議報告には少なくとも1件の限界を明示してください。")
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
            max_output_tokens=MAX_OUTPUT_TOKENS,
        ),
    )
    usage = response.usage_metadata
    return normalize_report(json.loads(response.text), bundle), {
        "input_tokens": usage.prompt_token_count or 0,
        "output_tokens": usage.candidates_token_count or 0,
    }

"""Immutable evidence-bundle validation for meeting reports."""

from __future__ import annotations

import json
import re

from meeting_report_contracts import MAX_BUNDLE_BYTES
from meeting_report_evidence import ReportError, _validate_derived_metrics


def validate_evidence_bundle(bundle: dict) -> dict[str, dict]:
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

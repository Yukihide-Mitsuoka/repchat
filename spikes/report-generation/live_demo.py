#!/usr/bin/env python3
"""Serve a localhost-only Japanese prompt → graph or dashboard demonstration."""

from __future__ import annotations
import argparse
import calendar
import hashlib
import json
import math
import re
import shutil
import sys
import threading
import webbrowser
from datetime import date, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
import analysis_planner as planner
import bitcoin_profile as bitcoin
import meeting_report as meeting
import run_report as report
from demo import DemoError, VENV_DIR, prepare_python, require_adc, run
HERE = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_PLAN_BODY_BYTES, MAX_RESULT_ROWS = 4096, 98304, 100
MAX_QUESTION_CHARS = 500
MAX_DASHBOARD_BODY_BYTES = MAX_PLAN_BODY_BYTES
MAX_SANKEY_PAGES = planner.MAX_SANKEY_PAGES
SAMPLE_FIRST_DAY = date(2020, 11, 1)
SAMPLE_LAST_DAY = date(2021, 1, 31)
def dashboard_layout_rows_for_plan(panels: list[dict]) -> list[dict]:
    """Lay out AI-authored panels without encoding any analysis topic."""
    if not panels:
        raise LiveDemoError("ダッシュボード計画にパネルがありません。")
    grouped: dict[int, list[dict]] = {}
    for panel in panels:
        row = panel.get("layout_row")
        weight = panel.get("layout_weight")
        if (
            isinstance(row, bool)
            or not isinstance(row, int)
            or row < 1
            or isinstance(weight, bool)
            or not isinstance(weight, int)
            or not 1 <= weight <= 100
        ):
            raise LiveDemoError("AIが考察したダッシュボード配置がありません。")
        grouped.setdefault(row, []).append(panel)
    row_numbers = list(grouped)
    if row_numbers != sorted(row_numbers) or any(
        len(group) > 4 for group in grouped.values()
    ):
        raise LiveDemoError("AIが考察したダッシュボード行が描画仕様と一致しません。")
    rows: list[dict] = []
    for row_number in row_numbers:
        group = grouped[row_number]
        total = sum(item["layout_weight"] for item in group)
        shares = [round(item["layout_weight"] * 100 / total, 4) for item in group]
        shares[-1] = round(100 - sum(shares[:-1]), 4)
        rows.append(
            {
                "panel_ids": [item["id"] for item in group],
                "shares": shares,
            }
        )
    return rows


def running_in_demo_venv() -> bool:
    """Return whether this process is using the demo virtual environment."""
    return Path(sys.prefix).resolve() == VENV_DIR.resolve()


def analysis_consultation_context(metrics: str, profile: str) -> str:
    """Expose schema semantics, not a menu of prewritten analyses, to the planner."""
    if profile == "bitcoin":
        return "利用可能期間は2024年1月〜12月。\n" + bitcoin.prompt_rules()
    return f"""利用可能期間は2020年11月〜2021年1月。未指定時は2021年1月を提案に使う。
BigQuery GA4 exportの主な列:
- event_date, event_timestamp, event_name, user_pseudo_id
- traffic_source.medium, device.category, ecommerce.transaction_id, ecommerce.purchase_revenue
- event_params ARRAY<STRUCT<key STRING, value STRUCT<string_value STRING, int_value INT64, double_value FLOAT64>>>
- items ARRAY<STRUCT<item_id STRING, item_name STRING, item_category STRING, price FLOAT64, quantity INT64>>
利用できる主な切り口:
- 日付、流入medium、device category、event_name、page_locationから正規化したpage_path、商品属性
- セッション内の時系列、入口、連続ページ遷移、イベント到達段階
定義済み指標:
{metrics}
指標定義にない語は推測せず、追加定義が必要だと説明する。"""

HTML = r"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>RepChat | ライブ分析デモ</title><style>
:root{--color-primary:#1f4e79;--color-primary-hover:#173d61;--color-border:#d9dee7;--color-muted:#667085;--color-text:#101828;--color-surface:#fff;--color-subtle:#f7f8fa;font-family:Inter,"Noto Sans JP",system-ui,sans-serif;color:var(--color-text);background:#f5f6f8}*{box-sizing:border-box}body{margin:0}.app-header{height:52px;background:#fff;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:16px;padding:0 max(24px,calc((100vw - 1180px)/2));color:var(--color-muted);font-size:13px}.brand{color:var(--color-primary);font-size:16px;font-weight:750;letter-spacing:.01em}.workspace{max-width:1180px;margin:auto;padding:32px 24px 72px}.eyebrow{color:var(--color-primary);font-size:12px;font-weight:700;letter-spacing:.1em;margin:0 0 8px;text-transform:uppercase}h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:17px;margin:0}.lead{color:var(--color-muted);line-height:1.65}.panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;padding:20px;margin-top:16px}.query-panel{border-top:3px solid var(--color-primary)}
label{font-size:14px;font-weight:700;display:block;margin-bottom:9px}select{border:1px solid #98a2b3;border-radius:4px;background:#fff;padding:9px 12px;font:inherit;margin-bottom:14px}textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #98a2b3;border-radius:4px;padding:13px 14px;font:inherit;line-height:1.6;background:#fff}textarea:focus,select:focus{border-color:var(--color-primary);outline:3px solid #1f4e791a}button{border:1px solid var(--color-primary);border-radius:4px;padding:10px 16px;font-weight:700;cursor:pointer;background:var(--color-primary);color:#fff}button:hover{background:var(--color-primary-hover)}button:disabled{cursor:wait;opacity:.55}.secondary{background:#fff;color:var(--color-primary)}.secondary:hover,.examples button:hover{background:#eef4f9}
.actions,.examples{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.examples button{background:#fff;color:#344054;border-color:var(--color-border);padding:6px 9px;font-size:12px}.cost{color:#8a4b08;font-size:12px}.progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.status-pill{padding:4px 9px;border:1px solid var(--color-border);border-radius:999px;background:var(--color-subtle);color:var(--color-muted);font-size:12px;font-weight:700}.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:0;list-style:none;margin:16px 0;padding:0;border:1px solid var(--color-border);border-radius:4px;overflow:hidden}.stages li{min-height:64px;padding:10px 12px;border-right:1px solid var(--color-border);background:#fff;color:var(--color-muted)}.stages li:last-child{border-right:0}.stages strong,.stages span{display:block}.stages strong{font-size:13px}.stages span{font-size:11px;margin-top:5px}.stages .active{box-shadow:inset 0 -3px #d39b2a;background:#fffbeb;color:#694100}.stages .done{box-shadow:inset 0 -3px #2f855a;background:#f3faf6;color:#166534}#plan-review h3{font-size:14px;margin:20px 0 10px}.clarification{border-left:3px solid #d39b2a;background:#fffbeb;padding:12px;margin:10px 0}.clarification.accepted{border-left-color:#2f855a;background:#f3faf6}.clarification input,.plan-item input{width:100%;margin-top:8px;padding:9px;border:1px solid #98a2b3}.clarification small{display:block;color:var(--color-muted);margin-top:7px}.plan-choice{display:grid;grid-template-columns:auto 1fr;gap:10px;border-bottom:1px solid var(--color-border);padding:12px 0}.plan-choice input{margin-top:4px}.plan-choice label{margin:0}.plan-choice small{display:block;color:var(--color-muted);font-weight:400;line-height:1.5;margin-top:4px}
.hidden{display:none}.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.mode-switch{display:flex;gap:0;margin:22px 0 4px;border-bottom:1px solid var(--color-border)}.mode-switch button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;color:var(--color-muted);padding:10px 16px}.mode-switch button:hover{background:var(--color-subtle)}.mode-switch .selected{border-bottom-color:var(--color-primary);color:var(--color-primary)}.result-tabs{display:flex;gap:0;margin:14px 0;border-bottom:1px solid var(--color-border)}.result-tab{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;color:var(--color-muted);padding:9px 14px}.result-tab:hover{background:var(--color-subtle)}.result-tab.selected{border-bottom-color:var(--color-primary);color:var(--color-primary)}.table-scroll{max-height:520px;overflow:auto}.sql-shell{position:relative}.sql{white-space:pre;overflow:auto;background:#f6f8fa;color:#24292f;border:1px solid #d0d7de;padding:16px 48px 16px 16px;border-radius:4px;max-height:430px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;tab-size:4}.copy-code{position:absolute;z-index:1;top:8px;right:8px;width:32px;height:32px;padding:0;border:1px solid #d0d7de;border-radius:6px;background:#fff;color:#57606a;font-size:17px;line-height:1}.copy-code:hover{background:#f3f4f6;color:#24292f}.sql-keyword{color:#cf222e}.sql-string,.sql-identifier{color:#0a3069}.sql-number{color:#0550ae}.sql-comment{color:#6e7781}.sql-function{color:#8250df}.notice{padding:10px 12px;border-left:3px solid #4b84b4;background:#eef4f9;color:#234e70;line-height:1.5}.warning{border-left-color:#d39b2a;background:#fffbeb;color:#854d0e}.error{border-left-color:#c24141;background:#fff1f1;color:#991b1b}.metric{font-size:46px;font-weight:750;padding:26px 8px}.chart{overflow-x:auto}.chart svg{min-width:760px;width:100%;height:auto}.chart text{font-size:11px;fill:#475467}.chart-caption{margin:8px 0 0;color:var(--color-muted);font-size:12px}.dashboard-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.dashboard-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:16px}.dashboard-card{grid-column:span 4;background:#fff;border:1px solid var(--color-border);border-radius:6px;padding:18px;min-width:0}.dashboard-card h3{font-size:16px;margin:0}.dashboard-card .purpose{color:var(--color-muted);font-size:12px;line-height:1.55;min-height:38px}.dashboard-card .chart svg{min-width:0}.panel-state{font-size:11px;font-weight:700;color:var(--color-muted)}.kpi-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kpi-pair div{background:var(--color-subtle);padding:15px}.kpi-pair strong{display:block;font-size:26px}.kpi-pair span{font-size:11px;color:var(--color-muted)}.funnel{display:grid;gap:8px;padding:10px 0}.funnel-step{background:#dbeafe;border-left:4px solid var(--color-primary);padding:10px 12px}.funnel-step strong{float:right}.dashboard-card details{border-top:1px solid var(--color-border);margin-top:14px;padding-top:12px}.dashboard-card summary{cursor:pointer;color:var(--color-primary);font-size:12px;font-weight:700}.dashboard-card details p{font-size:12px;line-height:1.55}.dashboard-card details .sql{max-height:300px;font-size:11px}.dashboard-card table{margin-top:10px}.plan-list{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 0}.plan-item{background:var(--color-subtle);border-left:3px solid #4b84b4;padding:10px 12px}.plan-item.active{background:#fffbeb;border-left-color:#d39b2a;color:#694100}.plan-item.done{background:#f3faf6;border-left-color:#2f855a;color:#166534}.plan-item strong,.plan-item span{display:block}.plan-item span{color:var(--color-muted);font-size:11px;margin-top:4px}.report-section{border-top:1px solid var(--color-border);padding-top:14px;margin-top:14px}.citation{display:inline-block;border:1px solid var(--color-border);border-radius:999px;padding:2px 7px;margin-left:6px;color:var(--color-primary);font-size:11px}.approval{border:1px solid #d39b2a;background:#fffbeb;padding:14px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--color-border);padding:9px;text-align:left;font-size:13px}th{background:var(--color-subtle);color:#344054}dialog{width:min(560px,calc(100% - 32px));border:1px solid var(--color-border);border-radius:6px;padding:0;box-shadow:0 20px 50px #10182833}dialog::backdrop{background:#10182880}.dialog-body{padding:24px}.cost-list{padding-left:22px;line-height:1.8}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}.local-note{font-size:12px;border-top:1px solid var(--color-border);padding-top:16px;margin-top:24px}@media(max-width:760px){.grid,.stages,.plan-list{grid-template-columns:1fr}.stages li{border-right:0;border-bottom:1px solid var(--color-border)}.dashboard-card{grid-column:1/-1}.progress-head,.dashboard-head{align-items:flex-start}.kpi-pair{grid-template-columns:1fr}.mode-switch button{padding:9px 10px}h1{font-size:24px}.workspace{padding:24px 16px 56px}}
.chart .sankey-stage{font-size:12px;font-weight:700;fill:#344054}.chart .sankey-link{outline:none}.chart .sankey-link:hover,.chart .sankey-link:focus{stroke-opacity:.9}.sankey-detail{min-height:18px;color:#344054}.sankey-terminal{border-left:3px solid #4b84b4;padding-left:9px}
.app-header{padding:0 20px;justify-content:space-between}.header-context{display:flex;align-items:center;gap:10px}.header-context strong{color:#344054}.draft-badge{border:1px solid var(--color-border);border-radius:999px;background:var(--color-subtle);padding:3px 8px;font-size:11px;color:var(--color-muted)}.app-shell{--inspector-width:330px;display:grid;grid-template-columns:220px minmax(0,1fr) 6px var(--inspector-width);min-height:calc(100vh - 52px)}.app-shell.sidebar-collapsed{grid-template-columns:0 minmax(0,1fr) 6px var(--inspector-width)}.app-shell.sidebar-collapsed .workspace-sidebar{visibility:hidden;padding:0;border:0}.workspace-sidebar,.workspace-inspector{position:sticky;top:52px;height:calc(100vh - 52px);overflow:auto;background:#fff}.workspace-sidebar{border-right:1px solid var(--color-border);padding:18px 12px}.sidebar-label{margin:18px 10px 7px;color:var(--color-muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.workspace-nav{display:grid;gap:3px}.workspace-nav button{width:100%;border:0;border-radius:5px;background:transparent;color:#344054;text-align:left;padding:9px 10px;font-weight:650}.workspace-nav button:hover{background:var(--color-subtle)}.workspace-nav button.selected{background:#eaf2f8;color:var(--color-primary)}.sidebar-item{margin:0 10px;padding:9px 0;border-bottom:1px solid #eaecf0;color:#475467;font-size:12px;line-height:1.5}.workspace{max-width:none;margin:0;padding:24px 28px 72px;min-width:0}.workspace-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}.workspace-topbar .page-heading{min-width:0}.workspace-topbar .status-pill{margin-top:4px}.workspace-view{min-width:0}.empty-state{text-align:center;padding:52px 28px}.empty-state h2{font-size:22px}.empty-state p{max-width:620px;margin:12px auto 20px}.inspector-resizer{position:sticky;top:52px;height:calc(100vh - 52px);cursor:col-resize;background:transparent;border-left:1px solid var(--color-border);touch-action:none}.inspector-resizer:hover,.inspector-resizer.dragging,.inspector-resizer:focus{background:#dbeafe;outline:none}.workspace-inspector{padding:20px 16px}.inspector-heading{padding:0 4px 14px;border-bottom:1px solid var(--color-border)}.inspector-heading h2{font-size:15px}.inspector-heading p{margin:6px 0 0;color:var(--color-muted);font-size:12px}.inspector-empty{padding:28px 4px;color:var(--color-muted);font-size:13px;line-height:1.7}.inspector-tabs{display:grid;grid-template-columns:repeat(4,1fr);margin:14px 0;border-bottom:1px solid var(--color-border)}.inspector-tab{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--color-muted);padding:8px 3px;font-size:11px}.inspector-tab:hover{background:var(--color-subtle)}.inspector-tab.selected{border-bottom-color:var(--color-primary);color:var(--color-primary)}.inspector-panel{font-size:12px;line-height:1.65}.inspector-panel .sql{font-size:11px;max-height:56vh}.inspector-panel .table-scroll{max-height:56vh}.dashboard-card>div:first-child{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.inspect-panel{display:block;width:100%;margin-top:12px;background:#fff;color:var(--color-primary);border-color:var(--color-border);font-size:12px}.inspect-panel:hover{background:#eef4f9}.dashboard-card.selected-card{border-color:#4b84b4;box-shadow:0 0 0 2px #4b84b422}.view-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.report-home{margin-top:0}.future-note{color:var(--color-muted);font-size:11px}.workspace-view>.panel:first-child{margin-top:0}@media(max-width:1180px){.app-shell,.app-shell.sidebar-collapsed{grid-template-columns:190px minmax(0,1fr)}.app-shell.sidebar-collapsed{grid-template-columns:0 minmax(0,1fr)}.workspace-inspector{position:relative;top:auto;height:auto;grid-column:2;border-top:1px solid var(--color-border)}.workspace-sidebar{grid-row:1/3}.inspector-resizer{display:none}}@media(max-width:760px){.app-header{padding:0 14px}.header-context strong{display:none}.app-shell,.app-shell.sidebar-collapsed{display:block}.workspace-sidebar{position:relative;top:auto;height:auto;border-right:0;border-bottom:1px solid var(--color-border);padding:8px 12px}.app-shell.sidebar-collapsed .workspace-sidebar{display:none}.workspace-nav{display:flex;overflow-x:auto}.workspace-nav button{width:auto;white-space:nowrap}.sidebar-label,.sidebar-item{display:none}.workspace{padding:20px 16px 48px}.workspace-inspector{display:none}.workspace-topbar{display:block}.empty-state{padding:36px 18px}}
.app-shell{--nav-width:220px;--nav-column:var(--nav-width);--nav-grip:1px;--inspector-column:var(--inspector-width);--inspector-grip:1px;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr) var(--inspector-grip) var(--inspector-column)}.app-shell.sidebar-collapsed{--nav-column:0px;--nav-grip:0px;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr) var(--inspector-grip) var(--inspector-column)}.app-shell.inspector-collapsed{--inspector-column:0px;--inspector-grip:0px;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr) var(--inspector-grip) var(--inspector-column)}.app-shell.sidebar-collapsed .navigation-resizer,.app-shell.inspector-collapsed .inspector-resizer{visibility:hidden}.app-shell.inspector-collapsed .workspace-inspector{visibility:hidden;padding:0}.navigation-resizer{position:sticky;top:52px;height:calc(100vh - 52px);cursor:col-resize;background:transparent;border-right:1px solid var(--color-border);touch-action:none}.navigation-resizer:hover,.navigation-resizer.dragging,.navigation-resizer:focus{background:#dbeafe;outline:none}#sidebar-toggle,#inspector-toggle{width:34px;height:34px;padding:0;font-size:16px}.status-pill{white-space:nowrap}@media(max-width:1180px) and (min-width:761px){.app-shell,.app-shell.sidebar-collapsed{--nav-width:180px;--inspector-width:280px;display:grid;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr) var(--inspector-grip) var(--inspector-column)}.workspace-sidebar,.workspace-inspector{position:sticky;top:52px;height:calc(100vh - 52px);grid-row:auto;grid-column:auto}.workspace-inspector{border-top:0}.navigation-resizer,.inspector-resizer{display:block}}@media(max-width:760px){.navigation-resizer,.inspector-resizer,#inspector-toggle{display:none}}
</style></head><body data-theme="evidence"><header class="app-header"><div class="header-context"><button id="sidebar-toggle" class="secondary" type="button" aria-label="ナビゲーションを折りたたむ" aria-expanded="true" title="ナビゲーションを折りたたむ">☰</button><span class="brand">RepChat</span><span>Live analysis demo</span></div><div class="header-context"><strong>デモ組織 / 分析ワークスペース</strong><span class="draft-badge">ローカル下書き</span><button id="inspector-toggle" class="secondary" type="button" aria-label="詳細パネルを折りたたむ" aria-expanded="true" title="詳細パネルを折りたたむ">◧</button></div></header><div id="app-shell" class="app-shell"><aside id="workspace-sidebar" class="workspace-sidebar"><p class="sidebar-label">分析ワークスペース</p><nav class="workspace-nav" aria-label="分析ワークスペース"><button id="view-dashboard" class="selected" type="button" aria-current="page">ダッシュボード</button><button id="view-build" type="button">作成・編集</button><button id="view-report" type="button">会議報告</button><button id="view-graph" type="button">単一グラフ</button></nav><p class="sidebar-label">対話履歴（この起動中のみ）</p><p class="sidebar-item">新しい分析<br><span class="future-note">現在の分析目的</span></p><p class="sidebar-label">Git連携（将来機能）</p><p class="sidebar-item">draft / published / version を製品版で管理</p></aside><div id="navigation-resizer" class="navigation-resizer" role="separator" aria-orientation="vertical" aria-label="ナビゲーションの幅を変更" aria-valuemin="180" aria-valuemax="360" aria-valuenow="220" tabindex="0"></div><main id="workspace-main" class="workspace"><div class="workspace-topbar"><div class="page-heading"><p class="eyebrow">Natural language analytics</p><h1 id="page-title">ダッシュボード</h1><p id="page-lead" class="lead">ダッシュボードが主役の分析ワークスペースです。作成過程と会議報告は別の画面で確認できます。</p></div><span id="workspace-state" class="status-pill">下書き</span></div>
<section id="artifact-dashboard-view" class="workspace-view"><section id="dashboard-empty" class="panel empty-state"><p class="eyebrow">Dashboard</p><h2>判断に使うダッシュボードを作成しましょう</h2><p class="lead">AIと分析目的を相談し、KPI・比較軸・グラフ候補を確認してからbuildします。仕様確定前にBigQueryは実行しません。</p><button id="open-build-studio" type="button">作成・編集を開く</button></section><section id="dashboard-output" class="hidden"><div class="panel dashboard-head"><div><p class="eyebrow">Generated dashboard</p><h2 id="dashboard-title">生成ダッシュボード</h2><p id="dashboard-provenance" class="lead">確定したAI分析仕様と実行結果を表示します。</p></div><div><strong id="dashboard-cost">Vertex AI推定 ¥0</strong><p class="chart-caption">BigQuery利用料は別</p></div></div><div id="dashboard-grid" class="dashboard-grid"></div><div class="panel actions"><button id="report-submit" class="hidden" type="button">この結果から会議報告案を生成</button><span class="cost">追加のBigQuery実行はありません。</span></div></section></section>
<section id="build-studio-view" class="workspace-view hidden"><div id="dashboard-workspace"><section class="panel query-panel"><label for="dashboard-question">分析して決めたいこと</label><textarea id="dashboard-question" placeholder="分析して決めたいことを入力してください"></textarea>
<p class="lead">AIが目的を分解し、確認事項、仮説、KPI、グラフ候補と理由を提案します。仕様を確定するまでBigQueryは実行しません。</p><div class="actions"><button id="dashboard-submit">AIと分析計画を相談</button><span class="cost">相談はVertex AIだけを使用し、build費用は仕様確定後に別途確認します。</span></div></section>
<section class="panel" aria-labelledby="dashboard-progress-title"><div class="progress-head"><h2 id="dashboard-progress-title">相談・buildの進行状況</h2><span id="dashboard-status" class="status-pill">相談前</span></div><p id="dashboard-message" class="notice" aria-live="polite">分析目的を確認し、相談を開始してください。</p><div id="dashboard-plan" class="plan-list"><div id="dashboard-step-plan" class="plan-item"><strong>1. 目的を分解</strong><span>意思決定と仮説を言語化</span></div><div id="dashboard-step-review" class="plan-item"><strong>2. 仕様を確認</strong><span>KPI・比較・読者・パネルを編集</span></div><div id="dashboard-step-build" class="plan-item"><strong>3. 確定してbuild</strong><span>費用確認後にSQLを生成</span></div></div></section>
<section id="plan-review" class="panel hidden"><div class="progress-head"><h2>AIが提案した分析仕様</h2><span id="plan-revision" class="status-pill"></span></div><p id="plan-summary" class="lead"></p><p id="plan-context" class="notice warning"></p><div class="plan-list"><label class="plan-item" for="plan-audience">主な読者<input id="plan-audience"></label><label class="plan-item" for="plan-comparison">比較の考え方<input id="plan-comparison"></label></div><h3>検証する仮説</h3><div id="plan-hypotheses"></div><div id="plan-clarifications"></div><h3>ダッシュボードへ含めるパネル</h3><p class="lead">初回は原則__INITIAL_PANEL_COUNT__件です。管理者設定の最大__MAX_PANEL_COUNT__件まで確定できます。</p><div id="plan-panels"></div><label for="plan-revision-instruction">分析仕様への追加・変更・削除依頼</label><input id="plan-revision-instruction" maxlength="500" placeholder="追加・変更・削除したい内容を入力してください"><div id="plan-correction" class="notice warning hidden"><strong>AIの解釈を描画仕様に合わせた修正文案</strong><p id="plan-correction-text"></p><button id="plan-correction-apply" class="secondary" type="button">変更依頼欄へ反映</button></div><div class="actions"><button id="plan-revise" class="secondary" type="button">選択と変更依頼を反映してAIに再提案</button><button id="plan-build" type="button">この仕様を確定してbuild</button></div></section>
</div></section><section id="meeting-report-view" class="workspace-view hidden"><section class="panel" aria-labelledby="report-progress-title"><div class="progress-head"><h2 id="report-progress-title">会議報告の生成状況</h2><span id="report-status" class="status-pill">報告案なし</span></div><p id="report-message" class="notice" aria-live="polite">build済みダッシュボードから会議報告案を生成してください。</p></section><section id="report-empty" class="panel empty-state"><p class="eyebrow">Meeting report</p><h2>会議報告案はまだありません</h2><p class="lead">build済みダッシュボードの根拠bundleから、観測・解釈・仮説・アクションを分けた未承認案を生成します。</p><button id="back-to-dashboard" class="secondary" type="button">ダッシュボードへ戻る</button></section><section id="report-output" class="panel hidden report-home"><div class="progress-head"><h2>会議報告アシスト</h2><span id="report-revision" class="status-pill"></span></div><p class="approval">AIが作成した未承認案です。外部共有前に人間が根拠と表現を確認してください。</p><div id="report-summary" class="lead"></div><div id="report-sections"></div></section></section>
<div id="graph-workspace" class="workspace-view hidden"><section class="panel query-panel"><label for="dataset-profile">分析対象データ</label><select id="dataset-profile"><option value="ga4">GA4 ECサイト（既知のnestedスキーマ）</option><option value="bitcoin">Bitcoin取引（非GA4のnested/repeated検証）</option></select><label for="question">日本語の問い合わせ</label><textarea id="question"></textarea><p id="profile-note" class="lead">公開GA4サンプルの2020年11月〜2021年1月を対象に、相談でAIが作成した分析仕様からSQLとグラフを生成します。</p>
<div class="actions"><button id="submit">SQLとグラフを生成</button><span class="cost">送信ごとに実Vertex AI・BigQueryを使用します。</span></div></section>
<section class="panel" aria-labelledby="progress-title"><div class="progress-head"><h2 id="progress-title">生成の進行状況</h2><span id="run-status" class="status-pill">実行前</span></div><p id="message" class="notice" aria-live="polite">問い合わせを入力し、生成ボタンを押してください。</p><ol class="stages"><li id="s-generate"><strong>1. SQL生成</strong><span>SQLを作る</span></li><li id="s-validate"><strong>2. SQL検査</strong><span>安全性を確認</span></li><li id="s-execute"><strong>3. BigQuery実行</strong><span>データを取得</span></li><li id="s-render"><strong>4. 描画</strong><span>結果を可視化</span></li></ol></section>
<section id="output" class="hidden"><div class="grid"><section class="panel"><h2>生成理由</h2><p id="reason"></p><p id="verification" class="notice"></p></section><section class="panel"><h2>推定費用</h2><p id="cost"></p></section></div>
<section class="panel"><h2>BigQuery実行結果</h2><div class="result-tabs" role="tablist" aria-label="BigQuery実行結果の表示"><button id="result-tab-chart" class="result-tab selected" type="button" role="tab" aria-selected="true" aria-controls="result-chart-panel">グラフ</button><button id="result-tab-data" class="result-tab" type="button" role="tab" aria-selected="false" aria-controls="result-data-panel">取得データ</button></div><div id="result-chart-panel" role="tabpanel" aria-labelledby="result-tab-chart"><div id="chart" class="chart"></div></div><div id="result-data-panel" class="hidden" role="tabpanel" aria-labelledby="result-tab-data"><div id="result-data" class="table-scroll"></div></div></section><section class="panel"><h2>BigQueryへ送ったSQL（AI生成・検査済み）</h2><div class="sql-shell"><button id="sql-copy" class="copy-code" type="button" aria-label="SQLをコピー" title="SQLをコピー">⧉</button><pre id="sql" class="sql"></pre></div></section></section></div>
<p class="lead local-note">ローカルデモです。本番の認証・gate・executor・顧客Git配送は通りません。KPI相談はIssue #180、会議報告アシストはIssue #181の未検証プロトタイプです。</p></main><div id="inspector-resizer" class="inspector-resizer" role="separator" aria-orientation="vertical" aria-label="詳細パネルの幅を変更" aria-valuemin="280" aria-valuemax="560" aria-valuenow="330" tabindex="0"></div><aside id="panel-inspector" class="workspace-inspector"><div class="inspector-heading"><p class="eyebrow">Panel inspector</p><h2 id="inspector-title">パネル詳細</h2><p id="inspector-subtitle">グラフを選択すると根拠を確認できます。</p></div><p id="inspector-empty" class="inspector-empty">ダッシュボードの「詳細を確認」を押すと、生成理由・検証状態・SQL・取得データ・来歴をここに表示します。</p><div id="inspector-content" class="hidden"><div class="inspector-tabs" role="tablist" aria-label="パネル詳細"><button id="inspector-tab-reason" class="inspector-tab selected" type="button" role="tab" aria-selected="true">理由</button><button id="inspector-tab-sql" class="inspector-tab" type="button" role="tab" aria-selected="false">SQL</button><button id="inspector-tab-data" class="inspector-tab" type="button" role="tab" aria-selected="false">データ</button><button id="inspector-tab-provenance" class="inspector-tab" type="button" role="tab" aria-selected="false">来歴</button></div><section id="inspector-reason" class="inspector-panel"><p id="inspector-reason-text"></p><p id="inspector-verification" class="notice">未実行</p></section><section id="inspector-sql-panel" class="inspector-panel hidden"><div class="sql-shell"><button id="inspector-sql-copy" class="copy-code" type="button" aria-label="SQLをコピー" title="SQLをコピー">⧉</button><pre id="inspector-sql" class="sql"></pre></div></section><section id="inspector-data-panel" class="inspector-panel hidden"><div id="inspector-data" class="table-scroll"></div></section><section id="inspector-provenance" class="inspector-panel hidden"><dl><dt>パネルID</dt><dd id="inspector-panel-id"></dd><dt>状態</dt><dd id="inspector-panel-state"></dd><dt>分析仕様</dt><dd id="inspector-plan-revision">build前</dd></dl></section></div></aside></div>
<dialog id="cost-dialog" aria-labelledby="cost-title" aria-describedby="cost-description"><div class="dialog-body"><h2 id="cost-title">費用を確認して実行</h2><p id="cost-description">この質問では実際のVertex AIとBigQueryを使用します。</p><ul class="cost-list"><li id="cost-vertex">Vertex AI 約¥1</li><li id="cost-bigquery">BigQuery 最大20 GiB（生成SQL 1クエリ、最大約¥19）</li><li><strong id="cost-total">合計最大約¥20</strong></li></ul><p class="lead">無料枠やキャッシュで0円の場合があります。上限は各クエリが上限まで走り、キャッシュが使えない場合の目安です。</p><div class="dialog-actions"><button id="cancel-cost" class="secondary" type="button">キャンセル</button><button id="confirm-cost" type="button">費用を確認して実行</button></div></div></dialog><script>
const $=id=>document.getElementById(id),stages=["generate","validate","execute","render"],dashboardStages=["plan","review","build"],dashboardPanels=new Map();let pendingMode="dashboard-plan",currentPlan=null,currentAnswers={},pendingPlan=null,pendingPlanBase=null,pendingPlanInstruction=null,pendingInsightSpecification=null,latestBuildRevision=null,activePanelId=null,activeRequest=null;let reportWorkspaceState="報告案なし";function selectProfile(profile){$("dataset-profile").value=profile;$("profile-note").textContent=profile==="bitcoin"?"公開Bitcoin取引の2024年を対象に、相談でAIが作成した分析仕様からSQLとグラフを生成します。":"公開GA4サンプルの2020年11月〜2021年1月を対象に、相談でAIが作成した分析仕様からSQLとグラフを生成します。"}
function stage(name){let reached=false;for(const s of stages){const el=$("s-"+s);if(s===name){el.className="active";el.setAttribute("aria-current","step");reached=true}else{el.className=reached?"":"done";el.removeAttribute("aria-current")}}}
function dashboardStage(name){const current=name==="complete"?dashboardStages.length:dashboardStages.indexOf(name);dashboardStages.forEach((stageName,index)=>{const el=$("dashboard-step-"+stageName);el.className="plan-item"+(current>=0&&index<current?" done":index===current?" active":"");if(index===current)el.setAttribute("aria-current","step");else el.removeAttribute("aria-current")})}
function selectWorkspace(view){const views={dashboard:"artifact-dashboard-view",build:"build-studio-view",consult:"analysis-consultation",report:"meeting-report-view",graph:"graph-workspace"},copy={dashboard:["ダッシュボード","ダッシュボードが主役の分析ワークスペースです。作成過程と会議報告は別の画面で確認できます。","下書き"],build:["ダッシュボードを作成・編集","AIと分析目的を相談し、確認した仕様だけをbuildします。","相談・build"],consult:["分析候補を相談","目的に合う分析を選び、実行する依頼へ具体化します。","相談中"],report:["会議報告","ダッシュボードの根拠bundleから作成した報告案を確認します。","報告案なし"],graph:["単一グラフを生成","日本語からSQL生成・安全検査・BigQuery実行・可視化までを確認します。","ライブ実行"]};Object.entries(views).forEach(([name,id])=>{$(id).classList.toggle("hidden",name!==view);const button=$("view-"+name);if(!button)return;button.classList.toggle("selected",name===view);if(name===view)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current")});$("page-title").textContent=copy[view][0];$("page-lead").textContent=copy[view][1];$("workspace-state").textContent=view==="report"?reportWorkspaceState:copy[view][2]}
function setReportState(status,message,className="notice"){reportWorkspaceState=status;$("report-status").textContent=status;$("report-message").className=className;$("report-message").textContent=message;if(!$("meeting-report-view").classList.contains("hidden"))$("workspace-state").textContent=status}
function toggleSidebar(){const shell=$("app-shell"),collapsed=shell.classList.toggle("sidebar-collapsed"),button=$("sidebar-toggle");button.setAttribute("aria-expanded",String(!collapsed));button.setAttribute("aria-label",collapsed?"ナビゲーションを展開":"ナビゲーションを折りたたむ");button.title=button.getAttribute("aria-label")}
function resizeNavigation(event){const width=Math.max(180,Math.min(360,event.clientX));$("app-shell").style.setProperty("--nav-width",width+"px");$("navigation-resizer").setAttribute("aria-valuenow",String(width))}
function toggleInspector(){const shell=$("app-shell"),collapsed=shell.classList.toggle("inspector-collapsed"),button=$("inspector-toggle");button.setAttribute("aria-expanded",String(!collapsed));button.setAttribute("aria-label",collapsed?"詳細パネルを展開":"詳細パネルを折りたたむ");button.title=button.getAttribute("aria-label")}
const INSPECTOR_MIN_WIDTH=280,INSPECTOR_MAIN_MIN_WIDTH=360,INSPECTOR_MAX_RATIO=.75;
function inspectorMaximumWidth(viewportWidth,navigationWidth){return Math.max(INSPECTOR_MIN_WIDTH,Math.min(Math.floor(viewportWidth*INSPECTOR_MAX_RATIO),viewportWidth-navigationWidth-INSPECTOR_MAIN_MIN_WIDTH-1))}
function currentNavigationWidth(){const shell=$("app-shell");if(shell.classList.contains("sidebar-collapsed"))return 0;return (parseInt(getComputedStyle(shell).getPropertyValue("--nav-width"),10)||220)+1}
function currentInspectorWidth(){return parseInt(getComputedStyle($("app-shell")).getPropertyValue("--inspector-width"),10)||330}
function setInspectorWidth(requestedWidth){const maximum=inspectorMaximumWidth(window.innerWidth,currentNavigationWidth()),width=Math.max(INSPECTOR_MIN_WIDTH,Math.min(maximum,requestedWidth));$("app-shell").style.setProperty("--inspector-width",width+"px");inspectorResizer.setAttribute("aria-valuemax",String(Math.floor(maximum)));inspectorResizer.setAttribute("aria-valuenow",String(Math.round(width)));return width}
function resizeInspector(event){setInspectorWidth(window.innerWidth-event.clientX)}
function selectInspectorTab(name){for(const current of["reason","sql","data","provenance"]){const selected=current===name,button=$("inspector-tab-"+current),panel=$(current==="sql"?"inspector-sql-panel":current==="data"?"inspector-data-panel":"inspector-"+current);button.classList.toggle("selected",selected);button.setAttribute("aria-selected",String(selected));panel.classList.toggle("hidden",!selected)}}
function openPanelInspector(panelId){const panel=dashboardPanels.get(panelId);if(!panel)return;if($("app-shell").classList.contains("inspector-collapsed"))toggleInspector();activePanelId=panelId;dashboardPanels.forEach(item=>item.card.classList.remove("selected-card"));panel.card.classList.add("selected-card");$("inspector-empty").className="hidden";$("inspector-content").className="";$("inspector-title").textContent=panel.title;$("inspector-subtitle").textContent=panel.purpose;$("inspector-reason-text").textContent=panel.reason.textContent||"生成理由を待っています。";$("inspector-verification").className=panel.verification.className;$("inspector-verification").textContent=panel.verification.textContent;renderSql($("inspector-sql"),panel.sql.textContent);$("inspector-data").replaceChildren(panel.data.firstChild?panel.data.firstChild.cloneNode(true):Object.assign(document.createElement("p"),{className:"notice",textContent:"取得データを待っています。"}));$("inspector-panel-id").textContent=panelId;$("inspector-panel-state").textContent=panel.state.textContent;$("inspector-plan-revision").textContent=currentPlan?.revision||"build中";selectInspectorTab("reason")}
function node(name,attrs={}){const n=document.createElementNS("http://www.w3.org/2000/svg",name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n}
function table(cols,rows){const t=document.createElement("table"),h=t.createTHead().insertRow();cols.forEach(c=>h.appendChild(Object.assign(document.createElement("th"),{textContent:c})));const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();r.forEach(v=>tr.insertCell().textContent=v??"")});return t}
function configureCopyButton(button,target){button.onclick=async()=>{try{await navigator.clipboard.writeText(target.textContent);button.textContent="✓";button.setAttribute("aria-label","SQLをコピーしました");button.title="SQLをコピーしました"}catch(_error){button.textContent="!";button.setAttribute("aria-label","SQLのコピーに失敗しました");button.title="SQLのコピーに失敗しました"}};return button}
function makeCopyButton(target){const button=Object.assign(document.createElement("button"),{className:"copy-code",type:"button",textContent:"⧉",title:"SQLをコピー"});button.setAttribute("aria-label","SQLをコピー");return configureCopyButton(button,target)}
function chartValue(value,column="",forceInteger=false){if(value===null||value===undefined||value==="")return "—";const number=typeof value==="number"?value:Number(value);if(!Number.isFinite(number))return String(value);const key=String(column).toLowerCase(),countLike=forceInteger||/(count|sessions|users|purchases|pageviews|views|件数|セッション|ユーザー数|閲覧数|取引数)/.test(key);return new Intl.NumberFormat("ja-JP",{maximumFractionDigits:countLike?0:2}).format(number)}
function renderSql(target,sql){const pattern=/(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()|\b(?:SELECT|FROM|WHERE|GROUP|BY|ORDER|AS|WITH|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|CROSS|ON|AND|OR|NOT|IN|BETWEEN|CASE|WHEN|THEN|ELSE|END|OVER|PARTITION|ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT|ROW|QUALIFY|HAVING|LIMIT|OFFSET|DISTINCT|UNION|ALL|ASC|DESC|NULLS|FIRST|LAST|UNNEST|STRUCT|ARRAY)\b)/gi,nodes=[];let cursor=0;for(const match of sql.matchAll(pattern)){if(match.index>cursor)nodes.push(document.createTextNode(sql.slice(cursor,match.index)));const token=match[0],span=document.createElement("span");span.className=token.startsWith("--")||token.startsWith("/*")?"sql-comment":token.startsWith("'")||token.startsWith('"')?"sql-string":token.startsWith("`")?"sql-identifier":/^\d/.test(token)?"sql-number":/\($/.test(sql.slice(match.index+token.length).trimStart()[0]||"")?"sql-function":"sql-keyword";span.textContent=token;nodes.push(span);cursor=match.index+token.length}if(cursor<sql.length)nodes.push(document.createTextNode(sql.slice(cursor)));target.replaceChildren(...nodes)}
function selectResultTab(name){const chart=name==="chart";for(const [tab,selected]of[["result-tab-chart",chart],["result-tab-data",!chart]]){$(tab).className="result-tab"+(selected?" selected":"");$(tab).setAttribute("aria-selected",String(selected))}$("result-chart-panel").className=chart?"":"hidden";$("result-data-panel").className=chart?"hidden":""}
function populateResult(result){graph(result);$("result-data").replaceChildren(table(result.columns,result.rows));selectResultTab("chart")}
function clearResult(){$("chart").replaceChildren();$("result-data").replaceChildren();selectResultTab("chart")}
function syncClarificationAnswers(event){const inputs=event?[event.target]:[...document.querySelectorAll("[data-answer-field]")];inputs.forEach(input=>{const field=input.dataset.answerField,value=input.value.trim(),status=input.answerStatus;if(value){currentAnswers[field]=value;input.parentElement.classList.add("accepted");status.textContent=value===input.dataset.recommendedAnswer?"推奨回答を採用済み（編集可）":"編集した回答を採用（さらに編集可）";if(field==="audience")$("plan-audience").value=value;if(field==="comparison")$("plan-comparison").value=value}else{delete currentAnswers[field];input.parentElement.classList.remove("accepted");status.textContent="回答を入力するとbuildできます。"}});$("plan-build").disabled=[...document.querySelectorAll("[data-answer-field]")].some(input=>!input.value.trim())}
function syncPlanFieldAnswer(field,value){const input=document.querySelector(`[data-answer-field="${field}"]`);if(input){input.value=value;syncClarificationAnswers({target:input})}}
function clearPlanCorrection(){$("plan-correction").className="notice warning hidden";$("plan-correction-text").textContent=""}
function showPlanCorrection(instruction){$("plan-correction-text").textContent=instruction;$("plan-correction").className="notice warning"}
function renderAnalysisPlan(event){const plan=event.plan;currentPlan=plan;pendingPlanBase=null;pendingPlanInstruction=null;$("plan-revision-instruction").value="";clearPlanCorrection();dashboardStage("review");$("plan-review").className="panel";$("plan-revision").textContent=plan.revision;$("plan-summary").textContent=plan.objective_summary;$("plan-audience").value=plan.audience;$("plan-comparison").value=plan.comparison;$("plan-context").textContent=`組織コンテキスト ${plan.organization_context_revision}（ローカルデモfixture・本番メモリー未接続）`;
const hypotheses=document.createElement("ul");plan.hypotheses.forEach(value=>hypotheses.appendChild(Object.assign(document.createElement("li"),{textContent:value})));$("plan-hypotheses").replaceChildren(hypotheses);const questions=[];plan.clarifications.forEach(item=>{const box=Object.assign(document.createElement("div"),{className:"clarification"}),label=document.createElement("label"),input=document.createElement("input"),status=document.createElement("small");label.textContent=item.question;input.value=item.recommended_answer;input.dataset.answerField=item.field;input.dataset.recommendedAnswer=item.recommended_answer;input.answerStatus=status;input.oninput=syncClarificationAnswers;currentAnswers[item.field]=input.value.trim();box.append(label,input,status);questions.push(box)});$("plan-clarifications").replaceChildren(...questions);syncClarificationAnswers();
const choices=[];plan.panels.forEach(panel=>{const row=Object.assign(document.createElement("div"),{className:"plan-choice"}),input=Object.assign(document.createElement("input"),{type:"checkbox",checked:true}),label=document.createElement("label"),detail=document.createElement("small");input.dataset.panelId=panel.id;label.textContent=`${panel.title} — ${panel.chart}`;detail.textContent=`${panel.reason} 判断用途: ${panel.decision} AIレイアウト: 行${panel.layout_row}・相対幅${panel.layout_weight}`;label.append(detail);row.append(input,label);choices.push(row)});$("plan-panels").replaceChildren(...choices);$("plan-revise").className="secondary";$("dashboard-status").textContent="提案済み";$("dashboard-message").textContent=plan.clarifications.length?"推奨回答を採用済みです。そのままbuildするか、変更依頼を添えてAIへ再提案できます。":`分析仕様を確認し、必要なら追加・変更・削除を依頼できます。Vertex AI推定 ¥${event.cost_jpy}`}
function collectAnswers(){syncClarificationAnswers();if($("plan-build").disabled)throw new Error("すべての確認事項へ回答してください。")}
function selectedPlan(){const selected=new Set([...document.querySelectorAll("[data-panel-id]:checked")].map(input=>input.dataset.panelId));if(selected.size<1)throw new Error("ダッシュボードには1件以上のパネルを選択してください。");if(selected.size>__MAX_PANEL_COUNT__)throw new Error("ダッシュボードのパネルは最大__MAX_PANEL_COUNT__件です。");const plan=JSON.parse(JSON.stringify(currentPlan));plan.panels=plan.panels.filter(panel=>selected.has(panel.id));plan.audience=$("plan-audience").value.trim();plan.comparison=$("plan-comparison").value.trim();if(!plan.audience||!plan.comparison)throw new Error("主な読者と比較の考え方を入力してください。");plan.answers=currentAnswers;return plan}
function citedItem(item,suffix=""){const row=document.createElement("p");row.appendChild(document.createTextNode(item.text+suffix));item.evidence_refs.forEach(ref=>row.appendChild(Object.assign(document.createElement("span"),{className:"citation",textContent:`根拠 ${ref.panel_id} / ${ref.result_revision} / SQL ${ref.sql_sha256}`})));return row}
function renderMeetingReport(event){const report=event.report;$("report-empty").className="hidden";$("report-output").className="panel report-home";$("report-revision").textContent=report.report_revision;const warnings=report.generation_warnings||[];$("report-warning").className=warnings.length?"notice warning":"hidden";$("report-warning").textContent=warnings.join(" ");$("report-summary").replaceChildren(citedItem(report.executive_summary));const content=[];for(const [title,name,suffix]of[["観測","observations",""],["解釈","interpretations",""],["未検証の仮説","hypotheses",""],["推奨アクション","actions",""]]){const section=Object.assign(document.createElement("section"),{className:"report-section"}),heading=Object.assign(document.createElement("h3"),{textContent:title});section.append(heading);report[name].forEach(item=>{let detail=suffix;if(name==="interpretations")detail=`（不確実性: ${item.uncertainty}）`;if(name==="hypotheses")detail=`（検証: ${item.validation}）`;if(name==="actions")detail=`（期待効果: ${item.expected_impact} / 担当: ${item.owner} / 緊急度: ${item.urgency} / 次: ${item.next_step} / 成功指標: ${item.success_metric}）`;section.append(citedItem(item,detail))});content.push(section)}const limits=Object.assign(document.createElement("section"),{className:"report-section"}),limitTitle=Object.assign(document.createElement("h3"),{textContent:"限界・不足情報"}),list=document.createElement("ul");report.limitations.forEach(value=>list.appendChild(Object.assign(document.createElement("li"),{textContent:value})));limits.append(limitTitle,list);content.push(limits);$("report-sections").replaceChildren(...content)}
function sankey(svg,rows,w,h,detail,valueLabel){
const maxPages=__MAX_SANKEY_PAGES__,instanceId="sankey-"+(sankey.instanceSequence=(sankey.instanceSequence||0)+1),palette=["#4e79a7","#f28e2b","#59a14f","#e15759","#b07aa1","#76b7b2","#edc948","#ff9da7","#9c755f","#bab0ab"],canonical=name=>name.replace(/^\d+\.\s*(入口:\s*)?/,""),stage=(name,fallback)=>{const match=String(name).match(/^(\d+)\./);return match?Number(match[1]):fallback},links=rows.map(row=>({source:String(row[0]),target:String(row[1]),value:Math.max(0,Number(row[2]))})).filter(link=>{const sourceStage=stage(link.source,1),targetStage=stage(link.target,2);return Number.isFinite(link.value)&&link.value>0&&sourceStage>=1&&sourceStage<maxPages&&targetStage>sourceStage&&targetStage<=maxPages}),incoming=new Map(),outgoing=new Map(),values=new Map(),levels=new Map(),colors=new Map();
if(!links.length){detail.textContent=`${maxPages}ページ以内の遷移はありませんでした。`;return}
for(const link of links){outgoing.set(link.source,(outgoing.get(link.source)||0)+link.value);incoming.set(link.target,(incoming.get(link.target)||0)+link.value);for(const [name,inferredLevel]of[[link.source,1],[link.target,2]]){levels.set(name,stage(name,inferredLevel));const category=canonical(name);if(!colors.has(category))colors.set(category,palette[colors.size%palette.length])}}
for(const name of levels.keys())values.set(name,Math.max(incoming.get(name)||0,outgoing.get(name)||0));
const color=name=>colors.get(canonical(name)),stageNumbers=[...new Set(levels.values())].sort((a,b)=>a-b),groups=new Map(stageNumbers.map(stage=>[stage,[]]));
for(const name of values.keys())groups.get(levels.get(name)).push(name);
for(const names of groups.values())names.sort();
const largest=Math.max(...stageNumbers.map(stage=>groups.get(stage).reduce((sum,name)=>sum+values.get(name),0)),1),maxGaps=Math.max(...stageNumbers.map(stage=>Math.max(0,groups.get(stage).length-1)),0),gap=14,scale=Math.min(1.15,(h-54-gap*maxGaps)/largest),positions=new Map();
stageNumbers.forEach((stage,index)=>{const names=groups.get(stage),height=names.reduce((sum,name)=>sum+Math.max(10,values.get(name)*scale),0)+gap*Math.max(0,names.length-1),x=30+index*(w-150)/Math.max(stageNumbers.length-1,1);let y=(h-height)/2;for(const name of names){const nodeHeight=Math.max(10,values.get(name)*scale);positions.set(name,{x,y,height:nodeHeight,out:0,into:0});y+=nodeHeight+gap}});
const defs=node("defs");svg.append(defs);svg.appendChild(node("title")).textContent="段階間の主要な流れ";
stageNumbers.forEach((stage,index)=>{const heading=svg.appendChild(node("text",{x:30+index*(w-150)/Math.max(stageNumbers.length-1,1),y:18,class:"sankey-stage"}));heading.textContent=stage===1?"入口":`${stage}ページ目`});
const defaultDetail=`線にマウスを重ねるか、Tabキーで選ぶと遷移元・遷移先・${valueLabel}を確認できます。`;
links.forEach((link,index)=>{const source=positions.get(link.source),target=positions.get(link.target),width=Math.max(2,link.value*scale),y1=source.y+source.out+width/2,y2=target.y+target.into+width/2,x1=source.x+12,x2=target.x,gradientId=instanceId+"-link-"+index,gradient=node("linearGradient",{id:gradientId,gradientUnits:"userSpaceOnUse",x1,y1,x2,y2});gradient.append(node("stop",{offset:"0%","stop-color":color(link.source)}),node("stop",{offset:"100%","stop-color":color(link.target)}));defs.append(gradient);source.out+=width;target.into+=width;const description=`${canonical(link.source)} → ${canonical(link.target)}: ${chartValue(link.value,valueLabel)} ${valueLabel}`,path=node("path",{class:"sankey-link",d:"M "+x1+" "+y1+" C "+((x1+x2)/2)+" "+y1+", "+((x1+x2)/2)+" "+y2+", "+x2+" "+y2,fill:"none",stroke:"url(#"+gradientId+")","stroke-opacity":.58,"stroke-width":width,tabindex:0,"aria-label":description});path.appendChild(node("title")).textContent=description;path.onmouseenter=path.onfocus=()=>detail.textContent=description;path.onmouseleave=path.onblur=()=>detail.textContent=defaultDetail;svg.append(path)});
for(const [name,pos]of positions){svg.append(node("rect",{x:pos.x,y:pos.y,width:12,height:pos.height,rx:2,fill:color(name)}));const label=svg.appendChild(node("text",{x:pos.x+18,y:pos.y+Math.min(16,pos.height/2+4)}));label.textContent=canonical(name).slice(0,32)}
}
const chartPalette=["#3973c6","#d39b2a","#2f855a","#b45f86"];
function chartLegend(svg,columns,w,y){columns.forEach((column,index)=>{svg.append(node("rect",{x:45+index*170,y:y-7,width:14,height:4,fill:chartPalette[index%chartPalette.length]}));svg.appendChild(node("text",{x:65+index*170,y})).textContent=column})}
function kpiGroup(r,box){const group=Object.assign(document.createElement("div"),{className:"kpi-pair"});r.columns.forEach((column,index)=>{const item=document.createElement("div"),value=document.createElement("strong"),label=document.createElement("span");value.textContent=chartValue(r.rows[0][index],column,true);label.textContent=column;item.append(value,label);group.append(item)});box.append(group)}
function barChart(r,box,mode="single"){
const rows=r.rows,columns=r.columns||["category","metric_value"],seriesCount=columns.length-1,rowHeight=mode==="grouped"?Math.max(38,seriesCount*13+15):38,w=820,h=Math.max(260,rows.length*rowHeight+55),svg=node("svg",{viewBox:`0 0 ${w} ${h}`,role:"img","aria-label":`${columns[0]}別の${columns.slice(1).join("・")}`}),plotWidth=w-280;
box.append(svg);const max=Math.max(1,...rows.map(row=>mode==="stacked"?row.slice(1).reduce((sum,value)=>sum+Number(value),0):Math.max(...row.slice(1).map(Number))));
rows.forEach((row,rowIndex)=>{const y=18+rowIndex*rowHeight;svg.appendChild(node("text",{x:4,y:y+16})).textContent=String(row[0]).slice(0,28);if(mode==="stacked"){let x=205;row.slice(1).forEach((value,seriesIndex)=>{const width=plotWidth*Number(value)/max,rect=node("rect",{x,y,width,height:24,fill:chartPalette[seriesIndex%chartPalette.length]});rect.appendChild(node("title")).textContent=`${row[0]} / ${columns[seriesIndex+1]}: ${chartValue(value,columns[seriesIndex+1])}`;svg.append(rect);x+=width})}else{row.slice(1).forEach((value,seriesIndex)=>{const barHeight=mode==="grouped"?10:24,barY=mode==="grouped"?y+seriesIndex*12:y,width=plotWidth*Number(value)/max,rect=node("rect",{x:205,y:barY,width,height:barHeight,rx:3,fill:chartPalette[seriesIndex%chartPalette.length]});rect.appendChild(node("title")).textContent=`${row[0]} / ${columns[seriesIndex+1]}: ${chartValue(value,columns[seriesIndex+1])}`;svg.append(rect);if(mode==="single")svg.appendChild(node("text",{x:215+width,y:y+16})).textContent=chartValue(value,columns[1])})}});if(seriesCount>1)chartLegend(svg,columns.slice(1),w,h-16)
}
function lineChart(r,box){
const w=820,h=360,seriesCount=r.columns.length-1,seriesValues=Array.from({length:seriesCount},(_unused,seriesIndex)=>r.rows.map(row=>row[seriesIndex+1]===null||row[seriesIndex+1]===undefined||row[seriesIndex+1]===""?NaN:Number(row[seriesIndex+1])).filter(Number.isFinite));if(!seriesValues.some(values=>values.length)){box.appendChild(Object.assign(document.createElement("p"),{className:"notice warning",textContent:"数値が取得できる日付はありませんでした。"}));return}const scaleFor=values=>{const min=Math.min(...values),max=Math.max(...values);return{min,max,span:max-min||1}},magnitudes=seriesValues.map(values=>Math.max(0,...values.map(Math.abs))).filter(value=>value>0),independent=seriesCount>1&&magnitudes.length>1&&Math.max(...magnitudes)/Math.min(...magnitudes)>=100,globalScale=scaleFor(seriesValues.flat()),scales=independent?seriesValues.map(scaleFor):seriesValues.map(()=>globalScale),svg=node("svg",{viewBox:`0 0 ${w} ${h}`,role:"img","aria-label":`${r.columns[0]}ごとの${r.columns.slice(1).join("・")}推移${independent?"（系列ごとの独立スケール）":""}`});box.append(svg);
for(let seriesIndex=0;seriesIndex<seriesCount;seriesIndex++){const scale=scales[seriesIndex],points=r.rows.map((row,index)=>{const value=row[seriesIndex+1]===null||row[seriesIndex+1]===undefined||row[seriesIndex+1]===""?NaN:Number(row[seriesIndex+1]);return Number.isFinite(value)?[45+index*(w-80)/Math.max(r.rows.length-1,1),25+(scale.max-value)*(h-75)/scale.span,value,row[0]]:null}),draw=segment=>{if(segment.length>1)svg.append(node("polyline",{points:segment.map(point=>point.slice(0,2).join(",")).join(" "),fill:"none",stroke:chartPalette[seriesIndex%chartPalette.length],"stroke-width":3}));segment.forEach(point=>{const circle=node("circle",{cx:point[0],cy:point[1],r:4,fill:chartPalette[seriesIndex%chartPalette.length]});circle.appendChild(node("title")).textContent=`${point[3]} / ${r.columns[seriesIndex+1]}: ${chartValue(point[2],r.columns[seriesIndex+1])}`;svg.append(circle)})};let segment=[];for(const point of [...points,null]){if(point)segment.push(point);else if(segment.length){draw(segment);segment=[]}}}if(seriesCount>1)chartLegend(svg,r.columns.slice(1),w,h-18);if(independent)box.appendChild(Object.assign(document.createElement("p"),{className:"chart-caption multi-line-scale-note",textContent:"系列の最大絶対値が100倍以上異なるため、系列ごとに独立した縦軸スケールで推移を描画しています。各点の値はマウス操作で確認できます。"}))
}
function scatterChart(r,box,isBubble){
const w=820,h=390,xValues=r.rows.map(row=>Number(row[1])),yValues=r.rows.map(row=>Number(row[2])),xMin=Math.min(...xValues),xMax=Math.max(...xValues),yMin=Math.min(...yValues),yMax=Math.max(...yValues),xSpan=xMax-xMin||1,ySpan=yMax-yMin||1,sizes=isBubble?r.rows.map(row=>Math.max(0,Number(row[3]))):[],sizeMax=Math.max(...sizes,1),svg=node("svg",{viewBox:`0 0 ${w} ${h}`,role:"img","aria-label":`${r.columns[1]}と${r.columns[2]}の関係`});box.append(svg);svg.append(node("line",{x1:55,y1:h-48,x2:w-25,y2:h-48,stroke:"#98a2b3"}),node("line",{x1:55,y1:20,x2:55,y2:h-48,stroke:"#98a2b3"}));svg.appendChild(node("text",{x:w/2-40,y:h-16})).textContent=r.columns[1];svg.appendChild(node("text",{x:8,y:18})).textContent=r.columns[2];r.rows.forEach((row,index)=>{const x=55+(Number(row[1])-xMin)*(w-90)/xSpan,y=20+(yMax-Number(row[2]))*(h-68)/ySpan,radius=isBubble?5+18*Math.sqrt(sizes[index]/sizeMax):6,description=`${row[0]}: ${r.columns[1]} ${chartValue(row[1],r.columns[1])} / ${r.columns[2]} ${chartValue(row[2],r.columns[2])}${isBubble?` / ${r.columns[3]} ${chartValue(row[3],r.columns[3])}`:""}`,circle=node("circle",{cx:x,cy:y,r:radius,fill:"#3973c6","fill-opacity":.62,stroke:"#1f4e79",tabindex:0,"aria-label":description});circle.appendChild(node("title")).textContent=description;svg.append(circle);if(index<12)svg.appendChild(node("text",{x:x+radius+3,y:y+4})).textContent=String(row[0]).slice(0,18)})
}
function funnelChart(r,box){const funnel=Object.assign(document.createElement("div"),{className:"funnel"}),max=Math.max(...r.rows.map(row=>Number(row[1])),1);r.rows.forEach(row=>{const step=Object.assign(document.createElement("div"),{className:"funnel-step"});step.style.width=Math.max(24,Number(row[1])/max*100)+"%";step.append(document.createTextNode(String(row[0])),Object.assign(document.createElement("strong"),{textContent:chartValue(row[1],r.columns[1],true)}));funnel.append(step)});box.append(funnel)}
function heatmapChart(r,box){const xs=[...new Set(r.rows.map(row=>String(row[0])))],ys=[...new Set(r.rows.map(row=>String(row[1])))],w=Math.max(620,90+xs.length*72),h=Math.max(260,70+ys.length*40),values=r.rows.map(row=>Number(row[2])),min=Math.min(...values),max=Math.max(...values),span=max-min||1,svg=node("svg",{viewBox:`0 0 ${w} ${h}`,role:"img","aria-label":`${r.columns[0]}と${r.columns[1]}による${r.columns[2]}のヒートマップ`}),lookup=new Map(r.rows.map(row=>[`${row[0]}\u0000${row[1]}`,Number(row[2])]));box.append(svg);xs.forEach((value,index)=>{svg.appendChild(node("text",{x:95+index*72,y:22})).textContent=value.slice(0,10)});ys.forEach((yValue,rowIndex)=>{svg.appendChild(node("text",{x:4,y:52+rowIndex*40})).textContent=yValue.slice(0,13);xs.forEach((xValue,columnIndex)=>{const metricValue=lookup.get(`${xValue}\u0000${yValue}`),opacity=metricValue===undefined?.05:.16+.84*(metricValue-min)/span,rect=node("rect",{x:90+columnIndex*72,y:30+rowIndex*40,width:68,height:34,rx:3,fill:"#3973c6","fill-opacity":opacity});rect.appendChild(node("title")).textContent=metricValue===undefined?`${xValue} / ${yValue}: データなし`:`${xValue} / ${yValue}: ${chartValue(metricValue,r.columns[2])}`;svg.append(rect)})})}
function renderResultTable(r,box){const scroll=Object.assign(document.createElement("div"),{className:"chart-table-scroll"});scroll.appendChild(table(r.columns,r.rows));box.appendChild(scroll)}
function graph(r,box=$("chart")){
box.replaceChildren();if(!r.rows.length){box.appendChild(Object.assign(document.createElement("p"),{className:"notice warning",textContent:"該当する行はありませんでした。"}));return}
if(r.visualization==="scalar"){box.appendChild(Object.assign(document.createElement("div"),{className:"metric",textContent:chartValue(r.rows[0][0],r.columns[0],true)}));return}
if(["kpi_group","kpi_pair"].includes(r.visualization)){kpiGroup(r,box);return}
if(r.visualization==="bar"){barChart(r,box);return}
if(r.visualization==="grouped_bar"){barChart(r,box,"grouped");return}
if(r.visualization==="stacked_bar"){barChart(r,box,"stacked");return}
if(["line","multi_line","trend"].includes(r.visualization)){lineChart(r,box);return}
if(r.visualization==="scatter"){scatterChart(r,box,false);return}
if(r.visualization==="bubble"){scatterChart(r,box,true);return}
if(r.visualization==="funnel"){funnelChart(r,box);return}
if(r.visualization==="heatmap"){heatmapChart(r,box);return}
if(r.visualization==="sankey"){const valueLabel=r.columns?.[2]||"値",svg=node("svg",{viewBox:"0 0 980 460",role:"img","aria-label":`${r.columns?.[0]||"source"}から${r.columns?.[1]||"target"}への主要な流れ`}),detail=Object.assign(document.createElement("p"),{className:"chart-caption sankey-detail",textContent:`線にマウスを重ねるか、Tabキーで選ぶと遷移元・遷移先・${valueLabel}を確認できます。`});box.append(svg,detail);sankey(svg,r.rows,980,460,detail,valueLabel);box.appendChild(Object.assign(document.createElement("p"),{className:"chart-caption",textContent:"色は項目を示し、リンク幅は値の大きさを示します。"}));return}
if(r.visualization==="table"){renderResultTable(r,box);return}
throw new Error(`未対応の可視化形式です: ${r.visualization}`)
}
function finish(status){$("run-status").textContent=status;stages.forEach(s=>$("s-"+s).removeAttribute("aria-current"))}
function handle(e){if(e.type==="stage"){stage(e.stage);$("message").textContent=e.message}else if(e.type==="sql"){stage("validate");$("output").className="";renderSql($("sql"),e.sql);$("reason").textContent=e.reason}else if(e.type==="result"){stage("render");$("output").className="";$("verification").className=e.verification==="matched"?"notice":"notice warning";$("verification").textContent=e.verification_label;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}（BigQuery利用料は別）`;populateResult(e);$("message").textContent="生成・実行・描画が完了しました。";stages.forEach(s=>$("s-"+s).className="done");finish("完了")}else if(e.type==="refusal"){stage("render");$("output").className="";renderSql($("sql"),"");$("reason").textContent=e.reason;$("verification").className="notice warning";$("verification").textContent=`未定義のため生成しません: ${e.undefined_terms.join("、")}`;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;clearResult();$("message").textContent=`未定義のため停止: ${e.undefined_terms.join("、")}`;finish("停止")}else if(e.type==="error")throw new Error(e.message)}
function createDashboardCard(panel){const card=Object.assign(document.createElement("section"),{className:"dashboard-card"}),head=document.createElement("div"),title=document.createElement("h3"),state=Object.assign(document.createElement("span"),{className:"panel-state",textContent:"待機中"}),purpose=Object.assign(document.createElement("p"),{className:"purpose",textContent:panel.purpose}),chart=Object.assign(document.createElement("div"),{className:"chart"}),inspect=Object.assign(document.createElement("button"),{className:"inspect-panel",type:"button",textContent:"詳細を確認"}),reason=document.createElement("p"),verification=Object.assign(document.createElement("p"),{className:"notice",textContent:"未実行"}),sql=Object.assign(document.createElement("pre"),{className:"sql"}),data=document.createElement("div");card.dataset.panelId=panel.id;card.dataset.chart=panel.chart;title.textContent=panel.title;head.append(title,state);inspect.onclick=()=>openPanelInspector(panel.id);card.append(head,purpose,chart,inspect);$("dashboard-grid").append(card);dashboardPanels.set(panel.id,{card,title:panel.title,purpose:panel.purpose,state,chart,reason,verification,sql,data})}
function renderDashboardRow(row,cards,separators,shares){const columns=[];cards.forEach((_card,index)=>{columns.push(`minmax(0,${shares[index]}fr)`);if(index<separators.length)columns.push("10px")});row.style.gridTemplateColumns=columns.join(" ");separators.forEach((separator,index)=>{const before=shares.slice(0,index).reduce((total,value)=>total+value,0),combined=shares[index]+shares[index+1],position=Math.round(before+shares[index]);separator.setAttribute("aria-valuemin",String(Math.round(before+15)));separator.setAttribute("aria-valuemax",String(Math.round(before+combined-15)));separator.setAttribute("aria-valuenow",String(position));separator.setAttribute("aria-valuetext",`${cards[index].querySelector("h3").textContent} ${Math.round(shares[index])}%、${cards[index+1].querySelector("h3").textContent} ${Math.round(shares[index+1])}%`)})}
function groupDashboardPanelRow(ids,initialShares){const cards=ids.map(id=>dashboardPanels.get(id)?.card);if(cards.some(card=>!card))return;const grid=$("dashboard-grid"),row=Object.assign(document.createElement("section"),{className:"dashboard-layout-row"}),shares=[...initialShares],separators=[];grid.insertBefore(row,cards[0]);cards.forEach((card,index)=>{row.append(card);if(index===cards.length-1)return;const separator=Object.assign(document.createElement("div"),{className:"dashboard-card-resizer",tabIndex:0,title:`${dashboardPanels.get(ids[index]).title}と${dashboardPanels.get(ids[index+1]).title}の幅を調整`});separator.setAttribute("role","separator");separator.setAttribute("aria-label",separator.title);separator.setAttribute("aria-orientation","vertical");row.append(separator);separators.push(separator)});const resize=(index,event)=>{const bounds=row.getBoundingClientRect(),usable=Math.max(bounds.width-separators.length*10,1),before=shares.slice(0,index).reduce((total,value)=>total+value,0),combined=shares[index]+shares[index+1],desired=(event.clientX-bounds.left-index*10)/usable*100-before,minLeft=15,minRight=15,left=Math.max(minLeft,Math.min(combined-minRight,desired));shares[index]=left;shares[index+1]=combined-left;renderDashboardRow(row,cards,separators,shares)};separators.forEach((separator,index)=>{const stop=event=>{separator.classList.remove("dragging");if(separator.hasPointerCapture(event.pointerId))separator.releasePointerCapture(event.pointerId)};separator.onpointerdown=event=>{separator.classList.add("dragging");separator.setPointerCapture(event.pointerId);resize(index,event)};separator.onpointermove=event=>{if(separator.classList.contains("dragging"))resize(index,event)};separator.onpointerup=stop;separator.onpointercancel=stop;separator.onkeydown=event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const combined=shares[index]+shares[index+1],left=event.key==="Home"?15:event.key==="End"?combined-15:event.key==="ArrowLeft"?shares[index]-5:shares[index]+5,next=Math.max(15,Math.min(combined-15,left));shares[index]=next;shares[index+1]=combined-next;renderDashboardRow(row,cards,separators,shares)}});renderDashboardRow(row,cards,separators,shares)}
function handleDashboard(e){if(e.type==="dashboard_plan"){$("dashboard-empty").className="hidden";$("dashboard-output").className="";$("dashboard-title").textContent=e.period+" 分析ダッシュボード";$("dashboard-provenance").textContent=`分析仕様 ${e.plan_revision} / 組織コンテキスト ${e.organization_context_revision}。AIが提案した分析順に表示します。`;$("dashboard-grid").replaceChildren();dashboardPanels.clear();activePanelId=null;$("inspector-empty").className="inspector-empty";$("inspector-content").className="hidden";e.panels.forEach(createDashboardCard);e.layout_rows.forEach(row=>groupDashboardPanelRow(row.panel_ids,row.shares));$("dashboard-message").textContent=`${e.panels.length}件の分析へ分解しました。順番にSQLを生成します。`;return}const panel=dashboardPanels.get(e.panel_id);if(e.type==="stage"&&panel){const stageLabel=e.stage==="generate"?"SQL生成中":e.stage==="validate"?"出力検証中":e.stage==="repair"?"SQL修正中":"BigQuery実行中";panel.state.textContent=`${e.panel_index}/${e.panel_count} ${stageLabel}`;$("dashboard-message").textContent=`${e.title}: ${e.message}`;if(activePanelId===e.panel_id)openPanelInspector(e.panel_id);return}if(e.type==="sql"&&panel){renderSql(panel.sql,e.sql);panel.reason.textContent=e.reason;panel.state.textContent="SQL検査済み";if(activePanelId===e.panel_id)openPanelInspector(e.panel_id);return}if(e.type==="result"&&panel){graph(e,panel.chart);panel.data.replaceChildren(table(e.columns,e.rows));panel.verification.className=e.verification==="matched"?"notice":"notice warning";panel.verification.textContent=e.verification_label;panel.state.textContent=e.visualization==="table"?"表を表示":["scalar","kpi_group"].includes(e.visualization)?"KPI表示完了":"グラフ描画完了";if(activePanelId===e.panel_id)openPanelInspector(e.panel_id);return}if(e.type==="refusal"&&panel){panel.reason.textContent=e.reason;panel.verification.className="notice warning";panel.verification.textContent=`未定義のため停止: ${e.undefined_terms.join("、")}`;panel.state.textContent="停止";if(activePanelId===e.panel_id)openPanelInspector(e.panel_id);return}if(e.type==="dashboard_complete"){if(e.panel_count!==dashboardPanels.size)throw new Error(`確定した${dashboardPanels.size}件のうち${e.panel_count}件しか完了していません。`);dashboardStage("complete");$("dashboard-status").textContent="完了";$("dashboard-cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;$("dashboard-message").textContent=`${e.panel_count}件のSQL生成・実行・描画が完了しました。`;latestBuildRevision=e.build_revision;$("report-submit").className=latestBuildRevision?"":"hidden";selectWorkspace("dashboard");enterDashboardReadingMode();return}if(e.type==="error")throw new Error(e.message)}
function handlePlan(e){if(e.type==="plan_stage"){$("dashboard-status").textContent="相談中";$("dashboard-message").textContent=e.message}else if(e.type==="plan")renderAnalysisPlan(e);else if(e.type==="error"){if(e.suggested_instruction)showPlanCorrection(e.suggested_instruction);throw new Error(e.message)}}
function handleMeetingReport(e){if(e.type==="report_stage"){selectWorkspace("report");setReportState("生成中",e.message)}else if(e.type==="meeting_report"){renderMeetingReport(e);setReportState("要承認",`根拠付き会議報告案を生成しました。Vertex AI推定 ¥${e.cost_jpy}`);selectWorkspace("report")}else if(e.type==="error")throw new Error(e.message)}
function startActiveRequest(){if(activeRequest)throw new Error("実行中の処理を停止してから再送してください。");const random=Math.floor(Math.random()*0xffffffff).toString(16).padStart(8,"0"),operation={requestId:`request-${Date.now()}-${random}`,controller:new AbortController(),stopping:false};activeRequest=operation;$("analysis-composer").setAttribute("aria-busy","true");$("composer-submit").textContent="■";$("composer-submit").setAttribute("aria-label","実行中の処理を停止");$("composer-input").disabled=true;$("composer-profile").disabled=true;document.querySelectorAll("[data-composer-action]").forEach(button=>button.disabled=true);return operation}
function finishActiveRequest(operation,force=false){if(activeRequest!==operation||operation.stopping&&!force)return;activeRequest=null;$("analysis-composer").removeAttribute("aria-busy");$("composer-submit").disabled=false;$("composer-submit").textContent="↑";$("composer-submit").setAttribute("aria-label","分析指示を送信");$("composer-input").disabled=false;$("composer-profile").disabled=false;document.querySelectorAll("[data-composer-action]").forEach(button=>button.disabled=false)}
async function stopActiveRequest(){const operation=activeRequest;if(!operation||operation.stopping)return;operation.stopping=true;$("composer-submit").disabled=true;$("composer-message").textContent="実行中の処理を停止しています。";operation.controller.abort();try{const response=await fetch("/api/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request_id:operation.requestId})});if(!response.ok)throw new Error(`HTTP ${response.status}`);$("composer-message").textContent="処理を停止しました。追加の質問を入力できます。"}catch(_error){$("composer-message").textContent="画面の受信は停止しましたが、サーバーへ停止を確認できませんでした。処理完了後に再送してください。"}finally{finishActiveRequest(operation,true)}}
async function stream(endpoint,question,eventHandler,profile="ga4",extra={},operation){const res=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},signal:operation.controller.signal,body:JSON.stringify({question,profile,request_id:operation.requestId,...extra})});if(!res.ok)throw new Error((await res.json()).error);const reader=res.body.getReader(),dec=new TextDecoder();let buf="";while(true){const{done,value}=await reader.read();buf+=dec.decode(value||new Uint8Array(),{stream:!done});const lines=buf.split("\n");buf=lines.pop();for(const line of lines)if(line)eventHandler(JSON.parse(line));if(done){if(buf.trim())eventHandler(JSON.parse(buf));break}}}
function showCost(mode){const consultation=mode==="analysis-consult",dashboard=mode.startsWith("dashboard")||mode==="report",input=consultation?{value:pendingConsultation?.question||""}:$(dashboard?"dashboard-question":"question"),message=consultation?$("consultation-status"):$(dashboard?"dashboard-message":"message");if(activeRequest){message.className="notice error";message.textContent="実行中の処理を停止してから別の操作を開始してください。";return}if(!input.value.trim()){message.className="notice error";message.textContent="問い合わせを入力してください。";return}pendingMode=mode;const planning=mode==="dashboard-plan",building=mode==="dashboard-build",reporting=mode==="report",count=building?pendingPlan.panels.length:0;$("cost-description").textContent=consultation?"分析内容の相談ではVertex AIだけを使用し、BigQueryは実行しません。":planning?"分析計画の相談ではVertex AIだけを使用し、BigQueryは実行しません。":building?`確定する${count}件の分析で実際のVertex AIとBigQueryを使用します。`:reporting?"確定した集計結果から会議報告案を作ります。BigQueryは再実行しません。":"この質問では実際のVertex AIとBigQueryを使用します。";$("cost-vertex").textContent=consultation?"Vertex AI 約¥1（分析相談1回）":planning?"Vertex AI 約¥1（分析計画1回）":building?`Vertex AI 最大約¥${count*2}（SQL生成${count}回・dry run診断修正は各1回まで）`:reporting?"Vertex AI 最大約¥25（根拠bundle 48 KiB・出力8,192 tokens上限・思考tokensを含む）":"Vertex AI 最大約¥2（SQL生成1回・dry run診断修正1回まで）";$("cost-bigquery").textContent=consultation?"BigQuery ¥0（相談では実行しません）":planning?"BigQuery ¥0（仕様確定前は実行しません）":building?`BigQuery 最大${count*20} GiB（生成SQLを各20 GiB、最大約¥${count*19}）`:reporting?"BigQuery ¥0（保存済み集計bundleだけを参照）":"BigQuery 最大20 GiB（生成SQL 1クエリ、最大約¥19）";$("cost-total").textContent=consultation?"今回の相談 約¥1":planning?"今回の相談 約¥1":building?`合計最大約¥${count*21}`:reporting?"今回の報告案 最大約¥25":"合計最大約¥21";$("cost-dialog").showModal()}
function requestMeetingReport(){if(!latestBuildRevision){setReportState("エラー","会議報告案を生成できるbuild結果がありません。","notice error");selectWorkspace("report");return}setReportState("費用確認待ち","会議報告案の生成費用を確認してください。BigQueryは再実行しません。");try{showCost("report")}catch(_error){setReportState("エラー","費用確認ダイアログを開けませんでした。","notice error");selectWorkspace("report")}}
configureCopyButton($("sql-copy"),$("sql"));configureCopyButton($("inspector-sql-copy"),$("inspector-sql"));$("view-dashboard").onclick=()=>selectWorkspace("dashboard");$("view-build").onclick=()=>selectWorkspace("build");$("view-report").onclick=()=>selectWorkspace("report");$("view-graph").onclick=()=>selectWorkspace("graph");$("open-build-studio").onclick=()=>selectWorkspace("build");$("back-to-dashboard").onclick=()=>selectWorkspace("dashboard");$("sidebar-toggle").onclick=toggleSidebar;$("inspector-toggle").onclick=toggleInspector;$("inspector-tab-reason").onclick=()=>selectInspectorTab("reason");$("inspector-tab-sql").onclick=()=>selectInspectorTab("sql");$("inspector-tab-data").onclick=()=>selectInspectorTab("data");$("inspector-tab-provenance").onclick=()=>selectInspectorTab("provenance");const navigationResizer=$("navigation-resizer");navigationResizer.setAttribute("aria-valuenow",parseInt(getComputedStyle($("app-shell")).getPropertyValue("--nav-width"),10)||220);navigationResizer.onpointerdown=event=>{navigationResizer.classList.add("dragging");navigationResizer.setPointerCapture(event.pointerId);resizeNavigation(event)};navigationResizer.onpointermove=event=>{if(navigationResizer.classList.contains("dragging"))resizeNavigation(event)};navigationResizer.onpointerup=event=>{navigationResizer.classList.remove("dragging");navigationResizer.releasePointerCapture(event.pointerId)};navigationResizer.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const current=parseInt(getComputedStyle($("app-shell")).getPropertyValue("--nav-width"),10)||220,width=Math.max(180,Math.min(360,event.key==="ArrowLeft"?current-20:current+20));$("app-shell").style.setProperty("--nav-width",width+"px");navigationResizer.setAttribute("aria-valuenow",String(width))};const inspectorResizer=$("inspector-resizer");inspectorResizer.setAttribute("aria-valuenow",parseInt(getComputedStyle($("app-shell")).getPropertyValue("--inspector-width"),10)||330);inspectorResizer.onpointerdown=event=>{inspectorResizer.classList.add("dragging");inspectorResizer.setPointerCapture(event.pointerId);resizeInspector(event)};inspectorResizer.onpointermove=event=>{if(inspectorResizer.classList.contains("dragging"))resizeInspector(event)};inspectorResizer.onpointerup=event=>{inspectorResizer.classList.remove("dragging");inspectorResizer.releasePointerCapture(event.pointerId)};inspectorResizer.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const current=parseInt(getComputedStyle($("app-shell")).getPropertyValue("--inspector-width"),10)||330,width=Math.max(280,Math.min(560,event.key==="ArrowLeft"?current+20:current-20));$("app-shell").style.setProperty("--inspector-width",width+"px");inspectorResizer.setAttribute("aria-valuenow",String(width))};$("dataset-profile").onchange=()=>{pendingInsightSpecification=null;selectProfile($("dataset-profile").value)};$("result-tab-chart").onclick=()=>selectResultTab("chart");$("result-tab-data").onclick=()=>selectResultTab("data");$("submit").onclick=()=>showCost("graph");$("dashboard-submit").onclick=()=>{currentAnswers={};currentPlan=null;pendingPlan=null;pendingPlanBase=null;pendingPlanInstruction=null;$("plan-revision-instruction").value="";dashboardStage();showCost("dashboard-plan")};$("plan-audience").oninput=()=>syncPlanFieldAnswer("audience",$("plan-audience").value);$("plan-comparison").oninput=()=>syncPlanFieldAnswer("comparison",$("plan-comparison").value);$("plan-revise").onclick=()=>{try{collectAnswers();pendingPlanInstruction=$("plan-revision-instruction").value.trim();if(!pendingPlanInstruction)throw new Error("追加・変更・削除したい内容を入力してください。");pendingPlanBase=selectedPlan();showCost("dashboard-plan")}catch(e){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message}};$("plan-build").onclick=()=>{try{collectAnswers();pendingPlan=selectedPlan();showCost("dashboard-build")}catch(e){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message}};$("report-submit").onclick=requestMeetingReport;$("cancel-cost").onclick=()=>{if(pendingMode==="analysis-consult")rollbackPendingConsultation();$("cost-dialog").close()};$("confirm-cost").onclick=()=>pendingMode==="analysis-consult"?runAnalysisConsultation():pendingMode==="dashboard-plan"?runPlan():pendingMode==="dashboard-build"?runDashboard():pendingMode==="report"?runMeetingReport():runQuery();selectWorkspace("dashboard");if(window.innerWidth<1100)toggleInspector();
async function runQuery(){$("cost-dialog").close();const q=$("question").value.trim(),profile=$("dataset-profile").value,operation=startActiveRequest(),extra=pendingInsightSpecification?{analysis_specification:pendingInsightSpecification}:{};$("submit").disabled=true;$("run-status").textContent="処理中";$("output").className="hidden";clearResult();stage("generate");$("message").className="notice";$("message").textContent="Vertex AIへ問い合わせています。";try{await stream("/api/query",q,handle,profile,extra,operation)}catch(e){if(e.name!=="AbortError"){$("message").className="notice error";$("message").textContent=e.message;finish("エラー")}}finally{$("submit").disabled=false;finishActiveRequest(operation)}}
async function runPlan(){$("cost-dialog").close();selectWorkspace("build");const q=$("dashboard-question").value.trim(),operation=startActiveRequest();$("dashboard-submit").disabled=true;$("plan-revise").disabled=true;dashboardStage("plan");$("dashboard-status").textContent="相談中";$("dashboard-message").className="notice";$("dashboard-message").textContent=pendingPlanBase?"現在案へ変更依頼を反映しています。":"分析目的を分解しています。";try{await stream("/api/plan",q,handlePlan,"ga4",{answers:currentAnswers,analysis_plan:pendingPlanBase,revision_instruction:pendingPlanInstruction},operation)}catch(e){if(e.name!=="AbortError"){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message;$("dashboard-status").textContent="エラー"}}finally{$("dashboard-submit").disabled=false;$("plan-revise").disabled=false;finishActiveRequest(operation)}}
async function runDashboard(){$("cost-dialog").close();selectWorkspace("build");const q=$("dashboard-question").value.trim(),operation=startActiveRequest();$("plan-build").disabled=true;dashboardStage("build");$("dashboard-status").textContent="build中";$("dashboard-output").className="hidden";$("report-output").className="panel hidden report-home";$("report-empty").className="panel empty-state";$("report-submit").className="hidden";latestBuildRevision=null;setReportState("報告案なし","新しいbuild完了後に会議報告案を生成できます。");$("dashboard-message").className="notice";$("dashboard-message").textContent="確定した分析仕様をfreezeし、buildを開始します。";try{await stream("/api/dashboard",q,handleDashboard,"ga4",{analysis_plan:pendingPlan},operation)}catch(e){if(e.name!=="AbortError"){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message;$("dashboard-status").textContent="エラー"}}finally{$("plan-build").disabled=false;finishActiveRequest(operation)}}
async function runMeetingReport(){$("cost-dialog").close();selectWorkspace("report");const q=$("dashboard-question").value.trim(),operation=startActiveRequest();$("report-submit").disabled=true;setReportState("生成中","根拠と不確実性を整理中です。");try{await stream("/api/report",q,handleMeetingReport,"ga4",{build_revision:latestBuildRevision},operation)}catch(e){if(e.name!=="AbortError")setReportState("エラー",e.message,"notice error")}finally{$("report-submit").disabled=false;finishActiveRequest(operation)}}
</script></body></html>"""

# A static or proxy error page is commonly HTML. Never parse it as JSON or expose
# its markup; explain that the browser is not connected to the live API instead.
HTML = HTML.replace(
    'async function stream(endpoint,question,eventHandler,profile="ga4",extra={},operation){',
    'async function responseError(res){const type=res.headers.get("content-type")||"";'
    'if(type.includes("application/json")){try{const body=await res.json();'
    'if(body&&body.error)return body.error}catch(_error){}}'
    'return `操作可能なライブデモへ接続できません（HTTP ${res.status}）。'
    '固定表示ではなくdemo-liveを起動してください。`}'
    'async function stream(endpoint,question,eventHandler,profile="ga4",extra={},operation){',
    1,
)
HTML = HTML.replace(
    'if(!res.ok)throw new Error((await res.json()).error);',
    'if(!res.ok)throw new Error(await responseError(res));',
    1,
)

# The navigation and inspector own the full viewport. Only the center column owns
# the context header; this avoids placing a global toolbar in front of both panes.
_GLOBAL_HEADER = re.search(r'<header class="app-header">.*?</header>', HTML)
if _GLOBAL_HEADER is None:  # pragma: no cover - static template invariant
    raise RuntimeError("live demo header markup is missing")
_original_header_markup = _GLOBAL_HEADER.group(0)
_header_markup = _original_header_markup.replace(
    '<span class="brand">RepChat</span><span>Live analysis demo</span>',
    '<span id="compact-title" class="header-title">分析ワークスペース</span>',
)
HTML = HTML.replace(_original_header_markup, "", 1)
HTML = HTML.replace('<main id="workspace-main"', _header_markup + '<main id="workspace-main"', 1)
HTML = HTML.replace(
    '<aside id="workspace-sidebar" class="workspace-sidebar">',
    '<aside id="workspace-sidebar" class="workspace-sidebar">'
    '<div class="sidebar-chrome"><span class="brand">RepChat</span></div>',
    1,
)

# Present one analysis conversation instead of four peer modes. Saved and draft
# outputs remain addressable as artifacts in the navigation tree, while the
# shared composer below the main surface chooses the next explicit action.
_sidebar_body_pattern = re.compile(
    r'<p class="sidebar-label">分析ワークスペース</p>.*?</aside>', re.DOTALL
)
_sidebar_body = r"""
<button id="new-analysis" class="new-analysis" type="button">新しい分析</button>
<p class="sidebar-label">成果物</p>
<nav class="workspace-nav artifact-tree" aria-label="分析成果物">
<button id="view-dashboard" type="button" title="購入成果改善ダッシュボード"><span class="sidebar-title"><span>購入成果改善ダッシュボード</span></span><small>2021年1月</small></button>
<button id="view-graph" type="button" title="未保存のインサイト"><span class="sidebar-title"><span>未保存のインサイト</span></span><small>単一グラフ</small></button>
<button id="view-report" type="button" title="会議報告"><span class="sidebar-title"><span>会議報告</span></span><small>根拠付き下書き</small></button>
</nav>
<p class="sidebar-label">分析スレッド</p>
<nav class="workspace-nav thread-tree" aria-label="分析スレッド">
<button id="view-build" class="selected" type="button" aria-current="page" title="購入成果を改善する"><span class="sidebar-title"><span>購入成果を改善する</span></span><small>現在の対話</small></button>
</nav>
<div class="sidebar-account"><span class="account-avatar">デ</span><span><strong>デモ組織</strong><small>EC月次分析</small></span></div>
</aside>"""
HTML, _sidebar_count = _sidebar_body_pattern.subn(_sidebar_body, HTML, count=1)
if _sidebar_count != 1:  # pragma: no cover - static template invariant
    raise RuntimeError("live demo sidebar markup is missing")

_composer_markup = r"""
<section id="analysis-composer" class="analysis-composer" aria-label="分析アシスタントへの指示">
<div class="composer-context">
<span id="composer-target" class="composer-target">対象: 現在の分析スレッド</span>
<div class="composer-actions" role="group" aria-label="実行する操作">
<button type="button" data-composer-action="consult">相談</button>
<button type="button" class="selected" data-composer-action="dashboard">ダッシュボード</button>
<button type="button" data-composer-action="insight">インサイト</button>
<button type="button" data-composer-action="report">会議報告</button>
</div>
<select id="composer-profile" class="hidden" aria-label="分析対象データ">
<option value="ga4">GA4 ECサイト</option><option value="bitcoin">Bitcoin取引</option>
</select>
<button id="composer-collapse" class="composer-collapse" type="button" aria-label="相談入力を小さくする">⌄</button>
</div>
<textarea id="composer-input" rows="2" aria-label="分析したい内容">2021年1月のECサイトで購入成果を改善するため、課題の場所と優先施策を判断できるダッシュボードを作って</textarea>
<div class="composer-footer"><span id="composer-message">操作と対象を確認して送信してください。</span><button id="composer-submit" type="button" aria-label="分析指示を送信">↑</button></div>
<button id="composer-launcher" class="composer-launcher" type="button" aria-label="AIへの相談入力を開く" aria-expanded="true" aria-controls="composer-input"><span aria-hidden="true">✦</span> AIに相談</button>
</section>
"""
HTML = HTML.replace(
    '<p class="lead local-note">', _composer_markup + '<p class="lead local-note">', 1
)

_consultation_markup = r"""
<section id="analysis-consultation" class="workspace-view analysis-consultation hidden" aria-labelledby="consultation-heading">
<div id="consultation-thread" class="consultation-thread" aria-label="分析相談の対話履歴"></div>
<div class="consultation-assistant">
<p class="eyebrow">Analysis consultation</p>
<h2 id="consultation-heading">AIと分析内容を相談してください</h2>
<p id="consultation-introduction" class="lead">AIがスキーマ、指標定義、目的、これまでの対話から分析仕様を考察します。</p>
<p class="consultation-free"><strong>相談ではVertex AIを使用し、BigQueryは実行しません。</strong> SQL生成とデータ取得は、候補選択後に別途確認します。</p>
<div id="consultation-recommendations" class="consultation-recommendations" aria-label="おすすめの分析"></div>
<p id="consultation-status" class="consultation-status" role="status" aria-live="polite">下の入力欄から、判断したいことを相談してください。</p>
</div>
</section>
"""
HTML = HTML.replace(
    '<section id="build-studio-view"',
    _consultation_markup + '<section id="build-studio-view"',
    1,
)

_artifact_preview_markup = r"""
<section id="artifact-preview" class="artifact-preview hidden" aria-label="インサイトのプレビュー">
<div class="artifact-preview-heading"><span class="draft-badge">未保存</span><strong>単一グラフのインサイト</strong></div>
<p id="artifact-preview-empty" class="inspector-empty">中央下部の入力欄からインサイトを依頼すると、グラフ・取得データ・SQLをここに表示します。</p>
<div id="artifact-preview-host"></div>
</section>
"""
HTML = HTML.replace(
    '<p id="inspector-empty"', _artifact_preview_markup + '<p id="inspector-empty"', 1
)
HTML = HTML.replace('<p class="eyebrow">Panel inspector</p>', '<p class="eyebrow">Artifact</p>', 1)
HTML = HTML.replace('<h2 id="inspector-title">パネル詳細</h2>', '<h2 id="inspector-title">成果物の詳細</h2>', 1)
HTML = HTML.replace(
    '<p id="inspector-subtitle">グラフを選択すると根拠を確認できます。</p>',
    '<p id="inspector-subtitle">プレビュー、データ、SQL、来歴を確認できます。</p>',
    1,
)
HTML = HTML.replace(
    'build:["ダッシュボードを作成・編集","AIと分析目的を相談し、確認した仕様だけをbuildします。","相談・build"]',
    'build:["購入成果を改善する","AIと目的・KPI・比較軸を相談し、確認した仕様だけをbuildします。","分析スレッド"]',
    1,
)
HTML = HTML.replace(
    'graph:["単一グラフを生成","日本語からSQL生成・安全検査・BigQuery実行・可視化までを確認します。","ライブ実行"]',
    'graph:["未保存のインサイト","日本語からSQL生成・安全検査・BigQuery実行・可視化までを確認します。","ライブ実行"]',
    1,
)

# A static or proxy error page is commonly HTML. Never parse it as JSON or expose
# its markup; explain that the browser is not connected to the live API instead.
HTML = HTML.replace(
    "async function stream(endpoint,question,eventHandler,profile=\"ga4\",extra={}){",
    "async function responseError(res){const type=res.headers.get(\"content-type\")||\"\";"
    "if(type.includes(\"application/json\")){try{const body=await res.json();"
    "if(body&&body.error)return body.error}catch(_error){}}"
    "return `操作可能なライブデモへ接続できません（HTTP ${res.status}）。"
    "固定表示ではなくdemo-liveを起動してください。`}"
    "async function stream(endpoint,question,eventHandler,profile=\"ga4\",extra={}){",
    1,
)
HTML = HTML.replace(
    "if(!res.ok)throw new Error((await res.json()).error);",
    "if(!res.ok)throw new Error(await responseError(res));",
    1,
)

# Keep the local demo's feature-verification styles intact while applying the
# partner-facing workspace visual contract as the final cascade layer (#347).
WORKSPACE_POLISH_CSS = r"""
:root{
--color-background:#f3f5f7;
--color-surface-raised:#fff;
--color-border-strong:#cbd2dc;
--color-focus:#1f4e7940;
--color-success:#18794e;
--color-success-soft:#eaf7f0;
--radius-control:8px;
--radius-card:12px;
--shadow-card:0 1px 2px #1018280d,0 8px 24px #1018280a;
--shadow-pane:0 18px 48px #1018281f;
}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{overflow-x:hidden;background:var(--color-background);font-size:14px}
button,textarea,select{transition:border-color 120ms ease,background 120ms ease,box-shadow 120ms ease,transform 120ms ease}
button{min-height:36px;border-radius:var(--radius-control);padding:8px 14px;letter-spacing:.01em}
button:active:not(:disabled){transform:translateY(1px)}
:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}
textarea,select{border-color:var(--color-border-strong);border-radius:var(--radius-control)}
.app-header{position:sticky;top:0;z-index:50;background:#ffffffed;backdrop-filter:blur(14px);border-color:#e3e7ed;box-shadow:0 1px 0 #10182808}
.brand{font-size:17px;font-weight:600;letter-spacing:-.02em}
.draft-badge,.status-pill{border-color:#d7dde5;background:#fff;box-shadow:0 1px 1px #10182808}
#sidebar-toggle,#inspector-toggle{border-color:#c8d0da;background:#fff;box-shadow:0 1px 2px #1018280d}
#sidebar-toggle:hover,#inspector-toggle:hover{background:#edf3f8;border-color:#9fb5c9}
.app-shell{background:var(--color-background);min-width:0}
.workspace-sidebar{display:flex;flex-direction:column;overflow-x:hidden;padding:18px 12px 14px;border-color:#e1e6ec;box-shadow:1px 0 0 #10182803}
.sidebar-label{margin:18px 10px 8px;color:#778292;font-size:10px;letter-spacing:.11em}
.sidebar-label:first-child{margin-top:4px}
.workspace-nav{gap:5px}
.workspace-nav button{display:grid;grid-template-columns:22px minmax(0,1fr);align-items:center;column-gap:8px;min-height:40px;border-radius:9px;padding:9px 10px;color:#344054;font-size:13px;font-weight:680}
.workspace-nav button::before{color:#64748b;font-size:15px;text-align:center}
#view-dashboard::before{content:"▦"}
#view-build::before{content:"✦"}
#view-report::before{content:"▤"}
#view-graph::before{content:"⌁"}
.workspace-nav button:hover{background:#f1f4f7;color:#1f2937}
.workspace-nav button.selected{background:#e8f0f7;color:var(--color-primary);box-shadow:inset 3px 0 var(--color-primary)}
.workspace-nav button.selected::before{color:var(--color-primary)}
.sidebar-item{margin:0 10px;padding:10px 0 12px;border-color:#eef1f4;color:#475467;font-size:12px}
.future-note{color:#84909f}
.navigation-resizer,.inspector-resizer{border-color:#e1e6ec}
.navigation-resizer:hover,.navigation-resizer.dragging,.navigation-resizer:focus,.inspector-resizer:hover,.inspector-resizer.dragging,.inspector-resizer:focus{background:#b9d2e7}
.workspace{width:100%;min-width:0;padding:26px 28px 64px;background:var(--color-background)}
.workspace-topbar{align-items:center;margin:0 0 22px;padding:0 2px}
.workspace-topbar .page-heading{max-width:760px}
.eyebrow{margin-bottom:7px;color:#386489;font-size:10px;letter-spacing:.14em}
h1{font-size:26px;line-height:1.25;letter-spacing:-.025em}
.workspace-topbar .lead{margin:8px 0 0;font-size:13px;line-height:1.65}
.panel{border-color:#dfe4ea;border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.empty-state{min-height:310px;display:grid;place-content:center;padding:48px 34px;background:linear-gradient(145deg,#fff 0%,#f8fbfd 100%)}
.empty-state h2{font-size:21px;letter-spacing:-.015em}
.empty-state .lead{font-size:13px}
.dashboard-head{align-items:center;padding:18px 20px;background:#fff}
.dashboard-head h2{font-size:18px;letter-spacing:-.01em}
.dashboard-head .lead{margin:7px 0 0;font-size:12px}
.dashboard-head>div:last-child{min-width:128px;padding-left:18px;border-left:1px solid #e5e9ee;text-align:right}
.dashboard-head>div:last-child strong{font-size:13px}
.dashboard-grid{gap:14px;margin-top:14px;align-items:stretch;container-type:inline-size}
.dashboard-card{display:flex;flex-direction:column;grid-column:span 4;min-width:0;min-height:268px;padding:18px 18px 16px;border-color:#dde3ea;border-radius:var(--radius-card);box-shadow:var(--shadow-card);overflow:hidden;transition:border-color 140ms ease,box-shadow 140ms ease,transform 140ms ease}
.dashboard-card:hover{border-color:#bcc9d5;box-shadow:0 2px 4px #1018280d,0 14px 34px #10182812;transform:translateY(-1px)}
.dashboard-layout-row{grid-column:1/-1;display:grid;align-items:stretch;min-width:0}
.dashboard-layout-row>.dashboard-card{grid-column:auto!important;min-height:268px;margin:0}
.dashboard-card-resizer{position:relative;z-index:2;align-self:stretch;min-width:10px;cursor:col-resize;touch-action:none;outline:0}
.dashboard-card-resizer::after{content:"";position:absolute;top:12px;bottom:12px;left:calc(50% - .5px);width:1px;border-radius:999px;background:#dfe4ea;transition:background 120ms ease,box-shadow 120ms ease}
.dashboard-card-resizer:hover::after,.dashboard-card-resizer:focus-visible::after,.dashboard-card-resizer.dragging::after{background:#4b84b4;box-shadow:0 0 0 3px #4b84b426}
.dashboard-layout-row>.dashboard-card .chart{max-height:460px;overflow:auto}
@container (max-width:900px){.dashboard-layout-row{grid-template-columns:minmax(0,1fr)!important;gap:14px}.dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}.dashboard-layout-row>.dashboard-card .chart{max-height:none;overflow:visible}.dashboard-card-resizer{display:none}}
.dashboard-card h3{font-size:15px;line-height:1.45;letter-spacing:-.01em}
.dashboard-card .purpose{min-height:0;margin:9px 0 16px;color:#687386;font-size:11px}
.panel-state{display:inline-flex;align-items:center;min-height:23px;padding:3px 7px;border-radius:999px;background:var(--color-success-soft);color:var(--color-success);font-size:10px;white-space:nowrap}
.dashboard-card .chart{min-width:0;display:grid;align-items:start;overflow:visible;flex:1}
.dashboard-card .chart svg{display:block;min-width:0;width:100%;max-width:100%}
.chart-table-scroll{align-self:start;width:100%;max-height:360px;overflow:auto}
.chart-table-scroll table{width:max-content;min-width:100%;margin-top:0}
.chart-table-scroll th,.chart-table-scroll td{max-width:320px;overflow-wrap:anywhere;vertical-align:top}
.metric{align-self:center;padding:20px 6px;font-size:48px;letter-spacing:-.04em}
.kpi-pair{gap:10px;align-self:center;width:100%}
.kpi-pair div{padding:17px 16px;border:1px solid #edf0f3;border-radius:9px;background:#f7f9fb}
.kpi-pair strong{font-size:29px;letter-spacing:-.035em}
.funnel-step{border-radius:0 7px 7px 0;background:#e4effb}
.inspect-panel{align-self:flex-start;width:auto;margin-top:14px;padding:7px 11px;border-color:#d6dde5;background:#fff;color:#315f86;font-size:11px}
.inspect-panel::after{content:"  →"}
.dashboard-card.selected-card{border-color:#6c97bb;box-shadow:0 0 0 3px #4b84b426,var(--shadow-card)}
.workspace-inspector{overflow-x:hidden;padding:20px 18px;background:#fbfcfd;border-left:1px solid #e1e6ec}
.inspector-heading{padding:0 2px 15px;border-color:#e5e9ee}
.inspector-heading .eyebrow{margin-bottom:5px}
.inspector-heading h2{font-size:16px}
.inspector-empty{margin-top:14px;padding:22px 16px;border:1px dashed #cdd6df;border-radius:10px;background:#fff;color:#667085}
.inspector-tabs{gap:3px;padding:3px;border:1px solid #e2e7ec;border-radius:9px;background:#f1f4f7}
.inspector-tab{min-height:32px;border:0;border-radius:6px;padding:6px 4px;font-size:11px}
.inspector-tab.selected{border:0;background:#fff;color:var(--color-primary);box-shadow:0 1px 3px #10182814}
.inspector-panel{font-size:12px;line-height:1.7}
.notice{border-radius:0 8px 8px 0}
.local-note{padding:14px 2px 0;color:#7a8595;font-size:11px}
.view-actions{gap:8px}
dialog{border:0;border-radius:12px;box-shadow:0 24px 70px #10182838}

/* Issue #350: pane-owned chrome, compact type, and invisible resize hit areas. */
:root{--header-height:44px;--icon-button-size:32px;--splitter-hit-area:8px;--splitter-line:1px}
body{font-size:13px;font-weight:400}
.app-shell{grid-template-rows:44px minmax(0,1fr);min-height:100vh}
.app-header{grid-column:3;grid-row:1;position:sticky;top:0;z-index:30;height:var(--header-height);min-width:0;padding:0 48px;border-bottom:var(--splitter-line) solid #e8e8e8;box-shadow:none;background:#fff;backdrop-filter:none}
.header-context{gap:8px;min-width:0}
.header-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#343541;font-size:12px;font-weight:500}
.header-context strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
.brand{font-size:15px;font-weight:600;letter-spacing:-.015em}
.sidebar-chrome{display:flex;align-items:center;gap:8px;min-height:var(--header-height);padding:0 8px;color:#6b6b70;font-size:11px}
.sidebar-chrome .brand{color:#202123}
#sidebar-toggle,#inspector-toggle{width:var(--icon-button-size);height:var(--icon-button-size);min-height:var(--icon-button-size);border:0;border-radius:7px;padding:0;background:transparent;box-shadow:none;font-size:14px}
#sidebar-toggle:hover,#inspector-toggle:hover{border:0;background:#ececf1}
button{min-height:32px;padding:6px 11px;font-weight:500;letter-spacing:0}
.workspace-sidebar{grid-column:1;grid-row:1/3;position:sticky;top:0;height:100vh;padding:0 4px 8px;border:0;background:#f7f7f8;box-shadow:none}
.workspace-nav{gap:1px}
.workspace-nav button{grid-template-columns:16px minmax(0,1fr);column-gap:4px;min-height:36px;border-radius:7px;padding:6px 4px;font-weight:500;overflow:hidden}
.workspace-nav button.selected{background:#ececf1;box-shadow:none}
.workspace-nav button:focus-visible{outline:2px solid #7fa2c2;outline-offset:-2px}
.workspace-nav button::before{width:16px;font-size:14px}
.sidebar-label{margin:12px 5px 4px;font-weight:500;letter-spacing:.06em;text-transform:none}
.navigation-resizer,.inspector-resizer{position:sticky;top:0;z-index:35;width:var(--splitter-hit-area);height:100vh;justify-self:center;border:0;background:transparent;touch-action:none}
.navigation-resizer{grid-column:2;grid-row:1/3}
.inspector-resizer{grid-column:4;grid-row:1/3}
.app-shell.sidebar-collapsed .navigation-resizer,.app-shell.inspector-collapsed .inspector-resizer{display:none}
.navigation-resizer::after,.inspector-resizer::after{content:"";position:absolute;top:0;bottom:0;width:var(--splitter-line);background:#e5e5e5}
.navigation-resizer::after,.inspector-resizer::after{left:50%;transform:translateX(-50%)}
.navigation-resizer:hover,.navigation-resizer.dragging,.navigation-resizer:focus,.inspector-resizer:hover,.inspector-resizer.dragging,.inspector-resizer:focus{background:#4b84b414}
.workspace{grid-column:3;grid-row:2;width:100%;padding:22px 24px 56px}
.workspace-inspector{grid-column:5;grid-row:1/3;position:sticky;top:0;height:100vh;padding:16px 14px;border:0;background:#fafafa;box-shadow:none}
.app-shell.inspector-collapsed .workspace-inspector,.app-shell.sidebar-collapsed .workspace-sidebar{display:none;overflow:hidden}
.workspace-topbar{margin-bottom:18px}
.eyebrow{font-weight:500}
h1{font-size:24px;font-weight:600}
h2,.dashboard-card h3{font-weight:600}
.status-pill,.panel-state{font-weight:500}
.panel{border-color:#e5e7eb;box-shadow:0 1px 2px #10182808}
.dashboard-card{box-shadow:0 1px 2px #10182808}
@media(max-width:1400px) and (min-width:1181px){
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3){grid-column:span 6}
}
@media(max-width:1180px) and (min-width:961px){
.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed{--inspector-column:0px;--inspector-grip:0px;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr)}
.app-header{grid-column:3;grid-row:1}
.workspace-sidebar{grid-row:1/3}
.workspace{grid-column:3;grid-row:2}
.workspace-inspector{position:fixed;z-index:40;top:0;right:0;width:min(380px,42vw);height:100vh;box-shadow:var(--shadow-pane);transform:translateX(0);transition:transform 160ms ease-out,visibility 160ms}
.app-shell.inspector-collapsed .workspace-inspector{visibility:hidden;transform:translateX(100%)}
.inspector-resizer{display:none}
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3){grid-column:span 6}
}
@media(max-width:960px){
.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:var(--header-height) minmax(0,1fr)}
.app-header{grid-column:1;grid-row:1}
.workspace{grid-column:1;grid-row:2;width:100%}
.workspace-sidebar,.workspace-inspector{position:fixed;z-index:45;top:0;height:100vh;box-shadow:var(--shadow-pane);transition:transform 160ms ease-out,visibility 160ms}
.workspace-sidebar{left:0;width:min(320px,88vw);transform:translateX(0)}
.workspace-inspector{right:0;width:min(420px,92vw);transform:translateX(0)}
.app-shell.sidebar-collapsed .workspace-sidebar{display:flex;visibility:hidden;transform:translateX(-100%)}
.app-shell.inspector-collapsed .workspace-inspector{display:block;visibility:hidden;transform:translateX(100%)}
.navigation-resizer,.inspector-resizer{display:none}
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3),.dashboard-card:nth-child(4),.dashboard-card:nth-child(5){grid-column:span 6}
}
@media(max-width:760px){
.app-header{padding:0 48px;gap:8px}
.app-header .header-context:first-child>span:last-child,.app-header .header-context:last-child>strong{display:none}
#inspector-toggle{display:inline-flex}
.workspace{padding:20px 16px 44px}
.workspace-topbar{display:flex;align-items:flex-start;gap:10px;margin-bottom:18px}
.workspace-topbar .lead{font-size:12px}
h1{font-size:22px}
.workspace-nav{display:grid;overflow:visible}
.sidebar-label,.sidebar-item{display:block}
.workspace-inspector{display:block;width:100%}
.dashboard-head{display:block}
.dashboard-head>div:last-child{margin-top:14px;padding:12px 0 0;border-top:1px solid #e5e9ee;border-left:0;text-align:left}
.dashboard-grid{grid-template-columns:1fr}
.dashboard-card,.dashboard-card:nth-child(1),.dashboard-card:nth-child(2),.dashboard-card:nth-child(3),.dashboard-card:nth-child(4),.dashboard-card:nth-child(5),.dashboard-card:nth-child(6){grid-column:1;min-height:auto}
.dashboard-layout-row{grid-column:1;grid-template-columns:minmax(0,1fr)!important;gap:14px}
.dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}
.dashboard-card-resizer{display:none}
.dashboard-card{padding:17px}
.dashboard-card:nth-child(4),.dashboard-card:nth-child(5){min-height:340px}
.dashboard-card:nth-child(6){min-height:420px}
.kpi-pair{grid-template-columns:1fr 1fr}
}
@media(prefers-reduced-motion:reduce){
*,*::before,*::after{scroll-behavior:auto!important;transition-duration:0s!important;animation-duration:0s!important}
}

/* Issue #352: one conversation, an artifact tree, and a stable artifact pane. */
#sidebar-toggle,#inspector-toggle{position:fixed;top:6px;z-index:70;display:grid;place-items:center}
#sidebar-toggle{left:8px}#inspector-toggle{right:8px}
.pane-icon{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6}
.pane-icon .pane-fill{fill:currentColor;stroke:none;opacity:.18}
.sidebar-chrome{gap:5px;margin:0 -4px;padding:0 8px 0 44px;border-bottom:1px solid #e7e7e8}
.workspace-inspector{padding-top:52px}
.workspace{height:calc(100vh - var(--header-height));overflow:auto;padding-bottom:150px}
.workspace-topbar{display:none}
.workspace-sidebar .new-analysis{width:100%;justify-content:flex-start;margin:6px 0 1px;padding:6px 4px;border:0;background:transparent;color:#202123;text-align:left}
.workspace-sidebar .new-analysis::before{content:"＋";width:16px;margin-right:4px;font-size:16px;text-align:center}
.artifact-tree button,.thread-tree button{grid-template-rows:auto auto}
.artifact-tree .sidebar-title,.thread-tree .sidebar-title{grid-column:2;display:block;min-width:0;overflow:hidden;container-type:inline-size;line-height:1.25;white-space:nowrap}
.sidebar-title>span{display:block;width:max-content;min-width:100%;white-space:nowrap}
.workspace-nav button:hover .sidebar-title>span,.workspace-nav button:focus-visible .sidebar-title>span{animation:sidebar-title-marquee 4s linear infinite alternate}
@keyframes sidebar-title-marquee{0%,18%{transform:translateX(0)}82%,100%{transform:translateX(calc(-100% + 100cqw))}}
@media(prefers-reduced-motion:reduce){.workspace-nav button:hover .sidebar-title>span,.workspace-nav button:focus-visible .sidebar-title>span{animation:none}}
.artifact-tree button small,.thread-tree button small{grid-column:2;color:#8a8a91;font-size:10px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-account{display:flex;align-items:center;gap:6px;margin-top:auto;margin-right:-4px;margin-left:-4px;padding:8px 8px 0;border-top:1px solid #e7e7e8;color:#343541}
.sidebar-account>span:last-child{display:grid;min-width:0}.sidebar-account strong{font-size:12px;font-weight:500}.sidebar-account small{color:#85858b;font-size:10px}
.account-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e4e4e7;font-size:11px}
.analysis-composer{position:fixed;z-index:60;left:calc(var(--nav-column) + var(--nav-grip) + (100vw - var(--nav-column) - var(--nav-grip) - var(--inspector-column) - var(--inspector-grip))/2);bottom:14px;width:min(768px,calc(100vw - var(--nav-column) - var(--nav-grip) - var(--inspector-column) - var(--inspector-grip) - 48px));margin:0;padding:9px 11px 10px;transform:translateX(-50%);border:1px solid #d9d9df;border-radius:22px;background:#fff;box-shadow:0 8px 28px #10182817}
.analysis-composer.composer-collapsed{width:auto;min-width:0;padding:0;border:0;background:transparent;box-shadow:none}
.analysis-composer.composer-collapsed>:not(.composer-launcher){display:none}
.composer-launcher{display:none;align-items:center;gap:6px;min-height:34px;padding:7px 12px;border:1px solid #d9d9df;border-radius:999px;background:#fff;color:#343541;font-size:12px;font-weight:550;box-shadow:0 4px 16px #10182814}
.composer-launcher:hover,.composer-launcher:focus-visible{border-color:#9fb5c9;background:#f7f8fa;color:#1f4e79}.analysis-composer.composer-collapsed .composer-launcher{display:inline-flex}
.composer-collapse{display:none;place-items:center;width:24px;height:24px;min-height:24px;margin-left:auto;padding:0;border:0;border-radius:6px;background:transparent;color:#6b6b72;font-size:16px}.analysis-composer.dashboard-ready:not(.composer-collapsed) .composer-collapse{display:grid}.composer-collapse:hover,.composer-collapse:focus-visible{background:#ececf1;color:#202123}
.composer-context,.composer-footer{display:flex;align-items:center;gap:8px}.composer-context{flex-wrap:wrap;margin-bottom:5px}.composer-footer{justify-content:space-between;color:#85858b;font-size:10px}
.composer-target{padding:3px 7px;border-radius:999px;background:#f1f1f3;color:#5f5f66;font-size:10px}
.composer-actions{display:flex;gap:2px}.composer-actions button{min-height:24px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:#6b6b72;font-size:10px}.composer-actions button.selected{background:#ececf1;color:#202123}
#composer-profile{min-height:26px;margin:0;padding:3px 22px 3px 7px;border-color:#dedee3;font-size:10px}
#composer-input{min-height:52px;max-height:none;padding:7px 4px;overflow-y:hidden;border:0;border-radius:0;resize:none;box-shadow:none;font-size:13px}#composer-input:focus{border:0;outline:0}
#composer-submit{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:50%;background:#202123;font-size:16px}
.analysis-consultation{max-width:860px;margin:8px auto 120px}
.consultation-thread{display:grid;gap:16px;margin:8px 0 30px}.consultation-message{max-width:760px;margin:0;white-space:pre-wrap;font-size:14px;line-height:1.65}.consultation-message.user{justify-self:end;max-width:78%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:#ececef;color:#27272a}.consultation-message.assistant{justify-self:start;color:#343541}
.consultation-assistant{max-width:760px}.consultation-assistant h2{font-size:20px;letter-spacing:-.01em}.consultation-assistant>.lead{margin:8px 0 0;font-size:13px}.consultation-free{margin:15px 0 18px;padding-left:11px;border-left:2px solid #4b84b4;color:#5f6672;font-size:12px;line-height:1.6}.consultation-free strong{color:#234e70}
.consultation-recommendations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.recommendation-card{display:grid;grid-template-columns:1fr auto;gap:5px 12px;min-height:128px;padding:14px;border:1px solid #dedee3;border-radius:10px;background:#fff;color:#27272a;text-align:left;box-shadow:none}.recommendation-card:hover,.recommendation-card:focus-visible{border-color:#7aa4c7;background:#f8fbfd}.recommendation-card.selected{border-color:#1f4e79;box-shadow:0 0 0 2px #1f4e7920}.recommendation-card strong{font-size:14px;font-weight:650}.recommendation-card .recommendation-chart{align-self:start;padding:2px 7px;border-radius:999px;background:#f1f1f3;color:#667085;font-size:10px;font-weight:500}.recommendation-card span:not(.recommendation-chart){grid-column:1/-1;color:#5f6672;font-size:11px;font-weight:400;line-height:1.55}.recommendation-card .recommendation-decision{color:#344054}.consultation-status{margin:14px 0 0;color:#667085;font-size:12px;line-height:1.55}
#build-studio-view .query-panel,#graph-workspace>.query-panel{display:none}
.artifact-preview-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px}.artifact-preview-heading strong{font-size:12px;font-weight:500}
#artifact-preview-host #output>.grid{grid-template-columns:1fr}#artifact-preview-host #output .panel{margin-top:10px;padding:13px;border-radius:8px;box-shadow:none}
#artifact-preview-host #output h2{font-size:13px}#artifact-preview-host .chart svg{min-width:620px}#artifact-preview-host .sql{font-size:10px;max-height:320px}
.workspace-inspector.artifact-active #inspector-empty,.workspace-inspector.artifact-active #inspector-content{display:none}
.workspace-inspector .table-scroll th,.workspace-inspector .table-scroll td{padding:6px 8px;font-size:12px;line-height:1.35;vertical-align:top}
@media(max-width:1180px){.analysis-composer{left:calc(var(--nav-column) + var(--nav-grip) + (100vw - var(--nav-column) - var(--nav-grip))/2);width:min(768px,calc(100vw - var(--nav-column) - var(--nav-grip) - 48px))}}
@media(max-width:960px){.analysis-composer{left:50%;bottom:8px;width:min(768px,calc(100vw - 24px))}.workspace{padding-bottom:140px}.workspace-inspector{padding-top:52px}}
@media(max-width:640px){.composer-target{display:none}.composer-actions{width:100%}.composer-actions button{flex:1}.analysis-composer{width:calc(100% - 16px)}.workspace{padding-left:12px;padding-right:12px}.consultation-recommendations{grid-template-columns:1fr}.consultation-message.user{max-width:92%}}
"""
HTML = HTML.replace("</style>", WORKSPACE_POLISH_CSS + "\n</style>")

WORKSPACE_POLISH_SCRIPT = r"""
function paneIcon(side,expanded){const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),frame=document.createElementNS(ns,"rect"),divider=document.createElementNS(ns,"path");svg.setAttribute("class","pane-icon");svg.setAttribute("viewBox","0 0 18 18");svg.setAttribute("aria-hidden","true");for(const[name,value]of Object.entries({x:"2.5",y:"2.5",width:"13",height:"13",rx:"2"}))frame.setAttribute(name,value);divider.setAttribute("d",side==="left"?"M7 3v12":"M11 3v12");svg.append(frame);if(expanded){const fill=document.createElementNS(ns,"rect");for(const[name,value]of Object.entries({class:"pane-fill",x:side==="left"?"2.5":"11",y:"2.5",width:"4.5",height:"13",rx:"1"}))fill.setAttribute(name,value);svg.append(fill)}svg.append(divider);return svg}
function updatePaneButton(id,side,expanded,label){const button=$(id);button.dataset.state=expanded?"open":"closed";button.replaceChildren(paneIcon(side,expanded));button.setAttribute("aria-expanded",String(expanded));button.setAttribute("aria-label",label);button.title=label}
function toggleSidebar(){const collapsed=$("app-shell").classList.toggle("sidebar-collapsed");updatePaneButton("sidebar-toggle","left",!collapsed,collapsed?"ナビゲーションを展開":"ナビゲーションを折りたたむ");if(window.innerWidth>1180)setInspectorWidth(currentInspectorWidth());resizeComposerInput()}
function toggleInspector(){const collapsed=$("app-shell").classList.toggle("inspector-collapsed");updatePaneButton("inspector-toggle","right",!collapsed,collapsed?"成果物パネルを展開":"成果物パネルを折りたたむ");resizeComposerInput()}
function showInsightArtifact(hasResult=false){const pane=$("panel-inspector");pane.classList.add("artifact-active");$("artifact-preview").className="artifact-preview";$("artifact-preview-empty").className=hasResult?"hidden":"inspector-empty";$("inspector-title").textContent="インサイト";$("inspector-subtitle").textContent="未保存の分析結果";if($("app-shell").classList.contains("inspector-collapsed"))toggleInspector()}
function hideInsightArtifact(){const pane=$("panel-inspector");pane.classList.remove("artifact-active");$("artifact-preview").className="artifact-preview hidden"}
const consultationHistory=[];let pendingConsultation=null,consultationProfile=null;
function appendConsultationMessage(role,text){const message=Object.assign(document.createElement("p"),{className:`consultation-message ${role}`,textContent:text});$("consultation-thread").append(message);message.scrollIntoView({block:"nearest"});return message}
function resetConsultation(profile){consultationHistory.splice(0);pendingInsightSpecification=null;$("consultation-thread").replaceChildren();$("consultation-recommendations").replaceChildren();consultationProfile=profile}
function rollbackPendingConsultation(){if(!pendingConsultation)return;const pending=pendingConsultation,last=consultationHistory.at(-1);if(last?.role==="user"&&last.content===pending.question)consultationHistory.pop();pending.message.remove();$("composer-input").value=pending.question;resizeComposerInput();$("consultation-status").textContent="相談を実行しませんでした。発言を編集して再送信できます。";pendingConsultation=null;$("composer-input").focus()}
function renderAnalysisRecommendations(recommendations){const host=$("consultation-recommendations");host.replaceChildren();const chartLabels={scorecard:"スコアカード",bar:"棒グラフ",line:"折れ線",table:"テーブル",sankey:"サンキー"};recommendations.forEach(recommendation=>{const card=Object.assign(document.createElement("button"),{className:"recommendation-card",type:"button"}),title=document.createElement("strong"),chart=Object.assign(document.createElement("span"),{className:"recommendation-chart"}),decision=Object.assign(document.createElement("span"),{className:"recommendation-decision"}),definition=document.createElement("span"),prompt=document.createElement("span");title.textContent=recommendation.title;chart.textContent=chartLabels[recommendation.chart]||recommendation.chart;decision.textContent=`判断: ${recommendation.objective}`;definition.textContent=`指標: ${recommendation.measures.join("、")} / 軸: ${recommendation.dimensions.join("、")||"なし"} / 比較: ${recommendation.comparison}`;prompt.textContent=`AIが定義した実行仕様: ${recommendation.execution_prompt}`;card.dataset.prompt=recommendation.execution_prompt;card.setAttribute("aria-pressed","false");card.append(title,chart,decision,definition,prompt);card.onclick=()=>selectAnalysisRecommendation(recommendation);host.append(card)})}
function handleAnalysisConsultation(event){if(event.type==="consultation_stage"){$("consultation-status").textContent=event.message;return}if(event.type==="error")throw new Error(event.message);if(event.type!=="consultation")return;appendConsultationMessage("assistant",`${event.assistant_message}\n\n${event.follow_up_question}`);consultationHistory.push({role:"assistant",content:event.history_message});renderAnalysisRecommendations(event.recommendations);$("consultation-status").textContent=`AIが${event.recommendations.length}件の分析仕様を考察しました。Vertex AI推定 ¥${event.cost_jpy}。候補を選ぶか、下から追加相談できます。`;$("composer-message").textContent="相談結果を確認してください。BigQueryはまだ実行していません。";pendingConsultation=null}
function beginAnalysisConsultation(question,profile){pendingInsightSpecification=null;hideInsightArtifact();selectWorkspace("consult");setComposerAction("consult",false);if(consultationProfile!==profile)resetConsultation(profile);$("inspector-title").textContent="分析相談";$("inspector-subtitle").textContent="BigQuery未実行";$("inspector-empty").className="inspector-empty";$("inspector-content").className="hidden";$("inspector-empty").textContent="AIが目的、指標、軸、比較、可視化を考察します。選択後にSQL生成費用を別途確認します。";const history=consultationHistory.slice(-8),message=appendConsultationMessage("user",question);consultationHistory.push({role:"user",content:question});pendingConsultation={question,profile,history,message};$("composer-input").value="";resizeComposerInput();$("consultation-status").textContent="費用確認後にVertex AIへ相談します。BigQueryは実行しません。";$("composer-message").textContent="相談費用を確認してください。";try{showCost("analysis-consult")}catch(error){rollbackPendingConsultation();$("consultation-status").textContent=error.message}}
async function runAnalysisConsultation(){const pending=pendingConsultation;if(!pending)return;const operation=startActiveRequest();$("cost-dialog").close();$("consultation-status").textContent="AIが分析目的と利用可能なデータを照合しています。";try{await stream("/api/consult",pending.question,handleAnalysisConsultation,pending.profile,{history:pending.history},operation)}catch(error){if(error.name!=="AbortError"){rollbackPendingConsultation();$("consultation-status").textContent=error.message}}finally{finishActiveRequest(operation)}}
function resizeComposerInput(){const input=$("composer-input");input.style.height="auto";input.style.height=`${input.scrollHeight}px`}
function collapseComposer(){const composer=$("analysis-composer");composer.classList.add("composer-collapsed");$("composer-launcher").setAttribute("aria-expanded","false");$("composer-input").blur()}
function collapseComposerFromControl(){collapseComposer();$("composer-launcher").focus()}
function expandComposer(focusInput=true){const composer=$("analysis-composer");composer.classList.remove("composer-collapsed");$("composer-launcher").setAttribute("aria-expanded","true");resizeComposerInput();if(focusInput)$("composer-input").focus()}
// Issue #364: completed dashboards prioritize reading; explicit controls restore chat without hover-driven layout changes.
function enterDashboardReadingMode(){hideInsightArtifact();$("analysis-composer").classList.add("dashboard-ready");if(!$("app-shell").classList.contains("inspector-collapsed"))toggleInspector();collapseComposer()}
function selectAnalysisRecommendation(recommendation){document.querySelectorAll(".recommendation-card").forEach(card=>{const selected=card.dataset.prompt===recommendation.execution_prompt;card.classList.toggle("selected",selected);card.setAttribute("aria-pressed",String(selected))});pendingInsightSpecification=recommendation;setComposerAction("insight",false);$("composer-input").value=recommendation.execution_prompt;resizeComposerInput();$("consultation-status").textContent=`「${recommendation.title}」のAI分析仕様を依頼文へ反映しました。変更した場合はAIが仕様を再検討します。`;$("composer-message").textContent="AIが考察した仕様を反映しました。まだSQL生成・BigQuery実行はしていません。";$("inspector-title").textContent=recommendation.title;$("inspector-subtitle").textContent="AI分析仕様・未実行";$("inspector-empty").textContent=`${recommendation.reason} 依頼文を確認し、費用確認後にSQLを生成します。`;$("composer-input").focus()}
function setComposerAction(action,copyInput=true){document.querySelectorAll("[data-composer-action]").forEach(button=>button.classList.toggle("selected",button.dataset.composerAction===action));$("analysis-composer").dataset.action=action;$("composer-profile").className=["consult","insight"].includes(action)?"":"hidden";const input=$("composer-input");if(copyInput)input.value=action==="consult"?"":action==="dashboard"?$("dashboard-question").value:$("question").value;resizeComposerInput();$("composer-target").textContent=action==="consult"?"対象: 分析テーマを相談":action==="dashboard"?"対象: 現在の分析スレッド":"対象: 未保存のインサイト"}
const baseSelectWorkspace=selectWorkspace;
selectWorkspace=view=>{baseSelectWorkspace(view);$("compact-title").textContent=$("page-title").textContent;if(view!=="dashboard"){$("analysis-composer").classList.remove("dashboard-ready");expandComposer(false)}};
function submitComposer(){if(activeRequest){stopActiveRequest();return}const action=$("analysis-composer").dataset.action||"dashboard",question=$("composer-input").value.trim();if(!question){$("composer-message").textContent="分析したい内容を入力してください。";return}if(action==="consult"){beginAnalysisConsultation(question,$("composer-profile").value);return}$("composer-message").textContent="費用と実行範囲を確認します。";if(action==="insight"){if(!pendingInsightSpecification||question!==pendingInsightSpecification.execution_prompt){beginAnalysisConsultation(question,$("composer-profile").value);return}selectWorkspace("graph");$("question").value=question;$("dataset-profile").value=$("composer-profile").value;selectProfile($("composer-profile").value);showInsightArtifact();showCost("graph");return}$("dashboard-question").value=question;currentAnswers={};currentPlan=null;pendingPlan=null;pendingPlanBase=null;pendingPlanInstruction=null;$("plan-revision-instruction").value="";dashboardStage();showCost("dashboard-plan")}
const originalQueryHandler=handle;handle=e=>{if(["sql","result","refusal"].includes(e.type))showInsightArtifact(true);originalQueryHandler(e)};
const originalPanelInspector=openPanelInspector;openPanelInspector=panelId=>{hideInsightArtifact();originalPanelInspector(panelId)};
$("artifact-preview-host").appendChild($("output"));
document.querySelectorAll("[data-composer-action]").forEach(button=>button.onclick=()=>setComposerAction(button.dataset.composerAction));
$("composer-profile").onchange=()=>{pendingInsightSpecification=null;const profile=$("composer-profile").value;selectProfile(profile);$("composer-input").value="";$("composer-message").textContent=profile==="bitcoin"?"Bitcoin取引について判断したい内容を入力してください。":"GA4について判断したい内容を入力してください。";resizeComposerInput()};
$("question").addEventListener("input",()=>{pendingInsightSpecification=null});
$("composer-input").addEventListener("input",resizeComposerInput);
let composerInputWidth=0;new ResizeObserver(([entry])=>{if(entry.contentRect.width===composerInputWidth)return;composerInputWidth=entry.contentRect.width;resizeComposerInput()}).observe($("composer-input"));
setInspectorWidth(currentInspectorWidth());
inspectorResizer.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();setInspectorWidth(event.key==="ArrowLeft"?currentInspectorWidth()+20:currentInspectorWidth()-20)};
window.addEventListener("resize",()=>{if(window.innerWidth>1180)setInspectorWidth(currentInspectorWidth());resizeComposerInput()});
$("composer-submit").onclick=submitComposer;$("composer-input").onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter")submitComposer()};
$("composer-launcher").onclick=()=>expandComposer();
$("composer-collapse").onclick=collapseComposerFromControl;
$("new-analysis").onclick=()=>{selectWorkspace("consult");setComposerAction("consult");$("composer-input").focus()};
$("view-dashboard").onclick=()=>{hideInsightArtifact();selectWorkspace("dashboard");setComposerAction("dashboard",false);if(latestBuildRevision)enterDashboardReadingMode()};
$("view-build").onclick=()=>{hideInsightArtifact();selectWorkspace("build");setComposerAction("dashboard",false)};
$("view-report").onclick=()=>{hideInsightArtifact();selectWorkspace("report");setComposerAction("report",false)};
$("view-graph").onclick=()=>{selectWorkspace("graph");setComposerAction("insight",false);showInsightArtifact(!$("output").classList.contains("hidden"))};
updatePaneButton("sidebar-toggle","left",!$("app-shell").classList.contains("sidebar-collapsed"),$("app-shell").classList.contains("sidebar-collapsed")?"ナビゲーションを展開":"ナビゲーションを折りたたむ");updatePaneButton("inspector-toggle","right",!$("app-shell").classList.contains("inspector-collapsed"),$("app-shell").classList.contains("inspector-collapsed")?"成果物パネルを展開":"成果物パネルを折りたたむ");
const headerMeta=document.querySelector(".app-header .header-context:last-child");headerMeta.insertBefore($("workspace-state"),headerMeta.querySelector(".draft-badge"));
selectWorkspace("build");setComposerAction("dashboard",false);
if(window.innerWidth<=1180 && $("inspector-toggle").getAttribute("aria-expanded")==="true")toggleInspector();
if(window.innerWidth<=960 && $("sidebar-toggle").getAttribute("aria-expanded")==="true")toggleSidebar();
"""
HTML = HTML.replace("</script></body>", WORKSPACE_POLISH_SCRIPT + "\n</script></body>")
HTML = HTML.replace("__INITIAL_PANEL_COUNT__", str(planner.INITIAL_PANEL_COUNT))
HTML = HTML.replace("__MAX_PANEL_COUNT__", str(planner.MAX_PANEL_COUNT))
HTML = HTML.replace("__MAX_SANKEY_PAGES__", str(MAX_SANKEY_PAGES))

class LiveDemoError(RuntimeError):
    """A local-demo failure that is safe to show in the browser."""

    def __init__(self, message: str, *, suggested_instruction: str | None = None):
        super().__init__(message)
        self.suggested_instruction = suggested_instruction


class LiveDemoCancelled(LiveDemoError):
    """A user-requested cancellation of the active local operation."""


def google_auth_recovery_message(error: Exception) -> str | None:
    """Return a bounded recovery instruction for an expired Google ADC chain."""
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        error_type = type(current)
        if (
            error_type.__module__ == "google.auth.exceptions"
            and error_type.__name__ == "RefreshError"
        ):
            return (
                "Google Cloudの認証期限が切れています。"
                "gcloud auth application-default loginを実行し、デモを再起動してください。"
                "今回の処理は自動再実行していません。"
            )
        current = current.__cause__ or current.__context__
    return None


def period_for_question(question: str) -> dict[str, str]:
    """Return the explicit month in a question, bounded by the demo dataset."""
    match = re.search(r"(?P<year>\d{4})年\s*(?P<month>\d{1,2})月", question)
    if match is None:
        raise LiveDemoError("対象月を「YYYY年M月」の形式で指定してください。")
    year, month = int(match["year"]), int(match["month"])
    try:
        first = date(year, month, 1)
    except ValueError as error:
        raise LiveDemoError("対象月を「YYYY年M月」の形式で指定してください。") from error
    last = date(year, month, calendar.monthrange(year, month)[1])
    if first < SAMPLE_FIRST_DAY or last > SAMPLE_LAST_DAY:
        raise LiveDemoError("公開サンプルで利用できる期間は2020年11月〜2021年1月です。")
    return {
        "from": first.strftime("%Y%m%d"),
        "to": last.strftime("%Y%m%d"),
        "label": f"{year}年{month}月",
    }


def planned_analysis_section(panel: dict, section_id: str | None = None) -> dict:
    """Translate one confirmed AI specification into a guarded render contract."""
    component_for_chart = {
        "scorecard": "table",
        "kpi_group": "kpi_group",
        "bar": "table",
        "grouped_bar": "grouped_bar",
        "stacked_bar": "stacked_bar",
        "line": "line",
        "multi_line": "multi_line",
        "scatter": "scatter",
        "bubble": "bubble",
        "funnel": "funnel",
        "heatmap": "heatmap",
        "table": "table",
        "sankey": "sankey",
    }
    chart = panel.get("chart")
    if chart not in component_for_chart:
        raise LiveDemoError("確定した分析仕様の可視化種別が未対応です。")
    section = {
        "id": section_id or panel["id"],
        "title": panel["title"],
        "text": panel["execution_prompt"],
        "compare": "execution",
        "component": component_for_chart[chart],
        "planned_visualization": chart,
        "verification": "execution",
        "purpose": panel.get("decision", panel.get("objective", "")),
        "max_result_rows": planner.DASHBOARD_ROW_LIMITS[chart],
        "dimension_count": len(panel["dimensions"]),
        "measure_count": len(panel["measures"]),
    }
    dimensions = panel["dimensions"]
    measures = panel["measures"]
    if chart == "scorecard":
        section["shape"] = {"rows": "1行", "columns": measures}
        section["source_columns"] = ["metric_value"]
    elif chart == "kpi_group":
        section["shape"] = {"rows": "1行", "columns": measures}
        section["source_columns"] = [
            f"metric_{index}" for index in range(1, len(measures) + 1)
        ]
    elif chart == "bar":
        section["shape"] = {"rows": "区分ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["category", "metric_value"]
    elif chart in {"grouped_bar", "stacked_bar"}:
        section["shape"] = {"rows": "区分ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = [
            "category",
            *[f"metric_{index}" for index in range(1, len(measures) + 1)],
        ]
    elif chart == "line":
        section["shape"] = {"rows": "日付ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["event_date", "metric_value"]
    elif chart == "multi_line":
        section["shape"] = {"rows": "日付ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = [
            "event_date",
            *[f"metric_{index}" for index in range(1, len(measures) + 1)],
        ]
    elif chart in {"scatter", "bubble"}:
        value_columns = ["x_value", "y_value"]
        if chart == "bubble":
            value_columns.append("size_value")
        section["shape"] = {"rows": "項目ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["category", *value_columns]
    elif chart == "funnel":
        section["shape"] = {"rows": "段階ごとに1行", "columns": dimensions + measures}
        section["source_columns"] = ["stage", "metric_value"]
        section["generation_requirements"] = [
            "stageには順序が判別できる番号接頭辞を付ける"
        ]
    elif chart == "heatmap":
        section["shape"] = {
            "rows": "2つの区分の組み合わせごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = ["x_category", "y_category", "metric_value"]
    elif chart == "table":
        section["shape"] = {
            "rows": "区分または集計単位ごとに1行",
            "columns": dimensions + measures,
        }
        section["source_columns"] = [
            *[f"dimension_{index}" for index in range(1, len(dimensions) + 1)],
            *[f"metric_{index}" for index in range(1, len(measures) + 1)],
        ]
    elif chart == "sankey":
        display_dimensions = dimensions
        if len({"".join(value.lower().split()) for value in dimensions}) == 1:
            display_dimensions = [f"遷移元{dimensions[0]}", f"遷移先{dimensions[1]}"]
        section["shape"] = {
            "rows": "隣接する段階間の遷移ごとに1行",
            "columns": display_dimensions + measures,
        }
        section["source_columns"] = ["source", "target", "metric_value"]
        section["max_navigation_pages"] = MAX_SANKEY_PAGES
        section["generation_requirements"] = [
            "最終列のASCII別名はsource、target、metric_valueにする",
            f"sourceとtargetには1.〜{MAX_SANKEY_PAGES}.のページ段階が判別できる番号接頭辞を付ける",
            f"回遊は最初の{MAX_SANKEY_PAGES}ページまでとし、{MAX_SANKEY_PAGES}ページ目より後のnodeやedgeは返さない",
            f"3〜{MAX_SANKEY_PAGES}ページの回遊もsourceとtargetの隣接edgeとして縦持ちで返す",
            "同一sourceとtargetの組はSUMして1行に集約する",
        ]
    if chart not in {"line", "multi_line", "table"}:
        nonnull_metric_columns = section["source_columns"][len(dimensions) :]
        section["nonnull_metric_columns"] = nonnull_metric_columns
        aliases = "、".join(nonnull_metric_columns)
        section.setdefault("generation_requirements", []).append(
            f"{aliases}はNULLを返さない。COUNT/COUNTIF以外の式は最終SELECT式全体を"
            "COALESCEまたはIFNULLで包む"
        )
    if chart not in {"scorecard", "kpi_group"}:
        max_rows = section["max_result_rows"]
        if chart in {"line", "multi_line"}:
            ordering = "event_dateの昇順"
        elif chart == "sankey":
            ordering = "metric_valueの降順"
        elif chart == "funnel":
            ordering = "stageの昇順"
        else:
            ordering = f"{section['source_columns'][-1]}の降順"
        section.setdefault("generation_requirements", []).append(
            f"最終SELECTは{ordering}でORDER BYし、LIMIT {max_rows}を明示する"
        )
    return section


def analysis_section_for_specification(
    question: str, analysis_specification: dict, profile: str
) -> tuple[dict, dict]:
    """Freeze one selected AI proposal before SQL generation."""
    confirmed = planner.confirm_analysis_specification(analysis_specification)
    if question.strip() != confirmed["execution_prompt"]:
        raise LiveDemoError(
            "分析依頼がAIの分析仕様から変更されています。変更内容を再度相談してください。"
        )
    period = (
        bitcoin.period_for_question(question)
        if profile == "bitcoin"
        else period_for_question(question)
    )
    return period, planned_analysis_section(confirmed, "I1")


def dashboard_sections_for_plan(question: str, plan: dict) -> tuple[dict, list[dict]]:
    """Turn AI-authored analysis specifications into guarded generation sections."""
    if "ダッシュボード" not in question:
        raise LiveDemoError("依頼に「ダッシュボード」を含めてください。")
    period = period_for_question(question)
    if plan.get("period") != period:
        raise LiveDemoError("確定した分析仕様の対象期間が依頼文と一致しません。")
    sections = [planned_analysis_section(panel) for panel in plan.get("panels", [])]
    if not 1 <= len(sections) <= planner.MAX_PANEL_COUNT:
        raise LiveDemoError(
            f"確定した分析パネルは1〜{planner.MAX_PANEL_COUNT}件にしてください。"
        )
    return period, sections


def require_sql_period(sql: str, period: dict[str, str]) -> None:
    """Fail closed when generated SQL does not use the requested date shard."""
    ranges = re.findall(
        r"_TABLE_SUFFIX\s+BETWEEN\s+['\"](\d{8})['\"]\s+AND\s+['\"](\d{8})['\"]",
        sql,
        flags=re.IGNORECASE,
    )
    expected = (period["from"], period["to"])
    if not ranges or any(found != expected for found in ranges):
        raise LiveDemoError(
            f"生成SQLの対象期間が問い合わせの{period['label']}と一致しません。"
        )


def _top_level_select_expressions(sql: str) -> tuple[list[str], str]:
    """Return the final SELECT expressions and its top-level suffix."""
    structure = re.sub(
        r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|--[^\n]*|/\*[\s\S]*?\*/",
        lambda match: " " * len(match.group(0)),
        sql,
    )
    depth = 0
    depths = []
    for char in structure:
        depths.append(depth)
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
    tokens = [
        (match.group(0).upper(), match.start(), match.end())
        for match in re.finditer(r"\b[A-Za-z_][A-Za-z0-9_]*\b", structure)
        if depths[match.start()] == 0
    ]
    selects = [token for token in tokens if token[0] == "SELECT"]
    if not selects:
        raise LiveDemoError("生成SQLの最終SELECTを解析できないためBigQueryへ送信しません。")
    select = selects[-1]
    following = [token for token in tokens if token[1] > select[2]]
    boundary = next(
        (token for token in following if token[0] in {"FROM", "UNION"}),
        ("END", len(sql), len(sql)),
    )
    clause = sql[select[2] : boundary[1]]
    expressions, start, nested = [], 0, 0
    for index, char in enumerate(structure[select[2] : boundary[1]]):
        if char == "(":
            nested += 1
        elif char == ")":
            nested = max(0, nested - 1)
        elif char == "," and nested == 0:
            expressions.append(clause[start:index].strip())
            start = index + 1
    expressions.append(clause[start:].strip())
    suffix_chars, nested = [], 0
    for char in structure[boundary[1] :]:
        if char == "(":
            nested += 1
            suffix_chars.append(" ")
        elif char == ")":
            nested = max(0, nested - 1)
            suffix_chars.append(" ")
        else:
            suffix_chars.append(char if nested == 0 else " ")
    return [expression for expression in expressions if expression], "".join(suffix_chars)


def validate_generated_dashboard_sql(section: dict, sql: str) -> None:
    """Reject SQL that cannot satisfy the confirmed renderer before BigQuery runs."""
    planned = section.get("planned_visualization")
    expected = section.get("source_columns")
    if not planned or not expected:
        return
    expressions, suffix = _top_level_select_expressions(sql)
    aliases = []
    for expression in expressions:
        match = re.search(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", expression, re.I)
        aliases.append(match.group(1).lower() if match else "")
    if (
        len(aliases) != len(expected)
        or any(not alias for alias in aliases)
        or len(set(aliases)) != len(aliases)
    ):
        observed = "、".join(alias or "別名なし" for alias in aliases)
        raise LiveDemoError(
            f"{section['title']}のSQL出力列（{observed}）は、{planned}に必要な"
            f"{len(expected)}列の一意なASCII別名を満たさないためBigQueryへ送信しません。"
        )
    nonnull_columns = section.get("nonnull_metric_columns", [])
    unsafe_columns = []
    for column in nonnull_columns:
        index = expected.index(column)
        expression = re.sub(
            r"\bAS\s+[A-Za-z_][A-Za-z0-9_]*\s*$", "", expressions[index], flags=re.I
        ).strip()
        if not re.match(
            r"^(?:(?:COUNT|COUNTIF|COALESCE|IFNULL)\s*\(|"
            r"(?:CAST|SAFE_CAST)\s*\(\s*(?:COUNT|COUNTIF)\s*\()",
            expression,
            re.I,
        ):
            unsafe_columns.append(column)
    if unsafe_columns:
        raise LiveDemoError(
            f"{section['title']}のSQL指標列（{'、'.join(unsafe_columns)}）がNULLを"
            "返し得るためBigQueryへ送信しません。COUNT/COUNTIFを使うか、"
            "最終SELECT式全体をCOALESCEまたはIFNULLで包んでください。"
        )
    max_rows = section.get("max_result_rows")
    if planned not in {"scorecard", "kpi_group"} and isinstance(max_rows, int):
        limit = re.search(r"\bLIMIT\s+([0-9]+)\b", suffix, re.I)
        if (
            not re.search(r"\bORDER\s+BY\b", suffix, re.I)
            or not limit
            or not 1 <= int(limit.group(1)) <= max_rows
        ):
            raise LiveDemoError(
                f"{section['title']}のSQLに{planned}用のORDER BYとLIMIT "
                f"{max_rows}以下がないためBigQueryへ送信しません。"
            )
    if planned in {"scorecard", "kpi_group"}:
        aggregate_pattern = re.compile(
            r"\b(?:COUNT|COUNTIF|SUM|AVG|MIN|MAX|ANY_VALUE|LOGICAL_AND|LOGICAL_OR|APPROX_[A-Z_]+)\s*\(",
            re.I,
        )
        has_aggregate = all(aggregate_pattern.search(expression) for expression in expressions)
        if (
            not has_aggregate
            or re.search(r"\bGROUP\s+BY\b", suffix, re.I)
            or any(re.search(r"\bOVER\s*\(", expression, re.I) for expression in expressions)
        ):
            raise LiveDemoError(
                f"{section['title']}のSQLが{planned}用の単一集計行になっていないため"
                "BigQueryへ送信しません。"
            )


def validate_dashboard_dry_run_schema(section: dict, schema: list[tuple[str, str]]) -> None:
    """Check BigQuery's cost-free dry-run schema against the confirmed renderer."""
    planned = section.get("planned_visualization")
    expected = section.get("source_columns")
    if not planned or not expected:
        return
    names = [name.lower() for name, _field_type in schema]
    types = [field_type.upper() for _name, field_type in schema]
    numeric = {"INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"}
    valid = len(names) == len(expected) and all(names) and len(set(names)) == len(names)
    if planned == "scorecard":
        valid = valid and types[0] in numeric
    elif planned == "kpi_group":
        valid = valid and all(field_type in numeric for field_type in types)
    elif planned == "bar":
        valid = valid and types[1] in numeric
    elif planned in {"grouped_bar", "stacked_bar"}:
        valid = valid and all(field_type in numeric for field_type in types[1:])
    elif planned == "line":
        valid = valid and types[0] in {"DATE", "DATETIME", "TIMESTAMP"} and types[1] in numeric
    elif planned == "multi_line":
        valid = (
            valid
            and types[0] in {"DATE", "DATETIME", "TIMESTAMP"}
            and all(field_type in numeric for field_type in types[1:])
        )
    elif planned in {"scatter", "bubble"}:
        valid = valid and all(field_type in numeric for field_type in types[1:])
    elif planned == "funnel":
        valid = valid and types[1] in numeric
    elif planned == "heatmap":
        valid = valid and types[2] in numeric
    elif planned == "sankey":
        valid = valid and types[:2] == ["STRING", "STRING"] and types[2] in numeric
    elif planned == "table":
        dimension_count = section.get("dimension_count", 0)
        valid = valid and all(
            field_type in numeric for field_type in types[dimension_count:]
        )
    if not valid:
        observed = "、".join(f"{name}:{field_type}" for name, field_type in schema)
        raise LiveDemoError(
            f"{section['title']}のdry run出力（{observed}）が{planned}の描画仕様と"
            "一致しないためBigQueryを実行しません。"
        )


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value if value is None or isinstance(value, (str, int, float, bool)) else str(value)


def valid_sankey_result(rows: list[tuple]) -> bool:
    """Validate bounded adjacent Sankey edges without inferring a chart type."""
    numeric = (int, float, Decimal)

    def stage(value: str) -> int | None:
        match = re.match(r"^(\d+)\.", value.strip())
        return int(match.group(1)) if match else None

    return bool(rows) and all(
        len(row) == 3
        and isinstance(row[0], str)
        and isinstance(row[1], str)
        and isinstance(row[2], numeric)
        and math.isfinite(float(row[2]))
        and row[2] >= 0
        and stage(row[0]) is not None
        and stage(row[1]) == stage(row[0]) + 1
        and stage(row[1]) <= MAX_SANKEY_PAGES
        for row in rows
    )


def dashboard_visualization(section: dict, rows: list[tuple], columns: list[str]) -> str:
    """Validate the confirmed AI chart before selecting its renderer."""
    planned = section.get("planned_visualization")
    if not planned:
        raise LiveDemoError(
            f"{section['title']}にAIが確定した描画仕様がないため実行しません。"
        )
    numeric = (int, float, Decimal)
    finite = lambda value: isinstance(value, numeric) and math.isfinite(float(value))
    nullable_finite = lambda value: value is None or finite(value)
    width = len(columns)
    valid = all(len(row) == width for row in rows)
    if planned == "scorecard":
        valid = valid and width == 1 and (not rows or len(rows) == 1 and finite(rows[0][0]))
    elif planned == "kpi_group":
        valid = valid and 2 <= width <= 4 and (
            not rows or len(rows) == 1 and all(finite(value) for value in rows[0])
        )
    elif planned == "bar":
        valid = valid and width == 2 and all(finite(row[1]) and row[1] >= 0 for row in rows)
    elif planned in {"grouped_bar", "stacked_bar"}:
        valid = valid and 3 <= width <= 5 and all(
            all(finite(value) and value >= 0 for value in row[1:]) for row in rows
        )
    elif planned == "line":
        valid = valid and width == 2 and all(
            isinstance(row[0], (date, datetime)) and nullable_finite(row[1]) for row in rows
        )
    elif planned == "multi_line":
        valid = valid and 3 <= width <= 5 and all(
            isinstance(row[0], (date, datetime))
            and all(nullable_finite(value) for value in row[1:])
            for row in rows
        )
    elif planned == "scatter":
        valid = valid and width == 3 and all(finite(row[1]) and finite(row[2]) for row in rows)
    elif planned == "bubble":
        valid = valid and width == 4 and all(
            finite(row[1]) and finite(row[2]) and finite(row[3]) and row[3] >= 0
            for row in rows
        )
    elif planned == "funnel":
        valid = valid and width == 2 and all(finite(row[1]) and row[1] >= 0 for row in rows)
    elif planned == "heatmap":
        valid = valid and width == 3 and all(finite(row[2]) for row in rows)
    elif planned == "table":
        valid = valid and width >= 1
    elif planned == "sankey":
        valid = valid and (not rows or valid_sankey_result(rows))
    else:
        valid = False
    if not valid:
        raise LiveDemoError(
            f"{section['title']}の結果形状がAI分析仕様の{planned}と一致しないため"
            "描画しません。"
        )
    return "scalar" if planned == "scorecard" else planned


class LiveQueryEngine:
    def __init__(self, project: str, model: str = report.DEFAULT_MODEL):
        from google import genai
        from google.cloud import bigquery
        self.model = model
        self.metric_definitions = json.loads(
            (HERE / "metrics.json").read_text(encoding="utf-8")
        )
        self.metrics = report.metrics_block(HERE / "metrics.json")
        self.rules = report.prompt_rules(self.metrics)
        self.bitcoin_rules = bitcoin.prompt_rules()
        self.client = genai.Client(vertexai=True, project=project, location="global")
        self.bq = bigquery.Client(project=project)
        self.lock = threading.Lock()
        self.operation_state_lock = threading.Lock()
        self.active_request_id = None
        self.active_cancel_event = None
        self.active_done_event = None
        self.latest_dashboard = None

    def _ensure_operation_state(self) -> None:
        if not hasattr(self, "operation_state_lock"):
            self.operation_state_lock = threading.Lock()
            self.active_request_id = None
            self.active_cancel_event = None
            self.active_done_event = None

    def _begin_operation(self, request_id: str | None) -> threading.Event:
        self._ensure_operation_state()
        if not self.lock.acquire(blocking=False):
            raise LiveDemoError("別の問い合わせを処理中です。完了後に再送してください。")
        cancel_event, done_event = threading.Event(), threading.Event()
        with self.operation_state_lock:
            self.active_request_id = request_id
            self.active_cancel_event = cancel_event
            self.active_done_event = done_event
        return cancel_event

    def _finish_operation(self) -> None:
        with self.operation_state_lock:
            done_event = self.active_done_event
            self.active_request_id = None
            self.active_cancel_event = None
            self.active_done_event = None
        self.lock.release()
        if done_event is not None:
            done_event.set()

    @staticmethod
    def _check_cancelled(cancel_event: threading.Event) -> None:
        if cancel_event.is_set():
            raise LiveDemoCancelled("処理を停止しました。")

    def cancel(self, request_id: str) -> bool:
        """Request cancellation and wait until the active operation releases its lock."""
        self._ensure_operation_state()
        with self.operation_state_lock:
            if request_id != self.active_request_id or self.active_cancel_event is None:
                return False
            self.active_cancel_event.set()
            done_event = self.active_done_event
        return bool(done_event and done_event.wait(timeout=180))

    def query(
        self,
        question: str,
        emit: Callable[[dict], None],
        profile: str = "ga4",
        analysis_specification: dict | None = None,
        request_id: str | None = None,
    ) -> None:
        cancel_event = self._begin_operation(request_id)
        try:
            if analysis_specification is None:
                raise LiveDemoError(
                    "AIが作成した分析仕様を選択してからbuildしてください。"
                )
            try:
                period, section = analysis_section_for_specification(
                    question, analysis_specification, profile
                )
            except (ValueError, planner.PlannerError) as error:
                raise LiveDemoError(str(error)) from error
            self._run_section(
                section, period, emit, profile=profile, cancel_event=cancel_event
            )
        finally:
            self._finish_operation()

    def consult(
        self,
        question: str,
        history: list[dict[str, str]],
        emit: Callable[[dict], None],
        profile: str = "ga4",
        request_id: str | None = None,
    ) -> None:
        """Create history-aware analysis specifications without querying BigQuery."""
        cancel_event = self._begin_operation(request_id)
        try:
            emit({"type": "consultation_stage", "message": "分析目的と利用可能なデータを照合中です。"})
            consultation, usage = planner.propose_consultation(
                self.client,
                self.model,
                question,
                history,
                analysis_consultation_context(self.metrics, profile),
                profile,
            )
            self._check_cancelled(cancel_event)
            cost = (
                usage["input_tokens"] * report.PRICING[self.model][0]
                + usage["output_tokens"] * report.PRICING[self.model][1]
            ) / 1e6 * report.USD_JPY
            emit({"type": "consultation", **consultation, "cost_jpy": round(cost, 3)})
        except planner.PlannerError as error:
            raise LiveDemoError(
                str(error),
                suggested_instruction=error.suggested_instruction,
            ) from error
        except ValueError as error:
            raise LiveDemoError(str(error)) from error
        finally:
            self._finish_operation()

    def dashboard(
        self,
        question: str,
        emit: Callable[[dict], None],
        analysis_plan: dict | None = None,
        request_id: str | None = None,
    ) -> None:
        """Build only a confirmed AI-authored dashboard plan."""
        cancel_event = self._begin_operation(request_id)
        try:
            self.latest_dashboard = None
            if analysis_plan is None:
                raise LiveDemoError(
                    "AIが作成した分析仕様を確定してからbuildしてください。"
                )
            try:
                confirmed = planner.confirm_dashboard_plan(analysis_plan)
            except planner.PlannerError as error:
                raise LiveDemoError(str(error)) from error
            period, sections = dashboard_sections_for_plan(question, confirmed)
            layout_rows = dashboard_layout_rows_for_plan(confirmed["panels"])
            emit(
                {
                    "type": "dashboard_plan",
                    "period": period["label"],
                    "plan_revision": confirmed["revision"],
                    "organization_context_revision": confirmed[
                        "organization_context_revision"
                    ],
                    "panels": [
                        {
                            "id": section["id"],
                            "title": section["title"],
                            "purpose": section["purpose"],
                            "chart": section.get("planned_visualization"),
                        }
                        for section in sections
                    ],
                    "layout_rows": layout_rows,
                }
            )
            total_cost = 0.0
            evidence_panels = []
            for index, section in enumerate(sections, start=1):
                self._check_cancelled(cancel_event)
                context = {
                    "panel_id": section["id"],
                    "panel_index": index,
                    "panel_count": len(sections),
                    "title": section["title"],
                    "purpose": section["purpose"],
                }
                evidence = {
                    "id": section["id"],
                    "title": section["title"],
                    "purpose": section["purpose"],
                    "period": period["label"],
                }

                def capture(event: dict) -> None:
                    emit(event)
                    if event.get("type") == "sql":
                        evidence["sql_sha256"] = event["sql_sha256"]
                    elif event.get("type") == "result":
                        evidence.update(
                            {
                                "columns": event["columns"],
                                "rows": event["rows"],
                                "visualization": event["visualization"],
                                "verification": event["verification"],
                            }
                        )

                total_cost += self._run_section(section, period, capture, context)
                if "rows" in evidence:
                    if evidence.get("visualization") == "funnel":
                        evidence["derived_metrics"] = meeting.funnel_conversion_metrics(
                            evidence["columns"], evidence["rows"]
                        )
                    result_canonical = json.dumps(
                        evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    )
                    evidence["result_revision"] = (
                        "result-"
                        + hashlib.sha256(result_canonical.encode()).hexdigest()[:12]
                    )
                    evidence_panels.append(evidence)
            bundle = {
                    "plan_revision": confirmed["revision"],
                    "organization_context_revision": confirmed[
                        "organization_context_revision"
                    ],
                    "organization_context": confirmed["organization_context"],
                    "analysis_specification": {
                        "revision": confirmed["revision"],
                        "objective": confirmed["objective_summary"],
                        "audience": confirmed["audience"],
                        "comparison": confirmed["comparison"],
                        "period": confirmed["period"],
                        "hypotheses": confirmed["hypotheses"],
                    },
                    "metric_definitions": self.metric_definitions,
                    "panels": evidence_panels,
            }
            canonical = json.dumps(bundle, ensure_ascii=False, sort_keys=True)
            bundle["build_revision"] = (
                "build-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
            )
            self.latest_dashboard = bundle
            emit(
                {
                    "type": "dashboard_complete",
                    "panel_count": len(sections),
                    "cost_jpy": round(total_cost, 3),
                    "build_revision": bundle["build_revision"],
                }
            )
        finally:
            self._finish_operation()

    def meeting_report(
        self,
        build_revision: str,
        emit: Callable[[dict], None],
        request_id: str | None = None,
    ) -> None:
        """Generate a cited draft from the latest completed dashboard bundle."""
        cancel_event = self._begin_operation(request_id)
        try:
            bundle = self.latest_dashboard
            if not bundle or bundle.get("build_revision") != build_revision:
                raise LiveDemoError("指定したbuild revisionの根拠bundleがありません。")
            emit({"type": "report_stage", "message": "根拠と不確実性を整理中です。"})
            draft, usage = meeting.generate(self.client, self.model, bundle)
            self._check_cancelled(cancel_event)
            cost = (
                usage["input_tokens"] * report.PRICING[self.model][0]
                + usage["output_tokens"] * report.PRICING[self.model][1]
            ) / 1e6 * report.USD_JPY
            emit({"type": "meeting_report", "report": draft, "cost_jpy": round(cost, 3)})
        except (ValueError, meeting.ReportError) as error:
            raise LiveDemoError(str(error)) from error
        finally:
            self._finish_operation()

    def plan(
        self,
        question: str,
        answers: dict[str, str],
        emit: Callable[[dict], None],
        analysis_plan: dict | None = None,
        revision_instruction: str | None = None,
        request_id: str | None = None,
    ) -> None:
        """Propose a reviewable plan without running any warehouse query."""
        cancel_event = self._begin_operation(request_id)
        try:
            period = period_for_question(question)
            current_plan = (
                planner.confirm_dashboard_plan(analysis_plan) if analysis_plan else None
            )
            emit({"type": "plan_stage", "message": "分析目的と指標定義を照合中です。"})
            plan, usage = planner.propose_dashboard(
                self.client,
                self.model,
                question,
                period,
                analysis_consultation_context(self.metrics, "ga4"),
                answers,
                current_plan=current_plan,
                instruction=revision_instruction,
            )
            self._check_cancelled(cancel_event)
            cost = (
                usage["input_tokens"] * report.PRICING[self.model][0]
                + usage["output_tokens"] * report.PRICING[self.model][1]
            ) / 1e6 * report.USD_JPY
            emit({"type": "plan", "plan": plan, "cost_jpy": round(cost, 3)})
        except planner.PlannerError as error:
            raise LiveDemoError(
                str(error),
                suggested_instruction=error.suggested_instruction,
            ) from error
        except ValueError as error:
            raise LiveDemoError(str(error)) from error
        finally:
            self._finish_operation()

    def _run_section(
        self,
        section: dict,
        period: dict[str, str],
        emit: Callable[[dict], None],
        context: dict | None = None,
        profile: str = "ga4",
        cancel_event: threading.Event | None = None,
    ) -> float:
        """Generate, validate, execute, and optionally verify one panel."""
        extra = context or {}

        def send(event: dict) -> None:
            emit({**event, **extra})

        send(
            {
                "type": "stage",
                "stage": "generate",
                "message": "Vertex AIでSQLを生成中です。",
            }
        )
        if profile == "bitcoin":
            answer, usage = report.generate_request(
                self.client,
                self.model,
                bitcoin.generation_request(section, period),
                self.bitcoin_rules,
            )
            allowed_dataset = bitcoin.DATASET
        else:
            answer, usage = report.generate(
                self.client, self.model, section, period, self.rules
            )
            allowed_dataset = report.DATASET
        cost = (
            usage["input_tokens"] * report.PRICING[self.model][0]
            + usage["output_tokens"] * report.PRICING[self.model][1]
        ) / 1e6 * report.USD_JPY
        sql = (answer.get("sql") or "").strip()
        undefined = answer.get("undefined_terms") or []
        if not sql and undefined:
            send(
                {
                    "type": "refusal",
                    "reason": answer.get("reason", ""),
                    "undefined_terms": undefined,
                    "cost_jpy": round(cost, 3),
                }
            )
            return cost
        if not sql:
            raise LiveDemoError("SQLが返りませんでした。指標定義または質問を確認してください。")
        normalized, error = report.validate_sql(sql, allowed_dataset)
        if error:
            raise LiveDemoError(f"生成SQLを安全検査で拒否しました: {error}")
        assert normalized is not None
        try:
            if profile == "bitcoin":
                normalized = bitcoin.quote_reserved_hash_identifiers(normalized)
                bitcoin.require_sql_period(normalized, period)
            else:
                require_sql_period(normalized, period)
        except ValueError as error:
            raise LiveDemoError(str(error)) from error
        if section.get("source_columns"):
            send(
                {
                    "type": "stage",
                    "stage": "validate",
                    "message": "描画仕様とBigQuery dry runの出力schemaを照合中です。",
                }
            )
            analysis_request = (
                bitcoin.generation_request(section, period)
                if profile == "bitcoin"
                else report.generation_request(section, period)
            )
            repair_used = False
            while True:
                diagnostic = ""
                try:
                    validate_generated_dashboard_sql(section, normalized)
                except LiveDemoError as validation_error:
                    diagnostic = str(validation_error)
                if not diagnostic:
                    dry_schema, dry_error = report.inspect_bq_schema(
                        self.bq, normalized, allowed_dataset=allowed_dataset
                    )
                    if dry_error:
                        if not report.repairable_dry_run_error(dry_error):
                            raise LiveDemoError(
                                f"BigQuery dry runに失敗しました: {dry_error}"
                            )
                        diagnostic = dry_error
                    else:
                        assert dry_schema is not None
                        try:
                            validate_dashboard_dry_run_schema(section, dry_schema)
                        except LiveDemoError as validation_error:
                            diagnostic = str(validation_error)
                if not diagnostic:
                    break
                if repair_used:
                    raise LiveDemoError(
                        "SQL担当AIで1回修正しましたが、実行前診断を解消できなかったため"
                        f"実行しません: {diagnostic}"
                    )
                send(
                    {
                        "type": "stage",
                        "stage": "repair",
                        "message": "実行前診断をもとにSQLを1回修正中です。",
                    }
                )
                repaired, repair_usage = report.repair(
                    self.client,
                    self.model,
                    analysis_request,
                    normalized,
                    diagnostic,
                    self.bitcoin_rules if profile == "bitcoin" else self.rules,
                )
                cost += (
                    repair_usage["input_tokens"] * report.PRICING[self.model][0]
                    + repair_usage["output_tokens"] * report.PRICING[self.model][1]
                ) / 1e6 * report.USD_JPY
                repaired_sql = (repaired.get("sql") or "").strip()
                if not repaired_sql:
                    reason = (repaired.get("reason") or "").strip()
                    detail = f" 理由: {reason}" if reason else ""
                    raise LiveDemoError(
                        "SQL担当AIが実行前診断を解消できなかったため実行しません。"
                        + detail
                    )
                normalized, validation_error = report.validate_sql(
                    repaired_sql, allowed_dataset
                )
                if validation_error:
                    raise LiveDemoError(
                        f"修正SQLを安全検査で拒否しました: {validation_error}"
                    )
                assert normalized is not None
                try:
                    if profile == "bitcoin":
                        normalized = bitcoin.quote_reserved_hash_identifiers(normalized)
                        bitcoin.require_sql_period(normalized, period)
                    else:
                        require_sql_period(normalized, period)
                except ValueError as repair_error:
                    raise LiveDemoError(str(repair_error)) from repair_error
                answer = repaired
                repair_used = True
        send(
            {
                "type": "sql",
                "sql": report.format_sql_for_display(normalized),
                "sql_sha256": hashlib.sha256(normalized.encode()).hexdigest()[:16],
                "reason": answer.get("reason", ""),
            }
        )
        send(
            {
                "type": "stage",
                "stage": "execute",
                "message": "BigQueryで読み取り実行中です。",
            }
        )
        result, error = report.exec_bq(
            self.bq,
            normalized,
            max_results=MAX_RESULT_ROWS + 1,
            allowed_dataset=allowed_dataset,
        )
        if error:
            raise LiveDemoError(f"BigQuery実行に失敗しました: {error}")
        assert result is not None
        rows, columns = result
        if len(rows) > MAX_RESULT_ROWS:
            raise LiveDemoError(
                f"結果が{MAX_RESULT_ROWS}行を超えたため描画しません。集計条件を追加してください。"
            )
        verification, label = "unverified", "実行済み・AI分析仕様と形状照合済み"
        visualization = dashboard_visualization(section, rows, columns)
        send(
            {
                "type": "result",
                "columns": section.get("shape", {}).get("columns", columns),
                "source_columns": columns,
                "rows": [[json_value(value) for value in row] for row in rows],
                "visualization": visualization,
                "navigation_depth": section.get("navigation_depth"),
                "verification": verification,
                "verification_label": label,
                "cost_jpy": round(cost, 3),
            }
        )
        return cost
class LiveDemoHandler(BaseHTTPRequestHandler):
    engine: LiveQueryEngine
    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, HTML.encode(), "text/html; charset=utf-8")
        else:
            self._send(204 if self.path == "/favicon.ico" else 404, b"", "text/plain")
    def do_POST(self) -> None:
        if self.path not in {
            "/api/query",
            "/api/dashboard",
            "/api/plan",
            "/api/report",
            "/api/consult",
            "/api/cancel",
        }:
            self._send_json(404, {"error": "not found"})
            return
        content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        origin = self.headers.get("origin")
        allowed = {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }
        if content_type != "application/json":
            self._send_json(415, {"error": "content-type must be application/json"})
            return
        if origin is not None and origin not in allowed:
            self._send_json(403, {"error": "cross-origin requests are not allowed"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            max_body_bytes = (
                MAX_PLAN_BODY_BYTES
                if self.path in {"/api/dashboard", "/api/plan"}
                else MAX_BODY_BYTES
            )
            if length <= 0 or length > max_body_bytes:
                raise ValueError("request body is empty or too large")
            body = json.loads(self.rfile.read(length))
            request_id = body.get("request_id") if isinstance(body, dict) else None
            if request_id is not None and (
                not isinstance(request_id, str)
                or not re.fullmatch(r"request-[0-9]{10,16}-[0-9a-f]{4,32}", request_id)
            ):
                raise ValueError("request_id is invalid")
            if self.path == "/api/cancel":
                if request_id is None:
                    raise ValueError("request_id is required")
                self._send_json(200, {"cancelled": self.engine.cancel(request_id)})
                return
            question = body.get("question") if isinstance(body, dict) else None
            profile = body.get("profile", "ga4") if isinstance(body, dict) else None
            answers = body.get("answers", {}) if isinstance(body, dict) else None
            analysis_plan = body.get("analysis_plan") if isinstance(body, dict) else None
            analysis_specification = (
                body.get("analysis_specification") if isinstance(body, dict) else None
            )
            revision_instruction = (
                body.get("revision_instruction") if isinstance(body, dict) else None
            )
            build_revision = body.get("build_revision") if isinstance(body, dict) else None
            history = body.get("history", []) if isinstance(body, dict) else None
            if not isinstance(question, str):
                raise ValueError("question must be a string")
            if profile not in {"ga4", "bitcoin"}:
                raise ValueError("profile must be ga4 or bitcoin")
            if analysis_plan is not None and not isinstance(analysis_plan, dict):
                raise ValueError("analysis_plan must be an object")
            if analysis_specification is not None and not isinstance(
                analysis_specification, dict
            ):
                raise ValueError("analysis_specification must be an object")
            if revision_instruction is not None and (
                not isinstance(revision_instruction, str)
                or not revision_instruction.strip()
                or len(revision_instruction) > 500
            ):
                raise ValueError("revision_instruction must be short text")
            if not isinstance(answers, dict) or any(
                key not in {"audience", "comparison", "business_goal"}
                or not isinstance(value, str)
                or not value.strip()
                or len(value) > 200
                for key, value in answers.items()
            ):
                raise ValueError("answers must contain only short supported text fields")
            if self.path == "/api/consult":
                if not isinstance(history, list) or len(history) > 8:
                    raise ValueError("history must contain at most 8 turns")
                total_history_chars = 0
                for index, turn in enumerate(history):
                    expected_role = "user" if index % 2 == 0 else "assistant"
                    if (
                        not isinstance(turn, dict)
                        or set(turn) != {"role", "content"}
                        or turn.get("role") != expected_role
                        or not isinstance(turn.get("content"), str)
                        or not turn["content"].strip()
                        or len(turn["content"]) > 800
                    ):
                        raise ValueError("history contains an invalid turn")
                    total_history_chars += len(turn["content"])
                if total_history_chars > 3000:
                    raise ValueError("history is too large")
                if not question.strip() or len(question) > MAX_QUESTION_CHARS:
                    raise ValueError("consultation question is invalid")
            elif self.path == "/api/report":
                if not isinstance(build_revision, str) or not re.fullmatch(
                    r"build-[0-9a-f]{12}", build_revision
                ):
                    raise ValueError("build_revision is invalid")
            elif self.path == "/api/plan":
                if profile != "ga4":
                    raise ValueError("planning mode currently supports only ga4")
                if (analysis_plan is None) != (revision_instruction is None):
                    raise ValueError(
                        "analysis_plan and revision_instruction must be provided together"
                    )
                period_for_question(question)
                if analysis_plan is not None:
                    planner.confirm_dashboard_plan(analysis_plan)
            elif self.path == "/api/dashboard":
                if profile != "ga4":
                    raise ValueError("dashboard mode currently supports only ga4")
                if analysis_plan is None:
                    raise ValueError(
                        "AIが作成した分析仕様を確定してからbuildしてください。"
                    )
                confirmed = planner.confirm_dashboard_plan(analysis_plan)
                dashboard_sections_for_plan(question, confirmed)
            elif analysis_specification is None:
                raise ValueError(
                    "AIが作成した分析仕様を選択してからbuildしてください。"
                )
            else:
                confirmed = planner.confirm_analysis_specification(
                    analysis_specification
                )
                analysis_section_for_specification(question, confirmed, profile)
                analysis_specification = confirmed
        except (ValueError, json.JSONDecodeError, LiveDemoError, planner.PlannerError) as error:
            self._send_json(400, {"error": str(error)})
            return
        self.send_response(200)
        self._headers("application/x-ndjson; charset=utf-8")
        self.end_headers()
        def emit(event: dict) -> None:
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()
        try:
            request_kwargs = {"request_id": request_id} if request_id else {}
            if self.path == "/api/consult":
                self.engine.consult(
                    question, history, emit, profile=profile, **request_kwargs
                )
            elif self.path == "/api/report":
                self.engine.meeting_report(
                    build_revision, emit, **request_kwargs
                )
            elif self.path == "/api/plan":
                self.engine.plan(
                    question,
                    answers,
                    emit,
                    analysis_plan=analysis_plan,
                    revision_instruction=revision_instruction,
                    **request_kwargs,
                )
            elif self.path == "/api/dashboard":
                self.engine.dashboard(question, emit, analysis_plan, **request_kwargs)
            elif profile == "bitcoin":
                self.engine.query(
                    question,
                    emit,
                    profile="bitcoin",
                    analysis_specification=analysis_specification,
                    **request_kwargs,
                )
            else:
                if analysis_specification is not None:
                    request_kwargs["analysis_specification"] = analysis_specification
                self.engine.query(question, emit, **request_kwargs)
        except LiveDemoError as error:
            try:
                event = {"type": "error", "message": str(error)}
                if error.suggested_instruction:
                    event["suggested_instruction"] = error.suggested_instruction
                emit(event)
            except (BrokenPipeError, ConnectionResetError):
                return
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:  # noqa: BLE001 — details stay server-side
            recovery_message = google_auth_recovery_message(error)
            if recovery_message:
                print("live query failed: Google authentication expired", flush=True)
                emit({"type": "error", "message": recovery_message})
                return
            print(f"live query failed: {type(error).__name__}", flush=True)
            emit({"type": "error", "message": "生成または実行に失敗しました。端末ログを確認してください。"})
    def _headers(self, content_type: str) -> None:
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
            "connect-src 'self'; img-src 'self' data:",
        )
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self._headers(content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def _send_json(self, status: int, body: dict) -> None:
        self._send(
            status,
            json.dumps(body, ensure_ascii=False).encode(),
            "application/json; charset=utf-8",
        )
    def log_message(self, format: str, *args) -> None:
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else '-'}", flush=True)
def create_server(host: str, port: int, engine) -> ThreadingHTTPServer:
    handler = type("ConfiguredLiveDemoHandler", (LiveDemoHandler,), {"engine": engine})
    return ThreadingHTTPServer((host, port), handler)
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project")
    parser.add_argument("--accept-cost", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    project = (args.project or "").strip()
    if not project:
        parser.error("--project is required")
    if args.host not in {"127.0.0.1", "localhost"}:
        parser.error("--host must remain localhost-only")
    url = f"http://{args.host}:{args.port}/"
    if args.dry_run:
        print(f"project: {project}")
        print("live mode: enter a Japanese prompt, then stream a graph or dashboard")
        print("- create isolated Python venv and install pinned dependencies")
        print("- start a localhost-only prompt server")
        print("- call Vertex AI and BigQuery after each submitted prompt")
        print(f"- open {url}")
        return 0
    print("Each submitted prompt calls real Vertex AI and BigQuery (capped at 20 GiB).")
    if not args.accept_cost:
        if not sys.stdin.isatty():
            print("error: paid run not confirmed; pass --accept-cost", file=sys.stderr)
            return 2
        if input("Continue with the paid live demo? [y/N] ").strip().lower() not in {"y", "yes"}:
            print("error: paid run cancelled", file=sys.stderr)
            return 2
    try:
        if sys.version_info < (3, 13) or shutil.which("gcloud") is None:
            raise DemoError("Python 3.13 or newer and gcloud are required")
        require_adc()
        python = prepare_python()
        if not running_in_demo_venv():
            command = [str(python), str(Path(__file__).resolve()), "--project", project,
                       "--host", args.host, "--port", str(args.port), "--accept-cost"]
            if args.no_open:
                command.append("--no-open")
            run(command)
            return 0
    except DemoError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    server = create_server(args.host, args.port, LiveQueryEngine(project))
    url = f"http://{args.host}:{server.server_port}/"
    print(f"live demo: {url}\nPress Ctrl-C to stop.", flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nlive demo stopped")
    finally:
        server.server_close()
    return 0
if __name__ == "__main__":
    raise SystemExit(main())

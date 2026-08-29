#!/usr/bin/env python3
"""Serve a localhost-only Japanese prompt → graph or dashboard demonstration."""

from __future__ import annotations
import argparse
import json
import re
import shutil
import sys
import webbrowser
from pathlib import Path
import analysis_planner as planner
import bitcoin_profile as bitcoin
from live_contracts import (
    SAMPLE_FIRST_DAY,
    SAMPLE_LAST_DAY,
    LiveDemoCancelled,
    LiveDemoError,
    _top_level_select_expressions,
    analysis_consultation_context,
    analysis_section_for_specification,
    dashboard_layout_rows_for_plan,
    dashboard_sections_for_plan,
    dashboard_visualization,
    google_auth_recovery_message,
    json_value,
    period_for_question,
    planned_analysis_section,
    require_sql_period,
    sql_period_diagnostic,
    valid_flow_sankey_result,
    valid_geojson_geometry,
    valid_geojson_map,
    valid_sankey_result,
    validate_dashboard_dry_run_schema,
    validate_generated_dashboard_sql,
)
import live_engine
import live_http
from live_ui_base import BASE_HTML
import meeting_report as meeting
import run_report as report
from demo_support import DemoError, VENV_DIR, prepare_python, require_adc, run
HERE = Path(__file__).resolve().parent
ECHARTS_ASSET = HERE / "assets" / "echarts.min.js"
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_PLAN_BODY_BYTES, MAX_RESULT_ROWS = 4096, 98304, 100
MAX_QUESTION_CHARS = 500
MAX_DASHBOARD_BODY_BYTES = MAX_PLAN_BODY_BYTES
MAX_SANKEY_PAGES = planner.MAX_SANKEY_PAGES
MAX_SANKEY_PATHS = planner.MAX_SANKEY_PATHS
MAX_SANKEY_EDGE_ROWS = planner.MAX_SANKEY_EDGE_ROWS
METRIC_UNITS = {
    name: spec["unit"]
    for name, spec in json.loads(
        (HERE / "metrics.json").read_text(encoding="utf-8")
    )["metrics"].items()
    if spec.get("unit")
}
def running_in_demo_venv() -> bool:
    """Return whether this process is using the demo virtual environment."""
    return Path(sys.prefix).resolve() == VENV_DIR.resolve()
HTML = BASE_HTML

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
<div class="composer-footer"><span id="composer-message">操作と対象を確認して送信してください。</span><button id="composer-submit" type="button" aria-label="分析指示を送信"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 12V4M8 4L4.75 7.25M8 4L11.25 7.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
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
.dashboard-layout-row>.dashboard-card .chart{display:flex;flex:1;min-height:0;overflow:hidden}
.dashboard-layout-row>.dashboard-card .echart-root{flex:1 1 auto;height:100%!important;min-height:300px}
@container (max-width:900px){.dashboard-layout-row>.dashboard-card .chart{overflow:visible}.dashboard-layout-row>.dashboard-card .echart-root{height:auto!important;min-height:260px}}
.dashboard-card h3{font-size:15px;line-height:1.45;letter-spacing:-.01em}
.dashboard-card .purpose{min-height:0;margin:9px 0 16px;color:#687386;font-size:11px}
.panel-state{display:inline-flex;align-items:center;min-height:23px;padding:3px 7px;border-radius:999px;background:var(--color-success-soft);color:var(--color-success);font-size:10px;white-space:nowrap}
.dashboard-card .chart{min-width:0;display:grid;align-items:start;overflow:visible;flex:1}
.chart .echart-root{display:block;width:100%;min-width:0;max-width:100%;height:auto}
.dashboard-card .chart .echart-root{width:100%;min-width:0;max-width:100%}
.dashboard-card .chart svg{display:block;min-width:0;width:100%;max-width:100%}
.chart-table-scroll{align-self:start;width:100%;max-height:360px;overflow:auto}
.chart-table-scroll table{width:max-content;min-width:100%;margin-top:0}
.chart-table-scroll th,.chart-table-scroll td{max-width:320px;overflow-wrap:anywhere;vertical-align:top}
.advanced-table{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;gap:8px}
.advanced-table-toolbar{display:flex;align-items:center;gap:7px;min-width:0}
.advanced-table-search{min-width:120px;max-width:240px;padding:6px 9px}
.advanced-table-summary{margin-right:auto;color:#687386;font-size:10px;white-space:nowrap}
.advanced-table-toolbar button,.advanced-table-pager button{width:auto;padding:5px 9px;font-size:10px}
.advanced-table-scroll{flex:1;max-height:420px;border:1px solid #e5e9ee;border-radius:7px}
.advanced-table-scroll thead{position:sticky;z-index:2;top:0;background:#f7f9fb}
.advanced-table-scroll th:first-child,.advanced-table-scroll td:first-child{position:sticky;z-index:1;left:0;background:inherit}
.advanced-table-scroll tbody tr:nth-child(even){background:#fafbfd}
.advanced-table-scroll th button{width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit}
.advanced-table-scroll th[aria-sort="ascending"] button::after{content:"  ↑"}
.advanced-table-scroll th[aria-sort="descending"] button::after{content:"  ↓"}
.advanced-table-number{background:linear-gradient(90deg,#dbeafe var(--table-bar-width),transparent var(--table-bar-width));font-variant-numeric:tabular-nums;text-align:right}
.advanced-table-delta{color:#315f86;font-weight:700}
.advanced-table-sparkline{width:128px;height:36px}
.advanced-table-pager{display:flex;align-items:center;justify-content:flex-end;gap:9px;color:#687386;font-size:10px}
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
#composer-submit{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:50%;background:#202123;line-height:0}#composer-submit svg{display:block;width:16px;height:16px}
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
function renderAnalysisRecommendations(recommendations){const host=$("consultation-recommendations");host.replaceChildren();const chartLabels={scorecard:"スコアカード",kpi_group:"KPIグループ",bar:"棒グラフ",grouped_bar:"グループ棒",stacked_bar:"積み上げ棒",line:"折れ線",multi_line:"複数軸折れ線",area:"面グラフ",stacked_area:"積み上げ面",histogram:"ヒストグラム",donut:"ドーナツ",calendar_heatmap:"カレンダーヒートマップ",scatter:"散布図",bubble:"バブル",funnel:"ファネル",heatmap:"ヒートマップ",table:"テーブル",sankey:"サンキー"};recommendations.forEach(recommendation=>{const card=Object.assign(document.createElement("button"),{className:"recommendation-card",type:"button"}),title=document.createElement("strong"),chart=Object.assign(document.createElement("span"),{className:"recommendation-chart"}),decision=Object.assign(document.createElement("span"),{className:"recommendation-decision"}),definition=document.createElement("span"),prompt=document.createElement("span");title.textContent=recommendation.title;chart.textContent=chartLabels[recommendation.chart]||recommendation.chart;decision.textContent=`判断: ${recommendation.objective}`;definition.textContent=`指標: ${recommendation.measures.join("、")} / 軸: ${recommendation.dimensions.join("、")||"なし"} / 比較: ${recommendation.comparison}`;prompt.textContent=`AIが定義した実行仕様: ${recommendation.execution_prompt}`;card.dataset.prompt=recommendation.execution_prompt;card.setAttribute("aria-pressed","false");card.append(title,chart,decision,definition,prompt);card.onclick=()=>selectAnalysisRecommendation(recommendation);host.append(card)})}
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
CHART_RENDERER = (HERE / "chart_renderer.js").read_text(encoding="utf-8")
CLARIFICATION_MARKUP = r"""
<section id="clarification-panel" class="panel hidden" aria-labelledby="clarification-title"><h2 id="clarification-title">追加の定義が必要です</h2><p id="clarification-terms" class="notice warning"></p><p id="clarification-question" class="lead"></p><label for="clarification-answer">対象条件を回答してください</label><textarea id="clarification-answer" rows="3" maxlength="800" placeholder="例: 対象URLは /signup と /register、イベント名は sign_up です"></textarea><div class="actions"><button id="clarification-submit" type="button">回答して再生成</button><span class="cost">回答内容だけを条件に使い、回答にない条件は推測しない。BigQueryはSQL確定後にのみ実行します。</span></div></section>
"""
HTML = HTML.replace(
    '<section id="output" class="hidden">',
    CLARIFICATION_MARKUP + '<section id="output" class="hidden">',
    1,
)
FOLLOWUP_SCRIPT = r"""
let clarificationRequest = null;
const originalQueryHandle = handle;
handle = function followupAwareHandle(event) {
  if (event.type === "refusal") {
    clarificationRequest = event;
    $("clarification-terms").textContent = `未定義: ${event.undefined_terms.join("、")}`;
    $("clarification-question").textContent = event.clarification_question ||
      "対象URL、ページ一覧、イベント名、または指標の計算定義を具体的に指定してください。";
    $("clarification-answer").value = "";
    $("clarification-panel").className = "panel";
  }
  originalQueryHandle(event);
};
async function runClarifiedQuery() {
  if (!clarificationRequest) return;
  const answer = $("clarification-answer").value.trim();
  if (!answer) {
    $("message").className = "notice error";
    $("message").textContent = "確認質問への回答を入力してください。";
    return;
  }
  let operation;
  try {
    operation = startActiveRequest();
  } catch (error) {
    $("message").className = "notice error";
    $("message").textContent = error.message;
    return;
  }
  $("clarification-submit").disabled = true;
  $("clarification-panel").className = "panel hidden";
  $("run-status").textContent = "再確認中";
  $("message").className = "notice";
  $("message").textContent = "回答を反映してVertex AIへ再確認しています。";
  $("output").className = "hidden";
  clearResult();
  stage("generate");
  try {
    await stream(
      "/api/query",
      $("question").value.trim(),
      handle,
      $("dataset-profile").value,
      {analysis_specification: pendingInsightSpecification, clarification_answer: answer},
      operation,
    );
    clarificationRequest = null;
  } catch (error) {
    if (error.name !== "AbortError") {
      $("message").className = "notice error";
      $("message").textContent = error.message;
      finish("エラー");
    }
  } finally {
    $("clarification-submit").disabled = false;
    finishActiveRequest(operation);
  }
}
$("clarification-submit").onclick = runClarifiedQuery;
"""
HTML = HTML.replace(
    "</script></body>",
    CHART_RENDERER + "\n" + WORKSPACE_POLISH_SCRIPT + "\n" + FOLLOWUP_SCRIPT + "\n</script></body>",
)
HTML = HTML.replace(
    "<script>\nconst $=",
    '<script src="/assets/echarts.min.js"></script><script>\nconst $=',
    1,
)
HTML = HTML.replace("__INITIAL_PANEL_COUNT__", str(planner.INITIAL_PANEL_COUNT))
HTML = HTML.replace("__MAX_PANEL_COUNT__", str(planner.MAX_PANEL_COUNT))
HTML = HTML.replace("__MAX_SANKEY_PAGES__", str(MAX_SANKEY_PAGES))
HTML = HTML.replace("__MAX_SANKEY_PATHS__", str(MAX_SANKEY_PATHS))
HTML = HTML.replace("__MAX_SANKEY_EDGE_ROWS__", str(MAX_SANKEY_EDGE_ROWS))
HTML = HTML.replace("__METRIC_UNITS__", json.dumps(METRIC_UNITS, ensure_ascii=False))

class LiveQueryEngine(live_engine.LiveQueryEngine):
    """Bind the reusable engine lifecycle to the live demo's public contracts."""

    here = HERE
    max_result_rows = MAX_RESULT_ROWS
    error_type = LiveDemoError
    cancelled_error_type = LiveDemoCancelled

    @staticmethod
    def resolve_analysis_section(
        question: str, specification: dict, profile: str
    ) -> tuple[dict, dict]:
        return analysis_section_for_specification(question, specification, profile)

    @staticmethod
    def consultation_context(metrics: str, profile: str) -> str:
        return analysis_consultation_context(metrics, profile)

    @staticmethod
    def sections_for_plan(question: str, plan: dict) -> tuple[dict, list[dict]]:
        return dashboard_sections_for_plan(question, plan)

    @staticmethod
    def layout_rows_for_plan(panels: list[dict]) -> list[dict]:
        return dashboard_layout_rows_for_plan(panels)

    @staticmethod
    def period_for_question(question: str) -> dict[str, str]:
        return period_for_question(question)


LiveDemoHandler = live_http.LiveHTTPHandler


def create_server(host: str, port: int, engine):
    """Configure the HTTP boundary with the live demo's current public helpers."""
    handler = type(
        "ConfiguredLiveDemoHandler",
        (LiveDemoHandler,),
        {
            "engine": engine,
            "html": HTML,
            "echarts_asset": ECHARTS_ASSET,
            "max_body_bytes": MAX_BODY_BYTES,
            "max_plan_body_bytes": MAX_PLAN_BODY_BYTES,
            "max_question_chars": MAX_QUESTION_CHARS,
            "planner": planner,
            "live_error_type": LiveDemoError,
            "period_for_question": staticmethod(period_for_question),
            "dashboard_sections_for_plan": staticmethod(dashboard_sections_for_plan),
            "analysis_section_for_specification": staticmethod(
                analysis_section_for_specification
            ),
            "auth_recovery_message": staticmethod(google_auth_recovery_message),
        },
    )
    return live_http.create_server(host, port, handler)
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

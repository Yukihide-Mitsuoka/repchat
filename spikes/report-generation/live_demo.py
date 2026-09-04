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
from live_ui_interactions import (
    CLARIFICATION_MARKUP,
    FOLLOWUP_SCRIPT,
    WORKSPACE_POLISH_SCRIPT,
)
from live_ui_shell import WORKSPACE_POLISH_CSS
import meeting_report as meeting
import run_report as report
from demo_support import DemoError, VENV_DIR, prepare_python, require_adc, run
HERE = Path(__file__).resolve().parent
ECHARTS_ASSET = HERE / "assets" / "echarts.min.js"
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_PLAN_BODY_BYTES, MAX_RESULT_ROWS = 4096, 98304, 100
MAX_REJECTED_BODY_BYTES = MAX_PLAN_BODY_BYTES * 2
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
HTML = HTML.replace("</style>", WORKSPACE_POLISH_CSS + "\n</style>")

CHART_RENDERER_FILES = (
    "chart_renderer_core.js",
    "chart_renderer_cartesian.js",
    "chart_renderer_indicators.js",
    "chart_renderer_composition.js",
    "chart_renderer_maps.js",
    "chart_renderer_dispatch.js",
    "chart_renderer_tables.js",
)
CHART_RENDERER = "".join((HERE / filename).read_text(encoding="utf-8") for filename in CHART_RENDERER_FILES)
HTML = HTML.replace(
    '<section id="output" class="hidden">',
    CLARIFICATION_MARKUP + '<section id="output" class="hidden">',
    1,
)
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
            "max_rejected_body_bytes": MAX_REJECTED_BODY_BYTES,
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

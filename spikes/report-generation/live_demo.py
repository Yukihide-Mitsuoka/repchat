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
from live_ui_shell import WORKSPACE_POLISH_CSS
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

#!/usr/bin/env python3
"""Serve a localhost-only Japanese prompt → graph or dashboard demonstration."""

from __future__ import annotations
import argparse
import calendar
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
import run_report as report
from demo import DemoError, VENV_DIR, prepare_python, require_adc, run
HERE = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_RESULT_ROWS = 4096, 100
SAMPLE_FIRST_DAY = date(2020, 11, 1)
SAMPLE_LAST_DAY = date(2021, 1, 31)
DASHBOARD_SECTION_IDS = report.SHOWCASE_IDS
DASHBOARD_PURPOSES = {
    "R4": "購入成果の規模を最初に確認する",
    "R11": "単発訪問だけでなく、ユーザーが定着しているかを確認する",
    "R12": "訪問中に十分な関与が生まれているかを確認する",
    "R9": "閲覧から購入までのどこで減少しているかを特定する",
    "R16": "日々の変動と7日間の基調を分けて確認する",
    "R17": "主要なページ遷移から回遊上の特徴を確認する",
}


def running_in_demo_venv() -> bool:
    """Return whether this process is using the demo virtual environment."""
    return Path(sys.prefix).resolve() == VENV_DIR.resolve()

HTML = r"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>RepChat | ライブ分析デモ</title><style>
:root{--color-primary:#1f4e79;--color-primary-hover:#173d61;--color-border:#d9dee7;--color-muted:#667085;--color-text:#101828;--color-surface:#fff;--color-subtle:#f7f8fa;font-family:Inter,"Noto Sans JP",system-ui,sans-serif;color:var(--color-text);background:#f5f6f8}*{box-sizing:border-box}body{margin:0}.app-header{height:52px;background:#fff;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:16px;padding:0 max(24px,calc((100vw - 1180px)/2));color:var(--color-muted);font-size:13px}.brand{color:var(--color-primary);font-size:16px;font-weight:750;letter-spacing:.01em}.workspace{max-width:1180px;margin:auto;padding:32px 24px 72px}.eyebrow{color:var(--color-primary);font-size:12px;font-weight:700;letter-spacing:.1em;margin:0 0 8px;text-transform:uppercase}h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:17px;margin:0}.lead{color:var(--color-muted);line-height:1.65}.panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;padding:20px;margin-top:16px}.query-panel{border-top:3px solid var(--color-primary)}
label{font-size:14px;font-weight:700;display:block;margin-bottom:9px}select{border:1px solid #98a2b3;border-radius:4px;background:#fff;padding:9px 12px;font:inherit;margin-bottom:14px}textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #98a2b3;border-radius:4px;padding:13px 14px;font:inherit;line-height:1.6;background:#fff}textarea:focus,select:focus{border-color:var(--color-primary);outline:3px solid #1f4e791a}button{border:1px solid var(--color-primary);border-radius:4px;padding:10px 16px;font-weight:700;cursor:pointer;background:var(--color-primary);color:#fff}button:hover{background:var(--color-primary-hover)}button:disabled{cursor:wait;opacity:.55}.secondary{background:#fff;color:var(--color-primary)}.secondary:hover,.examples button:hover{background:#eef4f9}
.actions,.examples{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.examples button{background:#fff;color:#344054;border-color:var(--color-border);padding:6px 9px;font-size:12px}.cost{color:#8a4b08;font-size:12px}.progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.status-pill{padding:4px 9px;border:1px solid var(--color-border);border-radius:999px;background:var(--color-subtle);color:var(--color-muted);font-size:12px;font-weight:700}.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:0;list-style:none;margin:16px 0;padding:0;border:1px solid var(--color-border);border-radius:4px;overflow:hidden}.stages li{min-height:64px;padding:10px 12px;border-right:1px solid var(--color-border);background:#fff;color:var(--color-muted)}.stages li:last-child{border-right:0}.stages strong,.stages span{display:block}.stages strong{font-size:13px}.stages span{font-size:11px;margin-top:5px}.stages .active{box-shadow:inset 0 -3px #d39b2a;background:#fffbeb;color:#694100}.stages .done{box-shadow:inset 0 -3px #2f855a;background:#f3faf6;color:#166534}#plan-review h3{font-size:14px;margin:20px 0 10px}.clarification{border-left:3px solid #d39b2a;background:#fffbeb;padding:12px;margin:10px 0}.clarification input,.plan-item input{width:100%;margin-top:8px;padding:9px;border:1px solid #98a2b3}.plan-choice{display:grid;grid-template-columns:auto 1fr;gap:10px;border-bottom:1px solid var(--color-border);padding:12px 0}.plan-choice input{margin-top:4px}.plan-choice label{margin:0}.plan-choice small{display:block;color:var(--color-muted);font-weight:400;line-height:1.5;margin-top:4px}
.hidden{display:none}.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.mode-switch{display:flex;gap:0;margin:22px 0 4px;border-bottom:1px solid var(--color-border)}.mode-switch button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;color:var(--color-muted);padding:10px 16px}.mode-switch button:hover{background:var(--color-subtle)}.mode-switch .selected{border-bottom-color:var(--color-primary);color:var(--color-primary)}.result-tabs{display:flex;gap:0;margin:14px 0;border-bottom:1px solid var(--color-border)}.result-tab{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;color:var(--color-muted);padding:9px 14px}.result-tab:hover{background:var(--color-subtle)}.result-tab.selected{border-bottom-color:var(--color-primary);color:var(--color-primary)}.table-scroll{max-height:520px;overflow:auto}.sql{white-space:pre;overflow:auto;background:#f6f8fa;color:#24292f;border:1px solid #d0d7de;padding:16px;border-radius:4px;max-height:430px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;tab-size:4}.sql-keyword{color:#cf222e}.sql-string,.sql-identifier{color:#0a3069}.sql-number{color:#0550ae}.sql-comment{color:#6e7781}.sql-function{color:#8250df}.notice{padding:10px 12px;border-left:3px solid #4b84b4;background:#eef4f9;color:#234e70;line-height:1.5}.warning{border-left-color:#d39b2a;background:#fffbeb;color:#854d0e}.error{border-left-color:#c24141;background:#fff1f1;color:#991b1b}.metric{font-size:46px;font-weight:750;padding:26px 8px}.chart{overflow-x:auto}.chart svg{min-width:760px;width:100%;height:auto}.chart text{font-size:11px;fill:#475467}.chart-caption{margin:8px 0 0;color:var(--color-muted);font-size:12px}.dashboard-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.dashboard-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:16px}.dashboard-card{grid-column:span 4;background:#fff;border:1px solid var(--color-border);border-radius:6px;padding:18px;min-width:0}.dashboard-card.wide{grid-column:span 6}.dashboard-card.full{grid-column:1/-1}.dashboard-card h3{font-size:16px;margin:0}.dashboard-card .purpose{color:var(--color-muted);font-size:12px;line-height:1.55;min-height:38px}.dashboard-card .chart svg{min-width:0}.dashboard-card.wide .chart svg,.dashboard-card.full .chart svg{min-width:680px}.panel-state{font-size:11px;font-weight:700;color:var(--color-muted)}.kpi-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kpi-pair div{background:var(--color-subtle);padding:15px}.kpi-pair strong{display:block;font-size:26px}.kpi-pair span{font-size:11px;color:var(--color-muted)}.funnel{display:grid;gap:8px;padding:10px 0}.funnel-step{background:#dbeafe;border-left:4px solid var(--color-primary);padding:10px 12px}.funnel-step strong{float:right}.dashboard-card details{border-top:1px solid var(--color-border);margin-top:14px;padding-top:12px}.dashboard-card summary{cursor:pointer;color:var(--color-primary);font-size:12px;font-weight:700}.dashboard-card details p{font-size:12px;line-height:1.55}.dashboard-card details .sql{max-height:300px;font-size:11px}.dashboard-card table{margin-top:10px}.plan-list{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 0}.plan-item{background:var(--color-subtle);border-left:3px solid #4b84b4;padding:10px 12px}.plan-item strong,.plan-item span{display:block}.plan-item span{color:var(--color-muted);font-size:11px;margin-top:4px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--color-border);padding:9px;text-align:left;font-size:13px}th{background:var(--color-subtle);color:#344054}dialog{width:min(560px,calc(100% - 32px));border:1px solid var(--color-border);border-radius:6px;padding:0;box-shadow:0 20px 50px #10182833}dialog::backdrop{background:#10182880}.dialog-body{padding:24px}.cost-list{padding-left:22px;line-height:1.8}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}.local-note{font-size:12px;border-top:1px solid var(--color-border);padding-top:16px;margin-top:24px}@media(max-width:760px){.grid,.stages,.plan-list{grid-template-columns:1fr}.stages li{border-right:0;border-bottom:1px solid var(--color-border)}.dashboard-card,.dashboard-card.wide{grid-column:1/-1}.progress-head,.dashboard-head{align-items:flex-start}.kpi-pair{grid-template-columns:1fr}.mode-switch button{padding:9px 10px}h1{font-size:24px}.workspace{padding:24px 16px 56px}}
</style></head><body data-theme="evidence"><header class="app-header"><span class="brand">RepChat</span><span>Live analysis demo</span></header><main class="workspace"><div class="page-heading"><p class="eyebrow">Natural language analytics</p><h1 id="page-title">日本語からダッシュボードを生成</h1>
<p id="page-lead" class="lead">分析目的をAIと確認し、KPI・グラフ候補を編集してから、確定した仕様だけをbuildします。</p></div>
<nav class="mode-switch" aria-label="デモ種別"><button id="mode-dashboard" class="selected" aria-pressed="true">ダッシュボード生成</button><button id="mode-graph" aria-pressed="false">単一グラフ生成</button></nav>
<div id="dashboard-workspace"><section class="panel query-panel"><label for="dashboard-question">分析して決めたいこと</label><textarea id="dashboard-question">2021年1月のECサイトで購入成果を改善するため、課題の場所と優先施策を判断できるダッシュボードを作って</textarea>
<p class="lead">AIが目的を分解し、確認事項、仮説、KPI、グラフ候補と理由を提案します。仕様を確定するまでBigQueryは実行しません。</p><div class="actions"><button id="dashboard-submit">AIと分析計画を相談</button><span class="cost">相談はVertex AIだけを使用し、build費用は仕様確定後に別途確認します。</span></div></section>
<section class="panel" aria-labelledby="dashboard-progress-title"><div class="progress-head"><h2 id="dashboard-progress-title">相談・buildの進行状況</h2><span id="dashboard-status" class="status-pill">相談前</span></div><p id="dashboard-message" class="notice" aria-live="polite">分析目的を確認し、相談を開始してください。</p><div id="dashboard-plan" class="plan-list"><div class="plan-item"><strong>1. 目的を分解</strong><span>意思決定と仮説を言語化</span></div><div class="plan-item"><strong>2. 仕様を確認</strong><span>KPI・比較・読者・パネルを編集</span></div><div class="plan-item"><strong>3. 確定してbuild</strong><span>費用確認後にSQLを生成</span></div></div></section>
<section id="plan-review" class="panel hidden"><div class="progress-head"><h2>AIが提案した分析仕様</h2><span id="plan-revision" class="status-pill"></span></div><p id="plan-summary" class="lead"></p><p id="plan-context" class="notice warning"></p><div class="plan-list"><label class="plan-item" for="plan-audience">主な読者<input id="plan-audience"></label><label class="plan-item" for="plan-comparison">比較の考え方<input id="plan-comparison"></label></div><h3>検証する仮説</h3><div id="plan-hypotheses"></div><div id="plan-clarifications"></div><h3>ダッシュボードへ含めるパネル</h3><p class="lead">4件以上を選択してください。左上から成果、説明、診断の順にbuildします。</p><div id="plan-panels"></div><div class="actions"><button id="plan-revise" class="secondary" type="button">回答を反映して再提案</button><button id="plan-build" type="button">この仕様を確定してbuild</button></div></section>
<section id="dashboard-output" class="hidden"><div class="panel dashboard-head"><div><p class="eyebrow">Generated dashboard</p><h2 id="dashboard-title">月次ECサイト分析</h2><p id="dashboard-provenance" class="lead">左上の成果KPIから、右下の行動診断へ読み進めます。</p></div><div><strong id="dashboard-cost">Vertex AI推定 ¥0</strong><p class="chart-caption">BigQuery利用料は別</p></div></div><div id="dashboard-grid" class="dashboard-grid"></div></section></div>
<div id="graph-workspace" class="hidden"><section class="panel query-panel"><label for="dataset-profile">分析対象データ</label><select id="dataset-profile"><option value="ga4">GA4 ECサイト（既知のnestedスキーマ）</option><option value="bitcoin">Bitcoin取引（非GA4のnested/repeated検証）</option></select><label for="question">日本語の問い合わせ</label><textarea id="question">2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して</textarea><p id="profile-note" class="lead">公開GA4サンプルの2020年11月〜2021年1月を分析します。</p>
<div class="examples"><button data-profile="ga4" data-q="2021年1月のセッション数を出して">セッション数</button><button data-profile="ga4" data-q="2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して">チャネル別</button><button data-profile="ga4" data-q="2021年1月の日別セッション数を、日付の昇順で出して">日別推移</button><button data-profile="ga4" data-q="2021年1月のWebサイト回遊を分析するため、セッション内のページビューを時系列順に並べ、入口から3ページ目までの上位12経路を集計し、段階付きのsource、target、セッション数をサンキーダイアグラム用に出して">サイト回遊</button><button data-profile="ga4" data-q="2021年1月の直帰率を出して">未定義語の拒否</button><button data-profile="bitcoin" data-q="2024年1月のBitcoin取引について、各取引の異なる受取アドレス数を、1件・2〜3件・4〜9件・10件以上に分け、取引数が多い順で出して">Bitcoin受取先の複雑度</button></div>
<div class="actions"><button id="submit">SQLとグラフを生成</button><span class="cost">送信ごとに実Vertex AI・BigQueryを使用します。</span></div></section>
<section class="panel" aria-labelledby="progress-title"><div class="progress-head"><h2 id="progress-title">生成の進行状況</h2><span id="run-status" class="status-pill">実行前</span></div><p class="lead">質問を送信すると、ここに処理状況が表示されます。</p><ol class="stages"><li id="s-generate"><strong>1. SQL生成</strong><span>SQLを作る</span></li><li id="s-validate"><strong>2. SQL検査</strong><span>安全性を確認</span></li><li id="s-execute"><strong>3. BigQuery実行</strong><span>データを取得</span></li><li id="s-render"><strong>4. 描画</strong><span>結果を可視化</span></li></ol><p id="message" class="notice" aria-live="polite">問い合わせを入力し、生成ボタンを押してください。</p></section>
<section id="output" class="hidden"><div class="grid"><section class="panel"><h2>生成理由</h2><p id="reason"></p><p id="verification" class="notice"></p></section><section class="panel"><h2>推定費用</h2><p id="cost"></p></section></div>
<section class="panel"><h2>BigQuery実行結果</h2><div class="result-tabs" role="tablist" aria-label="BigQuery実行結果の表示"><button id="result-tab-chart" class="result-tab selected" type="button" role="tab" aria-selected="true" aria-controls="result-chart-panel">グラフ</button><button id="result-tab-data" class="result-tab" type="button" role="tab" aria-selected="false" aria-controls="result-data-panel">取得データ</button></div><div id="result-chart-panel" role="tabpanel" aria-labelledby="result-tab-chart"><div id="chart" class="chart"></div></div><div id="result-data-panel" class="hidden" role="tabpanel" aria-labelledby="result-tab-data"><div id="result-data" class="table-scroll"></div></div></section><section class="panel"><h2>Vertex AIが生成したSQL</h2><pre id="sql" class="sql"></pre></section></section></div>
<p class="lead local-note">ローカルデモです。本番の認証・gate・executor・顧客Git配送は通りません。KPI相談はIssue #180の未検証プロトタイプ、会議報告アシストはIssue #181の後続機能です。</p></main>
<dialog id="cost-dialog" aria-labelledby="cost-title" aria-describedby="cost-description"><div class="dialog-body"><h2 id="cost-title">費用を確認して実行</h2><p id="cost-description">この質問では実際のVertex AIとBigQueryを使用します。</p><ul class="cost-list"><li id="cost-vertex">Vertex AI 約¥0.2</li><li id="cost-bigquery">BigQuery 最大40 GiB（20 GiB × 最大2クエリ、最大約¥38）</li><li><strong id="cost-total">合計最大約¥39</strong></li></ul><p class="lead">無料枠やキャッシュで0円の場合があります。上限は各クエリが上限まで走り、キャッシュが使えない場合の目安です。</p><div class="dialog-actions"><button id="cancel-cost" class="secondary" type="button">キャンセル</button><button id="confirm-cost" type="button">費用を確認して実行</button></div></div></dialog><script>
const $=id=>document.getElementById(id),stages=["generate","validate","execute","render"],dashboardPanels=new Map();let pendingMode="dashboard-plan",currentPlan=null,currentAnswers={},pendingPlan=null;const profileDefaults={ga4:{question:"2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して",note:"公開GA4サンプルの2020年11月〜2021年1月を分析します。"},bitcoin:{question:"2024年1月のBitcoin取引について、各取引の異なる受取アドレス数を、1件・2〜3件・4〜9件・10件以上に分け、取引数が多い順で出して",note:"公開Bitcoin取引の2024年を分析します。outputs とその中の addresses を二段階で展開する非GA4検証です。"}};function selectProfile(profile,replaceQuestion=true){$("dataset-profile").value=profile;$("profile-note").textContent=profileDefaults[profile].note;if(replaceQuestion)$("question").value=profileDefaults[profile].question}document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{selectProfile(b.dataset.profile,false);$("question").value=b.dataset.q});
function stage(name){let reached=false;for(const s of stages){const el=$("s-"+s);if(s===name){el.className="active";el.setAttribute("aria-current","step");reached=true}else{el.className=reached?"":"done";el.removeAttribute("aria-current")}}}
function node(name,attrs={}){const n=document.createElementNS("http://www.w3.org/2000/svg",name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n}
function table(cols,rows){const t=document.createElement("table"),h=t.createTHead().insertRow();cols.forEach(c=>h.appendChild(Object.assign(document.createElement("th"),{textContent:c})));const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();r.forEach(v=>tr.insertCell().textContent=v??"")});return t}
function renderSql(target,sql){const pattern=/(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()|\b(?:SELECT|FROM|WHERE|GROUP|BY|ORDER|AS|WITH|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|CROSS|ON|AND|OR|NOT|IN|BETWEEN|CASE|WHEN|THEN|ELSE|END|OVER|PARTITION|ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT|ROW|QUALIFY|HAVING|LIMIT|OFFSET|DISTINCT|UNION|ALL|ASC|DESC|NULLS|FIRST|LAST|UNNEST|STRUCT|ARRAY)\b)/gi,nodes=[];let cursor=0;for(const match of sql.matchAll(pattern)){if(match.index>cursor)nodes.push(document.createTextNode(sql.slice(cursor,match.index)));const token=match[0],span=document.createElement("span");span.className=token.startsWith("--")||token.startsWith("/*")?"sql-comment":token.startsWith("'")||token.startsWith('"')?"sql-string":token.startsWith("`")?"sql-identifier":/^\d/.test(token)?"sql-number":/\($/.test(sql.slice(match.index+token.length).trimStart()[0]||"")?"sql-function":"sql-keyword";span.textContent=token;nodes.push(span);cursor=match.index+token.length}if(cursor<sql.length)nodes.push(document.createTextNode(sql.slice(cursor)));target.replaceChildren(...nodes)}
function selectResultTab(name){const chart=name==="chart";for(const [tab,selected]of[["result-tab-chart",chart],["result-tab-data",!chart]]){$(tab).className="result-tab"+(selected?" selected":"");$(tab).setAttribute("aria-selected",String(selected))}$("result-chart-panel").className=chart?"":"hidden";$("result-data-panel").className=chart?"hidden":""}
function populateResult(result){graph(result);$("result-data").replaceChildren(table(result.columns,result.rows));selectResultTab("chart")}
function clearResult(){$("chart").replaceChildren();$("result-data").replaceChildren();selectResultTab("chart")}
function renderAnalysisPlan(event){const plan=event.plan;currentPlan=plan;$("plan-review").className="panel";$("plan-revision").textContent=plan.revision;$("plan-summary").textContent=plan.objective_summary;$("plan-audience").value=plan.audience;$("plan-comparison").value=plan.comparison;$("plan-context").textContent=`組織コンテキスト ${plan.organization_context_revision}（ローカルデモfixture・本番メモリー未接続）`;
const hypotheses=document.createElement("ul");plan.hypotheses.forEach(value=>hypotheses.appendChild(Object.assign(document.createElement("li"),{textContent:value})));$("plan-hypotheses").replaceChildren(hypotheses);const questions=[];plan.clarifications.forEach(item=>{const box=Object.assign(document.createElement("div"),{className:"clarification"}),label=document.createElement("label"),input=document.createElement("input");label.textContent=item.question;input.value=item.recommended_answer;input.dataset.answerField=item.field;box.append(label,input);questions.push(box)});$("plan-clarifications").replaceChildren(...questions);
const choices=[];plan.panels.forEach(panel=>{const row=Object.assign(document.createElement("div"),{className:"plan-choice"}),input=Object.assign(document.createElement("input"),{type:"checkbox",checked:true}),label=document.createElement("label"),detail=document.createElement("small");input.dataset.panelId=panel.id;label.textContent=`${panel.title} — ${panel.chart}`;detail.textContent=`${panel.reason} 判断用途: ${panel.decision}`;label.append(detail);row.append(input,label);choices.push(row)});$("plan-panels").replaceChildren(...choices);$("plan-revise").className=plan.clarifications.length?"secondary":"hidden";$("plan-build").disabled=plan.clarifications.length>0;$("dashboard-status").textContent=plan.clarifications.length?"要確認":"提案済み";$("dashboard-message").textContent=plan.clarifications.length?`確認事項${plan.clarifications.length}件へ回答し、再提案してください。`:`分析仕様を確認し、必要なパネルを選んでbuildしてください。Vertex AI推定 ¥${event.cost_jpy}`}
function collectAnswers(){document.querySelectorAll("[data-answer-field]").forEach(input=>{const value=input.value.trim();if(value)currentAnswers[input.dataset.answerField]=value})}
function selectedPlan(){const selected=new Set([...document.querySelectorAll("[data-panel-id]:checked")].map(input=>input.dataset.panelId));if(selected.size<4)throw new Error("ダッシュボードには4件以上のパネルを選択してください。");const plan=JSON.parse(JSON.stringify(currentPlan));plan.panels=plan.panels.filter(panel=>selected.has(panel.id));plan.audience=$("plan-audience").value.trim();plan.comparison=$("plan-comparison").value.trim();if(!plan.audience||!plan.comparison)throw new Error("主な読者と比較の考え方を入力してください。");plan.answers=currentAnswers;return plan}
function sankey(svg,rows,w,h){
const palette=["#4e79a7","#f28e2b","#59a14f","#e15759","#b07aa1","#76b7b2","#edc948","#ff9da7","#9c755f","#bab0ab"],canonical=name=>name.replace(/^\d+\.\s*(入口:\s*)?/,""),links=rows.map(row=>({source:String(row[0]),target:String(row[1]),value:Math.max(0,Number(row[2]))})).filter(link=>Number.isFinite(link.value)&&link.value>0),incoming=new Map(),outgoing=new Map(),values=new Map(),levels=new Map(),colors=new Map();
for(const link of links){outgoing.set(link.source,(outgoing.get(link.source)||0)+link.value);incoming.set(link.target,(incoming.get(link.target)||0)+link.value);for(const [name,fallback]of[[link.source,1],[link.target,2]]){const match=name.match(/^(\d+)\./);levels.set(name,match?Number(match[1]):fallback);const category=canonical(name);if(!colors.has(category))colors.set(category,palette[colors.size%palette.length])}}
for(const name of levels.keys())values.set(name,Math.max(incoming.get(name)||0,outgoing.get(name)||0));
const color=name=>colors.get(canonical(name)),stageNumbers=[...new Set(levels.values())].sort((a,b)=>a-b),groups=new Map(stageNumbers.map(stage=>[stage,[]]));
for(const name of values.keys())groups.get(levels.get(name)).push(name);
for(const names of groups.values())names.sort();
const largest=Math.max(...stageNumbers.map(stage=>groups.get(stage).reduce((sum,name)=>sum+values.get(name),0)),1),maxGaps=Math.max(...stageNumbers.map(stage=>Math.max(0,groups.get(stage).length-1)),0),gap=14,scale=Math.min(1.15,(h-54-gap*maxGaps)/largest),positions=new Map();
stageNumbers.forEach((stage,index)=>{const names=groups.get(stage),height=names.reduce((sum,name)=>sum+Math.max(10,values.get(name)*scale),0)+gap*Math.max(0,names.length-1),x=30+index*(w-150)/Math.max(stageNumbers.length-1,1);let y=(h-height)/2;for(const name of names){const nodeHeight=Math.max(10,values.get(name)*scale);positions.set(name,{x,y,height:nodeHeight,out:0,into:0});y+=nodeHeight+gap}});
const defs=node("defs");svg.append(defs);svg.appendChild(node("title")).textContent="入口から3ページ目までの主要回遊";
links.forEach((link,index)=>{const source=positions.get(link.source),target=positions.get(link.target),width=Math.max(2,link.value*scale),y1=source.y+source.out+width/2,y2=target.y+target.into+width/2,x1=source.x+12,x2=target.x,gradientId="sankey-link-"+index,gradient=node("linearGradient",{id:gradientId,gradientUnits:"userSpaceOnUse",x1,y1,x2,y2});gradient.append(node("stop",{offset:"0%","stop-color":color(link.source)}),node("stop",{offset:"100%","stop-color":color(link.target)}));defs.append(gradient);source.out+=width;target.into+=width;svg.append(node("path",{d:"M "+x1+" "+y1+" C "+((x1+x2)/2)+" "+y1+", "+((x1+x2)/2)+" "+y2+", "+x2+" "+y2,fill:"none",stroke:"url(#"+gradientId+")","stroke-opacity":.58,"stroke-width":width}))});
for(const [name,pos]of positions){svg.append(node("rect",{x:pos.x,y:pos.y,width:12,height:pos.height,rx:2,fill:color(name)}));const label=svg.appendChild(node("text",{x:pos.x+18,y:pos.y+Math.min(16,pos.height/2+4)}));label.textContent=canonical(name).slice(0,32)}
}
function graph(r,box=$("chart")){
box.replaceChildren();
if(!r.rows.length){box.appendChild(Object.assign(document.createElement("p"),{className:"notice warning",textContent:"該当する行はありませんでした。"}));return}
if(r.visualization==="scalar"){box.appendChild(Object.assign(document.createElement("div"),{className:"metric",textContent:r.rows[0][0]}));return}
if(r.visualization==="kpi_pair"){const pair=Object.assign(document.createElement("div"),{className:"kpi-pair"});r.columns.forEach((column,index)=>{const item=document.createElement("div"),value=document.createElement("strong"),label=document.createElement("span");value.textContent=r.rows[0][index]??"—";label.textContent=column;item.append(value,label);pair.append(item)});box.append(pair);return}
if(r.visualization==="funnel"){const funnel=Object.assign(document.createElement("div"),{className:"funnel"}),max=Math.max(...r.rows[0].map(Number),1);r.columns.forEach((column,index)=>{const step=Object.assign(document.createElement("div"),{className:"funnel-step"}),value=Number(r.rows[0][index]);step.style.width=Math.max(34,value/max*100)+"%";step.append(document.createTextNode(column),Object.assign(document.createElement("strong"),{textContent:String(r.rows[0][index])}));funnel.append(step)});box.append(funnel);return}
if(r.visualization==="trend"){
const w=820,h=360,svg=node("svg",{viewBox:`0 0 ${w} ${h}`}),series=[{index:1,color:"#3973c6"},{index:2,color:"#d39b2a"}],vals=series.flatMap(s=>r.rows.map(x=>Number(x[s.index]))),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
box.append(svg);
series.forEach(s=>{const pts=r.rows.map((x,i)=>[45+i*(w-80)/Math.max(r.rows.length-1,1),25+(max-Number(x[s.index]))*(h-75)/span]);svg.append(node("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:s.color,"stroke-width":3}));pts.forEach(p=>{svg.append(node("circle",{cx:p[0],cy:p[1],r:3,fill:s.color}))})});
r.columns.slice(1,3).forEach((column,index)=>{svg.append(node("rect",{x:55+index*170,y:h-30,width:14,height:4,fill:series[index].color}));svg.appendChild(node("text",{x:75+index*170,y:h-24})).textContent=column});return}
if(r.visualization==="sankey"){const svg=node("svg",{viewBox:"0 0 980 460",role:"img","aria-label":"入口から3ページ目までの主要回遊"});box.appendChild(svg);sankey(svg,r.rows,980,460);box.appendChild(Object.assign(document.createElement("p"),{className:"chart-caption",textContent:"色はページ種別を示します。同じページは各段階で同色、リンクは遷移元から遷移先の色へ変化します。"}));return}
if(!["bar","line"].includes(r.visualization)){box.appendChild(table(r.columns,r.rows));return}
const rows=r.rows,w=820,h=r.visualization==="bar"?Math.max(260,rows.length*38+45):360,svg=node("svg",{viewBox:`0 0 ${w} ${h}`});box.appendChild(svg);if(r.visualization==="bar"){const vals=rows.map(x=>Number(x[1])),max=Math.max(...vals,1);rows.forEach((x,i)=>{const y=20+i*38,bw=(w-260)*vals[i]/max;svg.appendChild(node("text",{x:4,y:y+16})).textContent=String(x[0]).slice(0,28);svg.append(node("rect",{x:205,y,width:bw,height:24,rx:4,fill:"#3973c6"}));svg.appendChild(node("text",{x:215+bw,y:y+16})).textContent=String(x[1])})}else{const vals=rows.map(x=>Number(x[1])),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,pts=vals.map((v,i)=>[45+i*(w-80)/Math.max(rows.length-1,1),25+(max-v)*(h-75)/span]);svg.append(node("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:"#3973c6","stroke-width":3}));pts.forEach(p=>svg.append(node("circle",{cx:p[0],cy:p[1],r:4,fill:"#185adb"})))}}
function finish(status){$("run-status").textContent=status;stages.forEach(s=>$("s-"+s).removeAttribute("aria-current"))}
function handle(e){if(e.type==="stage"){stage(e.stage);$("message").textContent=e.message}else if(e.type==="sql"){stage("validate");$("output").className="";renderSql($("sql"),e.sql);$("reason").textContent=e.reason}else if(e.type==="result"){stage("render");$("output").className="";$("verification").className=e.verification==="matched"?"notice":"notice warning";$("verification").textContent=e.verification_label;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}（BigQuery利用料は別）`;populateResult(e);$("message").textContent="生成・実行・描画が完了しました。";stages.forEach(s=>$("s-"+s).className="done");finish("完了")}else if(e.type==="refusal"){stage("render");$("output").className="";renderSql($("sql"),"");$("reason").textContent=e.reason;$("verification").className="notice warning";$("verification").textContent=`未定義のため生成しません: ${e.undefined_terms.join("、")}`;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;clearResult();$("message").textContent="推測した数値を出さずに停止しました。";finish("停止")}else if(e.type==="error")throw new Error(e.message)}
function createDashboardCard(panel){const card=Object.assign(document.createElement("section"),{className:"dashboard-card"+(panel.id==="R17"?" full":panel.id==="R9"||panel.id==="R16"?" wide":"" )}),head=document.createElement("div"),title=document.createElement("h3"),state=Object.assign(document.createElement("span"),{className:"panel-state",textContent:"待機中"}),purpose=Object.assign(document.createElement("p"),{className:"purpose",textContent:panel.purpose}),chart=Object.assign(document.createElement("div"),{className:"chart"}),details=document.createElement("details"),summary=Object.assign(document.createElement("summary"),{textContent:"このグラフの生成理由・SQL・集計データ"}),reason=document.createElement("p"),verification=Object.assign(document.createElement("p"),{className:"notice",textContent:"未実行"}),sql=Object.assign(document.createElement("pre"),{className:"sql"}),data=document.createElement("div");title.textContent=panel.title;head.append(title,state);details.append(summary,reason,verification,sql,data);card.append(head,purpose,chart,details);$("dashboard-grid").append(card);dashboardPanels.set(panel.id,{state,chart,reason,verification,sql,data})}
function handleDashboard(e){if(e.type==="dashboard_plan"){$("dashboard-output").className="";$("dashboard-title").textContent=e.period+" 月次ECサイト分析";$("dashboard-provenance").textContent=`分析仕様 ${e.plan_revision} / 組織コンテキスト ${e.organization_context_revision}。左上の成果から右下の診断へ読み進めます。`;$("dashboard-grid").replaceChildren();dashboardPanels.clear();e.panels.forEach(createDashboardCard);$("dashboard-message").textContent=`${e.panels.length}件の分析へ分解しました。順番にSQLを生成します。`;return}const panel=dashboardPanels.get(e.panel_id);if(e.type==="stage"&&panel){panel.state.textContent=`${e.panel_index}/${e.panel_count} ${e.stage==="generate"?"SQL生成中":"BigQuery実行中"}`;$("dashboard-message").textContent=`${e.title}: ${e.message}`;return}if(e.type==="sql"&&panel){renderSql(panel.sql,e.sql);panel.reason.textContent=e.reason;panel.state.textContent="SQL検査済み";return}if(e.type==="result"&&panel){graph(e,panel.chart);panel.data.replaceChildren(table(e.columns,e.rows));panel.verification.className=e.verification==="matched"?"notice":"notice warning";panel.verification.textContent=e.verification_label;panel.state.textContent="描画完了";return}if(e.type==="refusal"&&panel){panel.reason.textContent=e.reason;panel.verification.className="notice warning";panel.verification.textContent=`未定義のため停止: ${e.undefined_terms.join("、")}`;panel.state.textContent="停止";return}if(e.type==="dashboard_complete"){$("dashboard-status").textContent="完了";$("dashboard-cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;$("dashboard-message").textContent=`${e.panel_count}件のSQL生成・実行・描画が完了しました。`;return}if(e.type==="error")throw new Error(e.message)}
function handlePlan(e){if(e.type==="plan_stage"){$("dashboard-status").textContent="相談中";$("dashboard-message").textContent=e.message}else if(e.type==="plan")renderAnalysisPlan(e);else if(e.type==="error")throw new Error(e.message)}
async function stream(endpoint,question,eventHandler,profile="ga4",extra={}){const res=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question,profile,...extra})});if(!res.ok)throw new Error((await res.json()).error);const reader=res.body.getReader(),dec=new TextDecoder();let buf="";while(true){const{done,value}=await reader.read();buf+=dec.decode(value||new Uint8Array(),{stream:!done});const lines=buf.split("\n");buf=lines.pop();for(const line of lines)if(line)eventHandler(JSON.parse(line));if(done){if(buf.trim())eventHandler(JSON.parse(buf));break}}}
function selectMode(mode){const dashboard=mode==="dashboard";$("dashboard-workspace").className=dashboard?"":"hidden";$("graph-workspace").className=dashboard?"hidden":"";$("mode-dashboard").className=dashboard?"selected":"";$("mode-graph").className=dashboard?"":"selected";$("mode-dashboard").setAttribute("aria-pressed",String(dashboard));$("mode-graph").setAttribute("aria-pressed",String(!dashboard));$("page-title").textContent=dashboard?"日本語からダッシュボードを生成":"日本語からSQLとグラフを生成";$("page-lead").textContent=dashboard?"分析目的をAIと確認し、KPI・グラフ候補を編集してから、確定した仕様だけをbuildします。":"質問からSQL生成・安全検査・BigQuery実行・可視化までを、ひとつの分析ワークスペースで確認できます。"}
function showCost(mode){const dashboard=mode.startsWith("dashboard"),input=$(dashboard?"dashboard-question":"question"),message=$(dashboard?"dashboard-message":"message");if(!input.value.trim()){message.className="notice error";message.textContent="問い合わせを入力してください。";return}pendingMode=mode;const planning=mode==="dashboard-plan",building=mode==="dashboard-build",bitcoin=!dashboard&&$("dataset-profile").value==="bitcoin",count=building?pendingPlan.panels.length:0;$("cost-description").textContent=planning?"分析計画の相談ではVertex AIだけを使用し、BigQueryは実行しません。":building?`確定する${count}件の分析で実際のVertex AIとBigQueryを使用します。`:"この質問では実際のVertex AIとBigQueryを使用します。";$("cost-vertex").textContent=planning?"Vertex AI 約¥0.2（分析計画1回）":building?`Vertex AI 約¥${(count*.2).toFixed(1)}（SQL生成${count}回）`:"Vertex AI 約¥0.2";$("cost-bigquery").textContent=planning?"BigQuery ¥0（仕様確定前は実行しません）":building?`BigQuery 最大${count*40} GiB（生成＋参照を各20 GiB、最大約¥${count*38}）`:bitcoin?"BigQuery dry run 約2.91 GiB（上限20 GiB・参照値照合なし、最大約¥19）":"BigQuery 最大40 GiB（20 GiB × 最大2クエリ、最大約¥38）";$("cost-total").textContent=planning?"今回の相談 約¥0.2":building?`合計最大約¥${Math.ceil(count*38.2)}`:bitcoin?"通常約¥4・最大約¥20":"合計最大約¥39";$("cost-dialog").showModal()}
$("mode-dashboard").onclick=()=>selectMode("dashboard");$("mode-graph").onclick=()=>selectMode("graph");$("dataset-profile").onchange=()=>selectProfile($("dataset-profile").value);$("result-tab-chart").onclick=()=>selectResultTab("chart");$("result-tab-data").onclick=()=>selectResultTab("data");$("submit").onclick=()=>showCost("graph");$("dashboard-submit").onclick=()=>{currentAnswers={};currentPlan=null;pendingPlan=null;showCost("dashboard-plan")};$("plan-revise").onclick=()=>{collectAnswers();showCost("dashboard-plan")};$("plan-build").onclick=()=>{try{pendingPlan=selectedPlan();showCost("dashboard-build")}catch(e){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message}};$("cancel-cost").onclick=()=>$("cost-dialog").close();$("confirm-cost").onclick=()=>pendingMode==="dashboard-plan"?runPlan():pendingMode==="dashboard-build"?runDashboard():runQuery();
async function runQuery(){$("cost-dialog").close();const q=$("question").value.trim(),profile=$("dataset-profile").value;$("submit").disabled=true;$("run-status").textContent="処理中";$("output").className="hidden";clearResult();stage("generate");$("message").className="notice";$("message").textContent="Vertex AIへ問い合わせています。";try{await stream("/api/query",q,handle,profile)}catch(e){$("message").className="notice error";$("message").textContent=e.message;finish("エラー")}finally{$("submit").disabled=false}}
async function runPlan(){$("cost-dialog").close();const q=$("dashboard-question").value.trim();$("dashboard-submit").disabled=true;$("plan-revise").disabled=true;$("dashboard-status").textContent="相談中";$("dashboard-message").className="notice";$("dashboard-message").textContent="分析目的を分解しています。";try{await stream("/api/plan",q,handlePlan,"ga4",{answers:currentAnswers})}catch(e){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message;$("dashboard-status").textContent="エラー"}finally{$("dashboard-submit").disabled=false;$("plan-revise").disabled=false}}
async function runDashboard(){$("cost-dialog").close();const q=$("dashboard-question").value.trim();$("plan-build").disabled=true;$("dashboard-status").textContent="build中";$("dashboard-output").className="hidden";$("dashboard-message").className="notice";$("dashboard-message").textContent="確定した分析仕様をfreezeし、buildを開始します。";try{await stream("/api/dashboard",q,handleDashboard,"ga4",{analysis_plan:pendingPlan})}catch(e){$("dashboard-message").className="notice error";$("dashboard-message").textContent=e.message;$("dashboard-status").textContent="エラー"}finally{$("plan-build").disabled=false}}
</script></body></html>"""
class LiveDemoError(RuntimeError):
    """A local-demo failure that is safe to show in the browser."""


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


def dashboard_sections(
    spec: dict, question: str, panel_ids: list[str] | None = None
) -> tuple[dict[str, str], list[dict]]:
    """Expand one concrete dashboard request into the validated showcase analyses."""
    report.select_sections(spec, question)
    if "ダッシュボード" not in question:
        raise LiveDemoError("依頼に「ダッシュボード」を含めてください。")
    period = period_for_question(question)
    sections = report.select_sections(spec, None, showcase=True)
    if tuple(section["id"] for section in sections) != DASHBOARD_SECTION_IDS:
        raise LiveDemoError("ダッシュボード分析定義の構成が一致しません。")
    if panel_ids is not None:
        if len(panel_ids) != len(set(panel_ids)) or not 4 <= len(panel_ids) <= 6:
            raise LiveDemoError("確定した分析パネルは重複なしの4〜6件にしてください。")
        by_id = {section["id"]: section for section in sections}
        if any(panel_id not in by_id for panel_id in panel_ids):
            raise LiveDemoError("確定した分析計画に未登録のパネルがあります。")
        sections = [by_id[panel_id] for panel_id in panel_ids]
    month_pattern = re.compile(r"\d{4}年\s*\d{1,2}月")
    for section in sections:
        section["text"] = month_pattern.sub(period["label"], section["text"], count=1)
        section["purpose"] = DASHBOARD_PURPOSES[section["id"]]
        # Registered reference SQL is fixed to January 2021. Other available
        # sample months can execute, but cannot be labelled reference-verified.
        if period["from"] != "20210101" or period["to"] != "20210131":
            section["verification"] = "execution"
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


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value if value is None or isinstance(value, (str, int, float, bool)) else str(value)
def visualization_for_result(rows: list[tuple], columns: list[str]) -> str:
    if len(rows) == 1 and len(columns) == 1:
        return "scalar"
    numeric = (int, float, Decimal)
    if (
        rows
        and [column.lower() for column in columns] == ["source", "target", "sessions"]
        and all(
            len(row) == 3
            and isinstance(row[0], str)
            and isinstance(row[1], str)
            and isinstance(row[2], numeric)
            and math.isfinite(float(row[2]))
            for row in rows
        )
    ):
        return "sankey"
    if rows and len(columns) == 2 and all(
        isinstance(row[0], (date, datetime)) and isinstance(row[1], numeric) for row in rows
    ):
        return "line"
    if rows and len(columns) == 2 and len(rows) <= 30 and all(
        isinstance(row[1], numeric) and math.isfinite(float(row[1])) for row in rows
    ):
        return "bar"
    return "table"
def dashboard_visualization(section: dict, rows: list[tuple], columns: list[str]) -> str:
    """Validate a planned panel's result shape before choosing its renderer."""
    component = section["component"]
    numeric = (int, float, Decimal)
    valid = True
    if component == "kpi_pair":
        valid = (
            len(rows) == 1
            and len(columns) == 2
            and len(rows[0]) == 2
            and all(isinstance(value, numeric) for value in rows[0])
        )
    elif component == "funnel":
        valid = (
            len(rows) == 1
            and len(columns) == 3
            and len(rows[0]) == 3
            and all(
                isinstance(value, numeric) and math.isfinite(float(value)) and value >= 0
                for value in rows[0]
            )
        )
    elif component == "trend":
        valid = (
            bool(rows)
            and len(columns) == 3
            and all(
                len(row) == 3
                and isinstance(row[0], (date, datetime))
                and all(
                    isinstance(value, numeric) and math.isfinite(float(value))
                    for value in row[1:]
                )
                for row in rows
            )
        )
    elif component == "sankey":
        valid = visualization_for_result(rows, columns) == "sankey"
    if not valid:
        raise LiveDemoError(
            f"{section['title']}の結果形状がダッシュボード仕様と一致しないため描画しません。"
        )
    if component in {"kpi_pair", "funnel", "trend", "sankey"}:
        return component
    return visualization_for_result(rows, columns)


class LiveQueryEngine:
    def __init__(self, project: str, model: str = report.DEFAULT_MODEL):
        from google import genai
        from google.cloud import bigquery
        self.model = model
        self.spec = json.loads((HERE / "report.json").read_text(encoding="utf-8"))
        self.metrics = report.metrics_block(HERE / "metrics.json")
        self.rules = report.prompt_rules(self.metrics)
        self.bitcoin_rules = bitcoin.prompt_rules()
        self.client = genai.Client(vertexai=True, project=project, location="global")
        self.bq = bigquery.Client(project=project)
        self.lock = threading.Lock()

    def query(
        self, question: str, emit: Callable[[dict], None], profile: str = "ga4"
    ) -> None:
        if not self.lock.acquire(blocking=False):
            raise LiveDemoError("別の問い合わせを処理中です。完了後に再送してください。")
        try:
            if profile == "bitcoin":
                section = bitcoin.section(question)
                period = bitcoin.period_for_question(question)
            else:
                section = report.select_sections(self.spec, question)[0]
                period = period_for_question(question)
            self._run_section(section, period, emit, profile=profile)
        finally:
            self.lock.release()

    def dashboard(
        self,
        question: str,
        emit: Callable[[dict], None],
        analysis_plan: dict | None = None,
    ) -> None:
        """Build all dashboard panels from one concrete Japanese request."""
        if not self.lock.acquire(blocking=False):
            raise LiveDemoError("別の問い合わせを処理中です。完了後に再送してください。")
        try:
            try:
                confirmed = (
                    planner.confirm_plan(analysis_plan) if analysis_plan else None
                )
            except planner.PlannerError as error:
                raise LiveDemoError(str(error)) from error
            panel_ids = (
                [panel["id"] for panel in confirmed["panels"]]
                if confirmed
                else None
            )
            period, sections = dashboard_sections(self.spec, question, panel_ids)
            if confirmed and confirmed["period"] != period:
                raise LiveDemoError("確定した分析仕様の対象期間が依頼文と一致しません。")
            emit(
                {
                    "type": "dashboard_plan",
                    "period": period["label"],
                    "plan_revision": confirmed["revision"] if confirmed else "legacy-demo",
                    "organization_context_revision": (
                        confirmed["organization_context_revision"]
                        if confirmed
                        else "not-attached"
                    ),
                    "panels": [
                        {
                            "id": section["id"],
                            "title": section["title"],
                            "purpose": section["purpose"],
                        }
                        for section in sections
                    ],
                }
            )
            total_cost = 0.0
            for index, section in enumerate(sections, start=1):
                context = {
                    "panel_id": section["id"],
                    "panel_index": index,
                    "panel_count": len(sections),
                    "title": section["title"],
                    "purpose": section["purpose"],
                }
                total_cost += self._run_section(section, period, emit, context)
            emit(
                {
                    "type": "dashboard_complete",
                    "panel_count": len(sections),
                    "cost_jpy": round(total_cost, 3),
                }
            )
        finally:
            self.lock.release()

    def plan(
        self, question: str, answers: dict[str, str], emit: Callable[[dict], None]
    ) -> None:
        """Propose a reviewable plan without running any warehouse query."""
        if not self.lock.acquire(blocking=False):
            raise LiveDemoError("別の問い合わせを処理中です。完了後に再送してください。")
        try:
            period = period_for_question(question)
            emit({"type": "plan_stage", "message": "分析目的と指標定義を照合中です。"})
            plan, usage = planner.propose(
                self.client, self.model, question, period, self.metrics, answers
            )
            cost = (
                usage["input_tokens"] * report.PRICING[self.model][0]
                + usage["output_tokens"] * report.PRICING[self.model][1]
            ) / 1e6 * report.USD_JPY
            emit({"type": "plan", "plan": plan, "cost_jpy": round(cost, 3)})
        except (ValueError, planner.PlannerError) as error:
            raise LiveDemoError(str(error)) from error
        finally:
            self.lock.release()

    def _run_section(
        self,
        section: dict,
        period: dict[str, str],
        emit: Callable[[dict], None],
        context: dict | None = None,
        profile: str = "ga4",
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
                bitcoin.require_sql_period(normalized, period)
            else:
                require_sql_period(normalized, period)
        except ValueError as error:
            raise LiveDemoError(str(error)) from error
        send(
            {
                "type": "sql",
                "sql": report.format_sql_for_display(normalized),
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
        verification, label = "unverified", "実行済み・既知値未照合"
        if section["verification"] == "reference":
            wanted, error = report.exec_bq(
                self.bq, section["gold_sql"], allowed_dataset=allowed_dataset
            )
            if error:
                raise LiveDemoError("登録済み参照SQLの実行に失敗しました。")
            assert wanted is not None
            matches, detail = report.compare(section["compare"], rows, wanted[0])
            verification = "matched" if matches else "mismatch"
            label = (
                "実行・参照値照合済み"
                if matches
                else f"参照値と不一致: {detail}"
            )
        visualization = (
            dashboard_visualization(section, rows, columns)
            if context
            else visualization_for_result(rows, columns)
        )
        send(
            {
                "type": "result",
                "columns": (
                    section.get("shape", {}).get("columns", columns)
                    if context
                    else columns
                ),
                "source_columns": columns,
                "rows": [[json_value(value) for value in row] for row in rows],
                "visualization": visualization,
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
        if self.path not in {"/api/query", "/api/dashboard", "/api/plan"}:
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
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("request body is empty or too large")
            body = json.loads(self.rfile.read(length))
            question = body.get("question") if isinstance(body, dict) else None
            profile = body.get("profile", "ga4") if isinstance(body, dict) else None
            answers = body.get("answers", {}) if isinstance(body, dict) else None
            analysis_plan = body.get("analysis_plan") if isinstance(body, dict) else None
            if not isinstance(question, str):
                raise ValueError("question must be a string")
            if profile not in {"ga4", "bitcoin"}:
                raise ValueError("profile must be ga4 or bitcoin")
            if analysis_plan is not None and not isinstance(analysis_plan, dict):
                raise ValueError("analysis_plan must be an object")
            if not isinstance(answers, dict) or any(
                key not in {"audience", "comparison", "business_goal"}
                or not isinstance(value, str)
                or not value.strip()
                or len(value) > 200
                for key, value in answers.items()
            ):
                raise ValueError("answers must contain only short supported text fields")
            if self.path == "/api/plan":
                if profile != "ga4":
                    raise ValueError("planning mode currently supports only ga4")
                report.select_sections(self.engine.spec, question)
                period_for_question(question)
            elif self.path == "/api/dashboard":
                if profile != "ga4":
                    raise ValueError("dashboard mode currently supports only ga4")
                confirmed = planner.confirm_plan(analysis_plan) if analysis_plan else None
                dashboard_sections(
                    self.engine.spec,
                    question,
                    [panel["id"] for panel in confirmed["panels"]]
                    if confirmed
                    else None,
                )
            elif profile == "bitcoin":
                bitcoin.section(question)
                bitcoin.period_for_question(question)
            else:
                report.select_sections(self.engine.spec, question)
                period_for_question(question)
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
            if self.path == "/api/plan":
                self.engine.plan(question, answers, emit)
            elif self.path == "/api/dashboard":
                if analysis_plan:
                    self.engine.dashboard(question, emit, analysis_plan)
                else:
                    self.engine.dashboard(question, emit)
            elif profile == "bitcoin":
                self.engine.query(question, emit, profile="bitcoin")
            else:
                self.engine.query(question, emit)
        except LiveDemoError as error:
            emit({"type": "error", "message": str(error)})
        except Exception as error:  # noqa: BLE001 — details stay server-side
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

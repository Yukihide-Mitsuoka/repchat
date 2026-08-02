#!/usr/bin/env python3
"""Serve a localhost-only live Japanese prompt → SQL → graph demonstration."""

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
import run_report as report
from demo import DemoError, VENV_DIR, prepare_python, require_adc, run
HERE = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_RESULT_ROWS = 4096, 100
SAMPLE_FIRST_DAY = date(2020, 11, 1)
SAMPLE_LAST_DAY = date(2021, 1, 31)


def running_in_demo_venv() -> bool:
    """Return whether this process is using the demo virtual environment."""
    return Path(sys.prefix).resolve() == VENV_DIR.resolve()

HTML = r"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>RepChat | ライブ分析デモ</title><style>
:root{--color-primary:#1f4e79;--color-primary-hover:#173d61;--color-border:#d9dee7;--color-muted:#667085;--color-text:#101828;--color-surface:#fff;--color-subtle:#f7f8fa;font-family:Inter,"Noto Sans JP",system-ui,sans-serif;color:var(--color-text);background:#f5f6f8}*{box-sizing:border-box}body{margin:0}.app-header{height:52px;background:#fff;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:16px;padding:0 max(24px,calc((100vw - 1180px)/2));color:var(--color-muted);font-size:13px}.brand{color:var(--color-primary);font-size:16px;font-weight:750;letter-spacing:.01em}.workspace{max-width:1180px;margin:auto;padding:32px 24px 72px}.eyebrow{color:var(--color-primary);font-size:12px;font-weight:700;letter-spacing:.1em;margin:0 0 8px;text-transform:uppercase}h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:17px;margin:0}.lead{color:var(--color-muted);line-height:1.65}.panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;padding:20px;margin-top:16px}.query-panel{border-top:3px solid var(--color-primary)}
label{font-size:14px;font-weight:700;display:block;margin-bottom:9px}textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #98a2b3;border-radius:4px;padding:13px 14px;font:inherit;line-height:1.6;background:#fff}textarea:focus{border-color:var(--color-primary);outline:3px solid #1f4e791a}button{border:1px solid var(--color-primary);border-radius:4px;padding:10px 16px;font-weight:700;cursor:pointer;background:var(--color-primary);color:#fff}button:hover{background:var(--color-primary-hover)}button:disabled{cursor:wait;opacity:.55}.secondary{background:#fff;color:var(--color-primary)}.secondary:hover,.examples button:hover{background:#eef4f9}
.actions,.examples{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.examples button{background:#fff;color:#344054;border-color:var(--color-border);padding:6px 9px;font-size:12px}.cost{color:#8a4b08;font-size:12px}.progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.status-pill{padding:4px 9px;border:1px solid var(--color-border);border-radius:999px;background:var(--color-subtle);color:var(--color-muted);font-size:12px;font-weight:700}.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:0;list-style:none;margin:16px 0;padding:0;border:1px solid var(--color-border);border-radius:4px;overflow:hidden}.stages li{min-height:64px;padding:10px 12px;border-right:1px solid var(--color-border);background:#fff;color:var(--color-muted)}.stages li:last-child{border-right:0}.stages strong,.stages span{display:block}.stages strong{font-size:13px}.stages span{font-size:11px;margin-top:5px}.stages .active{box-shadow:inset 0 -3px #d39b2a;background:#fffbeb;color:#694100}.stages .done{box-shadow:inset 0 -3px #2f855a;background:#f3faf6;color:#166534}
.hidden{display:none}.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.sql{white-space:pre;overflow:auto;background:#111827;color:#dbeafe;padding:16px;border-radius:4px;max-height:430px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;tab-size:4}.notice{padding:10px 12px;border-left:3px solid #4b84b4;background:#eef4f9;color:#234e70;line-height:1.5}.warning{border-left-color:#d39b2a;background:#fffbeb;color:#854d0e}.error{border-left-color:#c24141;background:#fff1f1;color:#991b1b}.metric{font-size:46px;font-weight:750;padding:26px 8px}.chart{overflow-x:auto}.chart svg{min-width:760px;width:100%;height:auto}.chart text{font-size:11px;fill:#475467}.chart-caption{margin:8px 0 0;color:var(--color-muted);font-size:12px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--color-border);padding:9px;text-align:left;font-size:13px}th{background:var(--color-subtle);color:#344054}dialog{width:min(560px,calc(100% - 32px));border:1px solid var(--color-border);border-radius:6px;padding:0;box-shadow:0 20px 50px #10182833}dialog::backdrop{background:#10182880}.dialog-body{padding:24px}.cost-list{padding-left:22px;line-height:1.8}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}.local-note{font-size:12px;border-top:1px solid var(--color-border);padding-top:16px;margin-top:24px}@media(max-width:760px){.grid,.stages{grid-template-columns:1fr}.stages li{border-right:0;border-bottom:1px solid var(--color-border)}.progress-head{align-items:flex-start}h1{font-size:24px}.workspace{padding:24px 16px 56px}}
</style></head><body data-theme="evidence"><header class="app-header"><span class="brand">RepChat</span><span>Live analysis demo</span></header><main class="workspace"><div class="page-heading"><p class="eyebrow">Natural language analytics</p><h1>日本語からSQLとグラフを生成</h1>
<p class="lead">質問からSQL生成・安全検査・BigQuery実行・可視化までを、ひとつの分析ワークスペースで確認できます。</p></div>
<section class="panel query-panel"><label for="question">日本語の問い合わせ</label><textarea id="question">2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して</textarea>
<div class="examples"><button data-q="2021年1月のセッション数を出して">セッション数</button><button data-q="2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して">チャネル別</button><button data-q="2021年1月の日別セッション数を、日付の昇順で出して">日別推移</button><button data-q="2021年1月のWebサイト回遊を分析するため、セッション内のページビューを時系列順に並べ、入口から3ページ目までの上位12経路を集計し、段階付きのsource、target、セッション数をサンキーダイアグラム用に出して">サイト回遊</button><button data-q="2021年1月の直帰率を出して">未定義語の拒否</button></div>
<div class="actions"><button id="submit">SQLとグラフを生成</button><span class="cost">送信ごとに実Vertex AI・BigQueryを使用します。</span></div></section>
<section class="panel" aria-labelledby="progress-title"><div class="progress-head"><h2 id="progress-title">生成の進行状況</h2><span id="run-status" class="status-pill">実行前</span></div><p class="lead">質問を送信すると、ここに処理状況が表示されます。</p><ol class="stages"><li id="s-generate"><strong>1. SQL生成</strong><span>SQLを作る</span></li><li id="s-validate"><strong>2. SQL検査</strong><span>安全性を確認</span></li><li id="s-execute"><strong>3. BigQuery実行</strong><span>データを取得</span></li><li id="s-render"><strong>4. 描画</strong><span>結果を可視化</span></li></ol><p id="message" class="notice" aria-live="polite">問い合わせを入力し、生成ボタンを押してください。</p></section>
<section id="output" class="hidden"><div class="grid"><section class="panel"><h2>生成理由</h2><p id="reason"></p><p id="verification" class="notice"></p></section><section class="panel"><h2>推定費用</h2><p id="cost"></p></section></div>
<section class="panel"><h2>BigQuery実行結果</h2><div id="chart" class="chart"></div></section><section class="panel"><h2>Vertex AIが生成したSQL</h2><pre id="sql" class="sql"></pre></section></section>
<p class="lead local-note">ローカルデモです。本番の認証・gate・executor・顧客Git配送は通りません。</p></main>
<dialog id="cost-dialog" aria-labelledby="cost-title" aria-describedby="cost-description"><div class="dialog-body"><h2 id="cost-title">費用を確認して実行</h2><p id="cost-description">この質問では実際のVertex AIとBigQueryを使用します。</p><ul class="cost-list"><li>Vertex AI 約¥0.2</li><li>BigQuery 最大40 GiB（20 GiB × 最大2クエリ、最大約¥38）</li><li><strong>合計最大約¥39</strong></li></ul><p class="lead">無料枠やキャッシュで0円の場合があります。</p><div class="dialog-actions"><button id="cancel-cost" class="secondary" type="button">キャンセル</button><button id="confirm-cost" type="button">費用を確認して実行</button></div></div></dialog><script>
const $=id=>document.getElementById(id),stages=["generate","validate","execute","render"];document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{$("question").value=b.dataset.q});
function stage(name){let reached=false;for(const s of stages){const el=$("s-"+s);if(s===name){el.className="active";el.setAttribute("aria-current","step");reached=true}else{el.className=reached?"":"done";el.removeAttribute("aria-current")}}}
function node(name,attrs={}){const n=document.createElementNS("http://www.w3.org/2000/svg",name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n}
function table(cols,rows){const t=document.createElement("table"),h=t.createTHead().insertRow();cols.forEach(c=>h.appendChild(Object.assign(document.createElement("th"),{textContent:c})));const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();r.forEach(v=>tr.insertCell().textContent=v??"")});return t}
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
function graph(r){const box=$("chart");box.replaceChildren();if(!r.rows.length){box.appendChild(Object.assign(document.createElement("p"),{className:"notice warning",textContent:"該当する行はありませんでした。"}));return}if(r.visualization==="scalar"){box.appendChild(Object.assign(document.createElement("div"),{className:"metric",textContent:r.rows[0][0]}));return}if(r.visualization==="sankey"){const svg=node("svg",{viewBox:"0 0 980 460",role:"img","aria-label":"入口から3ページ目までの主要回遊"});box.appendChild(svg);sankey(svg,r.rows,980,460);box.appendChild(Object.assign(document.createElement("p"),{className:"chart-caption",textContent:"色はページ種別を示します。同じページは各段階で同色、リンクは遷移元から遷移先の色へ変化します。"}));return}if(!["bar","line"].includes(r.visualization)){box.appendChild(table(r.columns,r.rows));return}
const rows=r.rows,w=820,h=r.visualization==="bar"?Math.max(260,rows.length*38+45):360,svg=node("svg",{viewBox:`0 0 ${w} ${h}`});box.appendChild(svg);if(r.visualization==="bar"){const vals=rows.map(x=>Number(x[1])),max=Math.max(...vals,1);rows.forEach((x,i)=>{const y=20+i*38,bw=(w-260)*vals[i]/max;svg.appendChild(node("text",{x:4,y:y+16})).textContent=String(x[0]).slice(0,28);svg.append(node("rect",{x:205,y,width:bw,height:24,rx:4,fill:"#3973c6"}));svg.appendChild(node("text",{x:215+bw,y:y+16})).textContent=String(x[1])})}else{const vals=rows.map(x=>Number(x[1])),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,pts=vals.map((v,i)=>[45+i*(w-80)/Math.max(rows.length-1,1),25+(max-v)*(h-75)/span]);svg.append(node("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:"#3973c6","stroke-width":3}));pts.forEach(p=>svg.append(node("circle",{cx:p[0],cy:p[1],r:4,fill:"#185adb"})))}}
function finish(status){$("run-status").textContent=status;stages.forEach(s=>$("s-"+s).removeAttribute("aria-current"))}
function handle(e){if(e.type==="stage"){stage(e.stage);$("message").textContent=e.message}else if(e.type==="sql"){stage("validate");$("output").className="";$("sql").textContent=e.sql;$("reason").textContent=e.reason}else if(e.type==="result"){stage("render");$("output").className="";$("verification").className=e.verification==="matched"?"notice":"notice warning";$("verification").textContent=e.verification_label;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}（BigQuery利用料は別）`;graph(e);$("message").textContent="生成・実行・描画が完了しました。";stages.forEach(s=>$("s-"+s).className="done");finish("完了")}else if(e.type==="refusal"){stage("render");$("output").className="";$("sql").textContent="";$("reason").textContent=e.reason;$("verification").className="notice warning";$("verification").textContent=`未定義のため生成しません: ${e.undefined_terms.join("、")}`;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;$("chart").replaceChildren();$("message").textContent="推測した数値を出さずに停止しました。";finish("停止")}else if(e.type==="error")throw new Error(e.message)}
$("submit").onclick=()=>{if(!$("question").value.trim()){$("message").className="notice error";$("message").textContent="問い合わせを入力してください。";return}$("cost-dialog").showModal()};
$("cancel-cost").onclick=()=>$("cost-dialog").close();
$("confirm-cost").onclick=runQuery;
async function runQuery(){$("cost-dialog").close();const q=$("question").value.trim();$("submit").disabled=true;$("run-status").textContent="処理中";$("output").className="hidden";stage("generate");$("message").className="notice";$("message").textContent="Vertex AIへ問い合わせています。";try{const res=await fetch("/api/query",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:q})});if(!res.ok)throw new Error((await res.json()).error);const reader=res.body.getReader(),dec=new TextDecoder();let buf="";while(true){const{done,value}=await reader.read();buf+=dec.decode(value||new Uint8Array(),{stream:!done});const lines=buf.split("\n");buf=lines.pop();for(const line of lines)if(line)handle(JSON.parse(line));if(done){if(buf.trim())handle(JSON.parse(buf));break}}}catch(e){$("message").className="notice error";$("message").textContent=e.message;finish("エラー")}finally{$("submit").disabled=false}}
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
class LiveQueryEngine:
    def __init__(self, project: str, model: str = report.DEFAULT_MODEL):
        from google import genai
        from google.cloud import bigquery
        self.model = model
        self.spec = json.loads((HERE / "report.json").read_text(encoding="utf-8"))
        self.rules = report.prompt_rules(report.metrics_block(HERE / "metrics.json"))
        self.client = genai.Client(vertexai=True, project=project, location="global")
        self.bq = bigquery.Client(project=project)
        self.lock = threading.Lock()
    def query(self, question: str, emit: Callable[[dict], None]) -> None:
        if not self.lock.acquire(blocking=False):
            raise LiveDemoError("別の問い合わせを処理中です。完了後に再送してください。")
        try:
            section = report.select_sections(self.spec, question)[0]
            period = period_for_question(question)
            emit({"type": "stage", "stage": "generate", "message": "Vertex AIでSQLを生成中です。"})
            answer, usage = report.generate(
                self.client, self.model, section, period, self.rules
            )
            cost = (
                usage["input_tokens"] * report.PRICING[self.model][0]
                + usage["output_tokens"] * report.PRICING[self.model][1]
            ) / 1e6 * report.USD_JPY
            sql, undefined = (answer.get("sql") or "").strip(), answer.get("undefined_terms") or []
            if not sql and undefined:
                emit({"type": "refusal", "reason": answer.get("reason", ""),
                      "undefined_terms": undefined, "cost_jpy": round(cost, 3)})
                return
            if not sql:
                raise LiveDemoError("SQLが返りませんでした。指標定義または質問を確認してください。")
            normalized, error = report.validate_sql(sql)
            if error:
                raise LiveDemoError(f"生成SQLを安全検査で拒否しました: {error}")
            require_sql_period(normalized, period)
            emit({"type": "sql", "sql": report.format_sql_for_display(normalized),
                  "reason": answer.get("reason", "")})
            emit({"type": "stage", "stage": "execute", "message": "BigQueryで読み取り実行中です。"})
            result, error = report.exec_bq(self.bq, normalized,
                                           max_results=MAX_RESULT_ROWS + 1)
            if error:
                raise LiveDemoError(f"BigQuery実行に失敗しました: {error}")
            rows, columns = result
            if len(rows) > MAX_RESULT_ROWS:
                raise LiveDemoError(
                    f"結果が{MAX_RESULT_ROWS}行を超えたため描画しません。集計条件を追加してください。"
                )
            verification, label = "unverified", "実行済み・既知値未照合"
            if section["verification"] == "reference":
                wanted, error = report.exec_bq(self.bq, section["gold_sql"])
                if error:
                    raise LiveDemoError("登録済み参照SQLの実行に失敗しました。")
                matches, detail = report.compare(section["compare"], rows, wanted[0])
                verification = "matched" if matches else "mismatch"
                label = "実行・参照値照合済み" if matches else f"参照値と不一致: {detail}"
            emit(
                {
                    "type": "result",
                    "columns": columns,
                    "rows": [[json_value(value) for value in row] for row in rows],
                    "visualization": visualization_for_result(rows, columns),
                    "verification": verification,
                    "verification_label": label,
                    "cost_jpy": round(cost, 3),
                }
            )
        finally:
            self.lock.release()
class LiveDemoHandler(BaseHTTPRequestHandler):
    engine: LiveQueryEngine
    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, HTML.encode(), "text/html; charset=utf-8")
        else:
            self._send(204 if self.path == "/favicon.ico" else 404, b"", "text/plain")
    def do_POST(self) -> None:
        if self.path != "/api/query":
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
            if not isinstance(question, str):
                raise ValueError("question must be a string")
            report.select_sections(self.engine.spec, question)
            period_for_question(question)
        except (ValueError, json.JSONDecodeError, LiveDemoError) as error:
            self._send_json(400, {"error": str(error)})
            return
        self.send_response(200)
        self._headers("application/x-ndjson; charset=utf-8")
        self.end_headers()
        def emit(event: dict) -> None:
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()
        try:
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
        print("live mode: enter a Japanese prompt, then stream generated SQL and a graph")
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

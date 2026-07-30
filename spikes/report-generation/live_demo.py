#!/usr/bin/env python3
"""Serve a localhost-only live Japanese prompt → SQL → graph demonstration."""

from __future__ import annotations
import argparse
import json
import math
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
from demo import DemoError, prepare_python, require_adc, run, venv_python
HERE = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
MAX_BODY_BYTES, MAX_RESULT_ROWS = 4096, 100

HTML = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>日本語からSQLとグラフを生成</title><style>
:root{font-family:Inter,"Noto Sans JP",system-ui,sans-serif;color:#182230;background:#f4f6f8}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1080px;margin:auto;padding:36px 24px 72px}
h1{font-size:32px;margin:0 0 8px}.lead{color:#52606d}.panel{background:white;border:1px solid #dfe3e8;border-radius:14px;padding:22px;margin-top:18px;box-shadow:0 5px 18px #1822300c}
label{font-weight:700;display:block;margin-bottom:9px}textarea{width:100%;min-height:92px;resize:vertical;border:1px solid #aab4c0;border-radius:9px;padding:13px;font:inherit}button{border:0;border-radius:8px;padding:11px 18px;font-weight:700;cursor:pointer;background:#185adb;color:white}
.actions,.examples,.stages{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}.examples button{background:#e8eef9;color:#174ea6;padding:7px 10px}.cost{color:#8a4b08;font-size:13px}.stages{list-style:none;margin:0;padding:0}.stages li{padding:7px 10px;border-radius:20px;background:#edf1f5;color:#617184;font-size:13px}.stages .active{background:#fff0c2;color:#704d00}.stages .done{background:#dff5e5;color:#176b32}
.hidden{display:none}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.sql{white-space:pre;overflow:auto;background:#111827;color:#dbeafe;padding:16px;border-radius:9px;max-height:430px;font:13px/1.55 ui-monospace,monospace}.notice{padding:12px;border-radius:8px;background:#edf6ff;color:#174ea6}.warning{background:#fff2db;color:#8a4b08}.error{background:#ffe7e7;color:#9b1c1c}
.metric{font-size:48px;font-weight:750;padding:26px 8px}.chart{overflow-x:auto}.chart svg{min-width:680px;width:100%;height:auto}.chart text{font-size:12px;fill:#475569}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e5e9ee;padding:9px;text-align:left}th{background:#f7f9fb}@media(max-width:760px){.grid{grid-template-columns:1fr}h1{font-size:26px}}
</style></head><body><main class="wrap"><h1>日本語からSQLとグラフを生成</h1>
<p class="lead">入力した質問をVertex AIでBigQuery SQLへ変換し、読み取り専用で実行して同じ画面に描画します。</p>
<section class="panel"><label for="question">日本語の問い合わせ</label><textarea id="question">2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して</textarea>
<div class="examples"><button data-q="2021年1月のセッション数を出して">セッション数</button><button data-q="2021年1月のセッション数を流入チャネル（medium）別に、多い順で出して">チャネル別</button><button data-q="2021年1月の日別セッション数を日付順で出して">日別推移</button><button data-q="2021年1月の直帰率を出して">未定義語の拒否</button></div>
<div class="actions"><button id="submit">SQLとグラフを生成</button><span class="cost">送信ごとに実Vertex AI・BigQueryを使用します。</span></div></section>
<section class="panel"><ol class="stages"><li id="s-generate">1. SQL生成</li><li id="s-validate">2. SQL検査</li><li id="s-execute">3. BigQuery実行</li><li id="s-render">4. 描画</li></ol><p id="message" class="notice" aria-live="polite">問い合わせを入力してください。</p></section>
<section id="output" class="hidden"><div class="grid"><section class="panel"><h2>生成理由</h2><p id="reason"></p><p id="verification" class="notice"></p></section><section class="panel"><h2>推定費用</h2><p id="cost"></p></section></div>
<section class="panel"><h2>Vertex AIが生成したSQL</h2><pre id="sql" class="sql"></pre></section><section class="panel"><h2>BigQuery実行結果</h2><div id="chart" class="chart"></div></section></section>
<p class="lead">ローカルデモです。本番の認証・gate・executor・顧客Git配送は通りません。</p></main><script>
const $=id=>document.getElementById(id),stages=["generate","validate","execute","render"];document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{$("question").value=b.dataset.q});
function stage(name){let reached=false;for(const s of stages){const el=$("s-"+s);if(s===name){el.className="active";reached=true}else el.className=reached?"":"done"}}
function node(name,attrs={}){const n=document.createElementNS("http://www.w3.org/2000/svg",name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n}
function table(cols,rows){const t=document.createElement("table"),h=t.createTHead().insertRow();cols.forEach(c=>h.appendChild(Object.assign(document.createElement("th"),{textContent:c})));const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();r.forEach(v=>tr.insertCell().textContent=v??"")});return t}
function graph(r){const box=$("chart");box.replaceChildren();if(!r.rows.length){box.appendChild(Object.assign(document.createElement("p"),{className:"notice warning",textContent:"該当する行はありませんでした。"}));return}if(r.visualization==="scalar"){box.appendChild(Object.assign(document.createElement("div"),{className:"metric",textContent:r.rows[0][0]}));return}if(!["bar","line"].includes(r.visualization)){box.appendChild(table(r.columns,r.rows));return}
const rows=r.rows,w=820,h=r.visualization==="bar"?Math.max(260,rows.length*38+45):360,svg=node("svg",{viewBox:`0 0 ${w} ${h}`});box.appendChild(svg);if(r.visualization==="bar"){const vals=rows.map(x=>Number(x[1])),max=Math.max(...vals,1);rows.forEach((x,i)=>{const y=20+i*38,bw=(w-260)*vals[i]/max;svg.append(node("text",{x:4,y:y+16})).textContent=String(x[0]).slice(0,28);svg.append(node("rect",{x:205,y,width:bw,height:24,rx:4,fill:"#3973c6"}));svg.append(node("text",{x:215+bw,y:y+16})).textContent=String(x[1])})}else{const vals=rows.map(x=>Number(x[1])),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,pts=vals.map((v,i)=>[45+i*(w-80)/Math.max(rows.length-1,1),25+(max-v)*(h-75)/span]);svg.append(node("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:"#3973c6","stroke-width":3}));pts.forEach(p=>svg.append(node("circle",{cx:p[0],cy:p[1],r:4,fill:"#185adb"}))}}
function handle(e){if(e.type==="stage"){stage(e.stage);$("message").textContent=e.message}else if(e.type==="sql"){stage("validate");$("output").className="";$("sql").textContent=e.sql;$("reason").textContent=e.reason}else if(e.type==="result"){stage("render");$("output").className="";$("verification").className=e.verification==="matched"?"notice":"notice warning";$("verification").textContent=e.verification_label;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}（BigQuery利用料は別）`;graph(e);$("message").textContent="生成・実行・描画が完了しました。";stages.forEach(s=>$("s-"+s).className="done")}else if(e.type==="refusal"){stage("render");$("output").className="";$("sql").textContent="";$("reason").textContent=e.reason;$("verification").className="notice warning";$("verification").textContent=`未定義のため生成しません: ${e.undefined_terms.join("、")}`;$("cost").textContent=`Vertex AI推定 ¥${e.cost_jpy}`;$("chart").replaceChildren();$("message").textContent="推測した数値を出さずに停止しました。"}else if(e.type==="error")throw new Error(e.message)}
$("submit").onclick=async()=>{const q=$("question").value.trim();$("submit").disabled=true;$("output").className="hidden";stage("generate");$("message").className="notice";$("message").textContent="Vertex AIへ問い合わせています。";try{const res=await fetch("/api/query",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:q})});if(!res.ok)throw new Error((await res.json()).error);const reader=res.body.getReader(),dec=new TextDecoder();let buf="";while(true){const{done,value}=await reader.read();buf+=dec.decode(value||new Uint8Array(),{stream:!done});const lines=buf.split("\\n");buf=lines.pop();for(const line of lines)if(line)handle(JSON.parse(line));if(done){if(buf.trim())handle(JSON.parse(buf));break}}}catch(e){$("message").className="notice error";$("message").textContent=e.message}finally{$("submit").disabled=false}};
</script></body></html>"""
class LiveDemoError(RuntimeError):
    """A local-demo failure that is safe to show in the browser."""
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
            emit({"type": "stage", "stage": "generate", "message": "Vertex AIでSQLを生成中です。"})
            answer, usage = report.generate(
                self.client, self.model, section, self.spec["period"], self.rules
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
        except (ValueError, json.JSONDecodeError) as error:
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
        expected_python = venv_python()
        if not expected_python.exists() or Path(sys.executable).resolve() != expected_python.resolve():
            python = prepare_python()
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

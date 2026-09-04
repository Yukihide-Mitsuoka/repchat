import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LIVE, ROOT, python } from './live-demo-test-helpers.ts';

test('live HTTP boundary serves same-origin JSON and rejects unsafe requests and binds', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 query_count=0
 def query(self,q,emit,**_kwargs):self.query_count+=1;emit({"type":"result","rows":[[118380]],"columns":["sessions"],"visualization":"scalar","verification":"matched","verification_label":"照合済み","cost_jpy":0.1})
 def dashboard(self,q,emit,*_args,**_kwargs):emit({"type":"dashboard_complete","panel_count":6,"cost_jpy":1.2})
 def meeting_report(self,revision,emit,**_kwargs):emit({"type":"meeting_report","build_revision":revision})
engine=E();s=m.create_server("127.0.0.1",0,engine);t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}";statuses=[]
try:
 page=urllib.request.urlopen(base+"/").read().decode()
 query_question="2021年1月のセッション数を出して"
 query_spec={"title":"セッション数","objective":"規模を確認する","dimensions":[],"measures":["セッション数"],"comparison":"単月","chart":"scorecard","execution_prompt":query_question,"reason":"基準値を判断する"}
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":query_question,"analysis_specification":query_spec},ensure_ascii=False).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 value=json.loads(urllib.request.urlopen(req).read().decode())["rows"][0][0]
 dashboard_question="2021年1月のECサイト分析ダッシュボードを作って"
 dashboard_raw={"objective_summary":"成果を判断する","audience":"責任者","comparison":"月内比較","hypotheses":["差がある"],"clarifications":[],"panels":[{"title":"購入規模","kpi":"購入件数","chart":"scorecard","decision":"規模を判断する","reason":"基準値が必要","execution_prompt":"2021年1月の購入件数を集計する","dimensions":[],"measures":["購入件数"],"layout_row":1,"layout_weight":1}]}
 dashboard_plan=m.planner.normalize_dashboard_plan(dashboard_raw,dashboard_question,m.period_for_question(dashboard_question),{"audience":"責任者","comparison":"月内比較","business_goal":"成果改善"})
 dashboard_req=urllib.request.Request(base+"/api/dashboard",data=json.dumps({"question":dashboard_question,"analysis_plan":dashboard_plan},ensure_ascii=False).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 dashboard_count=json.loads(urllib.request.urlopen(dashboard_req).read().decode())["panel_count"]
 report_req=urllib.request.Request(base+"/api/report",data=json.dumps({"question":"会議報告案を作って","build_revision":"build-111111111111"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 report_revision=json.loads(urllib.request.urlopen(report_req).read().decode())["build_revision"]
 broad_req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":"どんな分析をしたらいい？"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 try:urllib.request.urlopen(broad_req)
 except urllib.error.HTTPError as e:statuses.append(e.code)
 try:urllib.request.urlopen(urllib.request.Request(base+"/api/report",data=json.dumps({"question":"会議報告案を作って","build_revision":"bad"}).encode(),headers={"content-type":"application/json","origin":base},method="POST"))
 except urllib.error.HTTPError as e:statuses.append(e.code)
 for ct,origin in [("text/plain",base),("application/json","https://attacker.example")]:
  try:urllib.request.urlopen(urllib.request.Request(base+"/api/query",data=b"{}",headers={"content-type":ct,"origin":origin},method="POST"))
  except urllib.error.HTTPError as e:statuses.append(e.code)
 print(json.dumps({"form":"日本語の問い合わせ" in page,"value":value,"dashboard_count":dashboard_count,"report_revision":report_revision,"statuses":statuses,"query_count":engine.query_count}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    form: true,
    value: 118380,
    dashboard_count: 6,
    report_revision: 'build-111111111111',
    statuses: [400, 400, 415, 403],
    query_count: 1,
  });
  const bind = spawnSync(
    'python3',
    [LIVE, '--project', 'example-project', '--host', '0.0.0.0', '--no-open'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(bind.status, 2);
  assert.match(bind.stderr, /host must remain localhost-only/);
});

test('expired application-default credentials return a safe recovery instruction', () => {
  const result = python(`
import threading,urllib.request
RefreshError=type("RefreshError",(Exception,),{})
RefreshError.__module__="google.auth.exceptions"
class E:
 def query(self,_question,_emit,**_kwargs):raise RefreshError("sensitive credential detail")
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
try:
 question="2021年1月のセッション数を出して"
 spec={"title":"セッション数","objective":"規模を確認する","dimensions":[],"measures":["セッション数"],"comparison":"単月","chart":"scorecard","execution_prompt":question,"reason":"基準値を判断する"}
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":question,"analysis_specification":spec},ensure_ascii=False).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 event=json.loads(urllib.request.urlopen(req).read().decode())
 print(json.dumps(event,ensure_ascii=False))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  const event = JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('{')) ?? '');
  assert.deepEqual(event, {
    type: 'error',
    message:
      'Google Cloudの認証期限が切れています。gcloud auth application-default loginを実行し、デモを再起動してください。今回の処理は自動再実行していません。',
  });
  assert.doesNotMatch(result.stdout, /sensitive credential detail/);
});

test('dashboard HTTP boundary accepts a bounded confirmed plan larger than a simple query', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 def dashboard(self,q,emit,plan=None,**_kwargs):emit({"type":"dashboard_complete","accepted":plan is not None})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
question="2021年1月のECサイトで購入成果を改善するため、課題の場所と優先施策を判断できるダッシュボードを作って"
def plan(reason):
 return {"objective":question,"objective_summary":"購入課題を判断する","audience":"月次会議","comparison":"月内推移","period":m.period_for_question(question),"hypotheses":["購入導線に課題がある"],"clarifications":[],"answers":{"audience":"月次会議"},"panels":[{"title":f"分析{index}","kpi":"購入金額","chart":"table","decision":"優先施策を判断する","reason":reason,"execution_prompt":f"2021年1月の商品別購入金額を分析{index}として比較する","dimensions":["商品"],"measures":["購入金額"],"layout_row":(index+3)//4,"layout_weight":1} for index in range(1,21)]}
def request(analysis_plan):
 data=json.dumps({"question":question,"profile":"ga4","analysis_plan":analysis_plan},ensure_ascii=False).encode()
 req=urllib.request.Request(base+"/api/dashboard",data=data,headers={"content-type":"application/json","origin":base},method="POST")
 return data,req
try:
 bounded,bounded_req=request(plan("理由"*100))
 accepted=json.loads(urllib.request.urlopen(bounded_req).read().decode())["accepted"]
 oversized,oversized_req=request(plan("理由"*900))
 oversized_status=0
 try:urllib.request.urlopen(oversized_req)
 except urllib.error.HTTPError as error:oversized_status=error.code
 print(json.dumps({"limit":m.MAX_PLAN_BODY_BYTES,"bounded_bytes":len(bounded),"oversized_bytes":len(oversized),"accepted":accepted,"oversized_status":oversized_status}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.split('\n').at(-2) ?? '');
  assert.ok(observed.bounded_bytes > 4096, observed);
  assert.ok(observed.bounded_bytes <= observed.limit, observed);
  assert.ok(observed.oversized_bytes > observed.limit, observed);
  assert.equal(observed.accepted, true);
  assert.equal(observed.oversized_status, 400);
});

test('oversized request returns HTTP 400 after accepting its bounded transport body', () => {
  const result = python(`
import socket,threading
class E:pass
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();body=b"x"*(m.MAX_PLAN_BODY_BYTES+1)
client=socket.create_connection(("127.0.0.1",s.server_port));client.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,1024);client.settimeout(2)
request=(f"POST /api/dashboard HTTP/1.1\\r\\nHost: 127.0.0.1:{s.server_port}\\r\\nContent-Type: application/json\\r\\nContent-Length: {len(body)}\\r\\nConnection: close\\r\\n\\r\\n").encode()
try:
 client.sendall(request)
 client.sendall(body)
 response=b""
 while True:
  chunk=client.recv(4096)
  if not chunk:break
  response+=chunk
 print(response.split(b"\\r\\n",1)[0].decode())
finally:client.close();s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('\n').at(-2), 'HTTP/1.0 400 Bad Request');
});

test('rejected request does not drain a body above the transport safety bound', () => {
  const result = python(`
import socket,threading
class E:pass
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start()
client=socket.create_connection(("127.0.0.1",s.server_port));client.settimeout(2);length=m.MAX_REJECTED_BODY_BYTES+1
request=(f"POST /api/dashboard HTTP/1.1\\r\\nHost: 127.0.0.1:{s.server_port}\\r\\nContent-Type: application/json\\r\\nContent-Length: {length}\\r\\nConnection: close\\r\\n\\r\\n").encode()
try:
 client.sendall(request)
 response=client.recv(4096)
 print(response.split(b"\\r\\n",1)[0].decode())
finally:client.close();s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('\n').at(-2), 'HTTP/1.0 400 Bad Request');
});

test('dashboard validation turns unexpected errors into a JSON response', () => {
  const result = python(`
import json,threading,urllib.error,urllib.request
question="2021年1月の購入課題を分析するダッシュボードを作って"
raw={"objective_summary":"購入課題を判断する","audience":"責任者","comparison":"月内比較","hypotheses":["差がある"],"answers":{"audience":"責任者"},"clarifications":[],"panels":[{"title":"購入規模","kpi":"購入件数","chart":"scorecard","decision":"規模を判断する","reason":"基準値が必要","execution_prompt":"2021年1月の購入件数を集計する","dimensions":[],"measures":["購入件数"],"layout_row":1,"layout_weight":1}]}
plan=m.planner.normalize_dashboard_plan(raw,question,m.period_for_question(question),raw["answers"])
def unexpected(*_args):raise RuntimeError("unexpected validation failure")
m.dashboard_sections_for_plan=unexpected
s=m.create_server("127.0.0.1",0,object());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
request=urllib.request.Request(base+"/api/dashboard",data=json.dumps({"question":question,"analysis_plan":plan},ensure_ascii=False).encode(),headers={"content-type":"application/json","origin":base},method="POST")
try:
 status=0
 try:urllib.request.urlopen(request)
 except urllib.error.HTTPError as error:
  status=error.code;body=json.loads(error.read().decode())
 print(json.dumps({"status":status,"error":body["error"]},ensure_ascii=False))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('{')) ?? ''),
    {
      status: 500,
      error: '生成または実行に失敗しました。端末ログを確認してください。',
    },
  );
});

test('planning HTTP boundary requires a valid current plan and revision instruction together', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 def plan(self,_question,_answers,emit,analysis_plan=None,revision_instruction=None,**_kwargs):emit({"type":"plan","count":len(analysis_plan["panels"]),"instruction":revision_instruction})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
question="2021年1月の購入課題を分析するダッシュボードを作って"
def panel(index):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分別に出して","dimensions":["区分"],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
raw={"objective_summary":"購入課題を判断する","audience":"責任者","comparison":"月内比較","hypotheses":["差がある"],"clarifications":[],"panels":[panel(index) for index in range(1,7)]}
plan=m.planner.normalize_dashboard_plan(raw,question,m.period_for_question(question),{"audience":"責任者"})
def request(extra):
 data=json.dumps({"question":question,"profile":"ga4","answers":{"audience":"責任者"},**extra},ensure_ascii=False).encode()
 return urllib.request.Request(base+"/api/plan",data=data,headers={"content-type":"application/json","origin":base},method="POST")
try:
 valid=json.loads(urllib.request.urlopen(request({"analysis_plan":plan,"revision_instruction":"流入別を追加して"})).read().decode())
 statuses=[]
 for extra in [{"analysis_plan":plan},{"revision_instruction":"追加して"},{"analysis_plan":plan,"revision_instruction":"長"*501}]:
  try:urllib.request.urlopen(request(extra))
  except urllib.error.HTTPError as error:statuses.append(error.code)
 print(json.dumps({"valid":valid,"statuses":statuses},ensure_ascii=False))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    valid: { type: 'plan', count: 6, instruction: '流入別を追加して' },
    statuses: [400, 400, 400],
  });
});

test('Bitcoin planning and dashboard build keep one frozen profile across HTTP', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 def plan(self,_question,_answers,emit,**kwargs):emit({"type":"plan","profile":kwargs["profile"]})
 def dashboard(self,_question,emit,plan=None,**kwargs):emit({"type":"dashboard_complete","profile":kwargs["profile"],"plan_profile":plan["profile"]})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
question="2024年3月のBitcoin取引を分析するダッシュボードを作って"
period=m.data_source_profiles.profile_for("bitcoin").period_for_question(question)
raw={"objective_summary":"取引状況を判断する","audience":"分析担当者","comparison":"月内比較","hypotheses":["日ごとの差がある"],"clarifications":[],"panels":[{"title":"日別手数料","kpi":"手数料","chart":"line","decision":"変動を判断する","reason":"時系列で確認する","execution_prompt":"2024年3月の日別手数料を集計する","dimensions":["日付"],"measures":["手数料"],"layout_row":1,"layout_weight":1}]}
plan=m.planner.normalize_dashboard_plan(raw,question,period,{"audience":"分析担当者"},profile="bitcoin")
def request(path,profile,extra):
 data=json.dumps({"question":question,"profile":profile,"answers":{"audience":"分析担当者"},**extra},ensure_ascii=False).encode()
 return urllib.request.Request(base+path,data=data,headers={"content-type":"application/json","origin":base},method="POST")
try:
 proposed=json.loads(urllib.request.urlopen(request("/api/plan","bitcoin",{})).read().decode())
 built=json.loads(urllib.request.urlopen(request("/api/dashboard","bitcoin",{"analysis_plan":plan})).read().decode())
 mismatch=0
 try:urllib.request.urlopen(request("/api/dashboard","ga4",{"analysis_plan":plan}))
 except urllib.error.HTTPError as error:mismatch=error.code
 print(json.dumps({"proposed":proposed,"built":built,"mismatch":mismatch}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    proposed: { type: 'plan', profile: 'bitcoin' },
    built: { type: 'dashboard_complete', profile: 'bitcoin', plan_profile: 'bitcoin' },
    mismatch: 400,
  });
});

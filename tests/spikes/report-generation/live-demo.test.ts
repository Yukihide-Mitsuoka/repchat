import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LIVE = path.join(ROOT, 'spikes/report-generation/live_demo.py');
function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})\nimport live_demo as m\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}
test('live dry-run describes the paid localhost workflow', () => {
  const result = spawnSync('python3', [LIVE, '--project', 'example-project', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /live mode: enter a Japanese prompt/);
  assert.match(result.stdout, /call Vertex AI and BigQuery after each submitted prompt/);
  assert.match(result.stdout, /open http:\/\/127\.0\.0\.1:8765\//);
});
test('live startup prepares pinned dependencies before creating the engine', () => {
  const result = python(`
from pathlib import Path
calls=[]
m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
m.sys.executable="/usr/bin/python3"
m.sys.prefix=str(m.VENV_DIR)
m.sys.version_info=(3,13,0)
m.shutil.which=lambda _tool:"/usr/bin/gcloud"
m.require_adc=lambda:calls.append("adc")
m.venv_python=lambda:Path(m.sys.executable)
def prepare():
 calls.append("prepare")
 return Path(m.sys.executable)
m.prepare_python=prepare
m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
class Server:
 server_port=8765
 def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
 def server_close(self):calls.append("close")
m.create_server=lambda _host,_port,_engine:Server()
status=m.main()
print(json.dumps({"status":status,"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    calls: ['adc', 'prepare', 'engine', 'serve', 'close'],
  });
});
test('live startup re-enters the venv when executable symlinks share one target', () => {
  const result = python(`
import tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);base=root/"python";base.touch();system=root/"system-python";venv_python=root/"venv-python"
 system.symlink_to(base);venv_python.symlink_to(base);calls=[]
 m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
 m.sys.executable=str(system);m.sys.prefix=str(root/"system-prefix");m.sys.version_info=(3,13,0)
 m.shutil.which=lambda _tool:"/usr/bin/gcloud";m.require_adc=lambda:calls.append("adc")
 m.VENV_DIR=root/"demo-venv"
 m.prepare_python=lambda:(calls.append("prepare") or venv_python)
 m.run=lambda _command:calls.append("reexec")
 m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
 class Server:
  server_port=8765
  def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
  def server_close(self):calls.append("close")
 m.create_server=lambda _host,_port,_engine:Server()
 status=m.main()
 print(json.dumps({"status":status,"same_target":system.resolve()==venv_python.resolve(),"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    same_target: true,
    calls: ['adc', 'prepare', 'reexec'],
  });
});
test('live prompt uses an accessible in-page cost dialog before sending the request', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "copy":all(x in html for x in ["Vertex AI 約¥0.2","BigQuery 最大40 GiB","最大約¥38","合計最大約¥39","無料枠やキャッシュで0円"]),
 "dialog":all(x in html for x in ['<dialog id="cost-dialog"','aria-labelledby="cost-title"','id="cancel-cost"','id="confirm-cost"']),
 "actions":all(x in html for x in ['$("cost-dialog").showModal()','$("cost-dialog").close()','$("confirm-cost").onclick=runQuery']),
 "portable":"confirm(COST_CONFIRMATION)" not in html,
 "progress":all(x in html for x in ["生成の進行状況","実行前","質問を送信すると、ここに処理状況が表示されます。","SQLを作る","安全性を確認","データを取得","結果を可視化"])
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    copy: true,
    dialog: true,
    actions: true,
    portable: true,
    progress: true,
  });
});
test('live engine renders safe shapes, refuses undefined metrics, and caps fetched rows', () => {
  const result = python(`
import threading
from datetime import date
from decimal import Decimal
def engine():
 e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
 e.spec=json.loads((m.HERE/"report.json").read_text());e.rules="";e.client=e.bq=object();e.lock=threading.Lock();return e
sql="SELECT COUNT(DISTINCT user_pseudo_id) AS users FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate=lambda *_:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
limits=[];m.report.exec_bq=lambda *_args,**kw:(limits.append(kw.get("max_results")) or (([(94790,)],["users"]),None))
events=[];engine().query("2021年1月のユーザー数を出して",events.append)
m.report.generate=lambda *_:({"sql":"","reason":"未定義","undefined_terms":["直帰率"]},{"input_tokens":1,"output_tokens":1})
refusal=[];engine().query("2021年1月の直帰率を出して",refusal.append)
print(json.dumps({"shapes":[m.visualization_for_result([(1,)],["x"]),m.visualization_for_result([(date(2021,1,1),1)],["d","v"]),m.visualization_for_result([("a",Decimal("1"))],["k","v"])],"types":[x["type"] for x in events],"refusal":refusal[-1]["undefined_terms"],"limits":limits,"safe":"innerHTML" not in m.HTML and "textContent=e.sql" in m.HTML}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    shapes: ['scalar', 'line', 'bar'],
    types: ['stage', 'sql', 'stage', 'result'],
    refusal: ['直帰率'],
    limits: [101, null],
    safe: true,
  });
});
test('live HTTP boundary serves same-origin JSON and rejects unsafe requests and binds', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 spec=json.loads((m.HERE/"report.json").read_text())
 def query(self,q,emit):emit({"type":"result","rows":[[118380]],"columns":["sessions"],"visualization":"scalar","verification":"matched","verification_label":"照合済み","cost_jpy":0.1})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}";statuses=[]
try:
 page=urllib.request.urlopen(base+"/").read().decode()
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":"2021年1月のセッション数を出して"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 value=json.loads(urllib.request.urlopen(req).read().decode())["rows"][0][0]
 for ct,origin in [("text/plain",base),("application/json","https://attacker.example")]:
  try:urllib.request.urlopen(urllib.request.Request(base+"/api/query",data=b"{}",headers={"content-type":ct,"origin":origin},method="POST"))
  except urllib.error.HTTPError as e:statuses.append(e.code)
 print(json.dumps({"form":"日本語の問い合わせ" in page,"value":value,"statuses":statuses}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    form: true,
    value: 118380,
    statuses: [415, 403],
  });
  const bind = spawnSync(
    'python3',
    [LIVE, '--project', 'example-project', '--host', '0.0.0.0', '--no-open'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(bind.status, 2);
  assert.match(bind.stderr, /host must remain localhost-only/);
});

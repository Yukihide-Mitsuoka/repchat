import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNNER = path.join(ROOT, 'spikes/report-generation/verify_live_services.py');

function python(body: string) {
  return spawnSync(
    'python3',
    ['-c', `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(RUNNER))})\n${body}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('live verification requires an explicit cost gate before ADC or clients', () => {
  const result = python(`
import verify_live_services as v
v.require_adc=lambda: (_ for _ in ()).throw(AssertionError("ADC must not be checked"))
status=v.main(["--project","example-project","--dashboard-question","対象のダッシュボードを作成","--insight-question","対象を集計","--output","/private/tmp/repchat-test.json"])
print(status)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '2');
  assert.match(result.stderr, /--accept-cost/);
});

test('live verification preserves each selected profile through every paid operation', () => {
  const result = python(`
import verify_live_services as v
observed={}
v.require_adc=lambda:None
for profile in ("ga4","bitcoin"):
 calls=[]
 class Engine:
  def __init__(self,*args,**kwargs): pass
  def plan(self,question,answers,emit,**kwargs):
   calls.append(["plan",kwargs.get("profile")])
   emit({"type":"plan","plan":{"profile":profile,"revision":"plan-1"}})
  def dashboard(self,question,emit,**kwargs):
   calls.append(["dashboard",kwargs.get("profile")])
   assert kwargs["analysis_plan"]["profile"]==profile
   emit({"type":"dashboard_complete","build_revision":"build-1"})
  def consult(self,question,history,emit,**kwargs):
   calls.append(["consult",kwargs.get("profile")])
   emit({"type":"consultation","recommendations":[{"execution_prompt":question,"chart":"bar","title":"集計"}]})
  def query(self,question,emit,**kwargs):
   calls.append(["query",kwargs.get("profile")])
   emit({"type":"result","rows":[[1]]})
  def meeting_report(self,revision,emit):
   calls.append(["report",revision])
   emit({"type":"meeting_report"})
 v.live_demo.LiveQueryEngine=Engine
 args=v.parse_args(["--project","example-project","--profile",profile,"--dashboard-question","対象のダッシュボードを作成","--insight-question","対象を集計","--output","unused.json","--accept-cost"])
 record=v.run_verification(args)
 observed[profile]={"calls":calls,"status":record["status"],"profile":record["profile"]}
print(json.dumps(observed))
`);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  for (const profile of ['ga4', 'bitcoin']) {
    assert.deepEqual(observed[profile], {
      calls: [['plan', profile], ['dashboard', profile], ['consult', profile], ['query', profile], ['report', 'build-1']],
      status: 'complete', profile,
    });
  }
});

test('live verification requires explicit nonempty questions before creating clients', () => {
  const result = python(`
import verify_live_services as v
v.require_adc=lambda: (_ for _ in ()).throw(AssertionError("ADC must not be checked"))
for questions in ([],["--dashboard-question"," ","--insight-question","集計"],["--dashboard-question","作成","--insight-question",""]):
 try:
  args=v.parse_args(["--project","example-project","--output","unused.json","--accept-cost"]+questions)
  v.run_verification(args)
 except SystemExit as error:
  assert error.code==2
 else:
  raise AssertionError("invalid questions were accepted")
print("rejected")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'rejected');
});

test('quality record keeps contract metadata and excludes generated payloads', () => {
  const result = python(`
import json
import verify_live_services as v
summary=v.quality_summary([
 {"type":"sql","sql_sha256":"a"*16},
 {"type":"result","panel_id":"P1","columns":["page","count"],"rows":[["secret",4]],"visualization":"bar","verification":"unverified"},
 {"type":"dashboard_complete","cost_jpy":1.5},
], {"dashboard_complete"})
print(json.dumps(summary,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /secret/);
  assert.match(result.stdout, /"row_count": 1/);
  assert.match(result.stdout, /"sql_sha256s": \["aaaaaaaaaaaaaaaa"\]/);
});

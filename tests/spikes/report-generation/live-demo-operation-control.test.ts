import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LIVE = path.join(ROOT, 'spikes/report-generation/live_demo.py');

function python(body: string) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})\nimport live_demo as m\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  return result;
}

const OPERATIONS = {
  query: 'result',
  consult: 'consultation',
  dashboard: 'dashboard_complete',
  meeting_report: 'meeting_report',
  plan: 'plan',
} as const;

// Keep real workflows and validation; replace only paid generation/execution boundaries.
const ENGINE_FIXTURE = `
import threading
QUESTION="2021年1月の購入件数を集計する"
DASHBOARD_QUESTION="2021年1月のダッシュボードを作成する"
SPEC={"title":"購入規模","objective":"規模を把握する","dimensions":[],"measures":["購入件数"],"comparison":"単月","chart":"scorecard","execution_prompt":QUESTION,"reason":"基準値を確認する"}
raw={"objective_summary":"購入規模を把握する","audience":"分析担当者","comparison":"単月","hypotheses":["購入規模に変化がある"],"clarifications":[],"panels":[{"title":"購入規模","kpi":"購入件数","chart":"scorecard","decision":"規模を把握する","reason":"基準値を確認する","execution_prompt":QUESTION,"dimensions":[],"measures":["購入件数"],"layout_row":1,"layout_weight":100}]}
PLAN=m.planner.normalize_dashboard_plan(raw,DASHBOARD_QUESTION,m.period_for_question(QUESTION),{"audience":"分析担当者"})
USAGE={"input_tokens":1,"output_tokens":1}
m.planner.propose_consultation=lambda *_args,**_kwargs:({},USAGE)
m.planner.propose_dashboard=lambda *_args,**_kwargs:(PLAN,USAGE)
m.meeting.generate=lambda *_args,**_kwargs:({},USAGE)

def execute(_section,_period,emit,*_args,**_kwargs):
 emit({"type":"result","columns":["購入件数"],"rows":[[1]],"visualization":"scalar","verification":"unverified"})
 return 0.0

def new_engine():
 engine=object.__new__(m.LiveQueryEngine)
 engine.lock=threading.Lock()
 engine.operation_state_lock=threading.Lock()
 engine.active_request_id=engine.active_cancel_event=engine.active_done_event=None
 engine.model=m.report.DEFAULT_MODEL
 engine.client=object()
 engine.metrics=""
 engine.metric_definitions={}
 engine.latest_dashboard={"build_revision":"build-existing"}
 engine._run_section=execute
 return engine

def invoke(engine,operation,emit,request_id):
 return {
  "query":lambda:engine.query(QUESTION,emit,analysis_specification=SPEC,request_id=request_id),
  "consult":lambda:engine.consult(QUESTION,[],emit,request_id=request_id),
  "dashboard":lambda:engine.dashboard(DASHBOARD_QUESTION,emit,analysis_plan=PLAN,request_id=request_id),
  "meeting_report":lambda:engine.meeting_report("build-existing",emit,request_id=request_id),
  "plan":lambda:engine.plan(DASHBOARD_QUESTION,{},emit,request_id=request_id),
 }[operation]()
`;

for (const operation of Object.keys(OPERATIONS) as (keyof typeof OPERATIONS)[]) {
  const terminalEvent = OPERATIONS[operation];
  const fixture = `${ENGINE_FIXTURE}\noperation=${JSON.stringify(operation)}\ne=new_engine()\n`;

  test(`${operation} releases its request after completion and allows the next request`, () => {
    const result = python(`${fixture}
events=[]
invoke(e,operation,events.append,"first-request")
first=events[-1]["type"]
finished_cancel=e.cancel("first-request")
invoke(e,operation,events.append,"next-request")
print(json.dumps({"first":first,"next":events[-1]["type"],"finished_cancel":finished_cancel}))
`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      first: terminalEvent,
      next: terminalEvent,
      finished_cancel: false,
    });
  });

  test(`${operation} preserves a delivery exception and permits a new request`, () => {
    const result = python(`${fixture}
failure=RuntimeError("event delivery failed")
def fail_delivery(_event):raise failure
preserved=False
try:invoke(e,operation,fail_delivery,"failed-request")
except RuntimeError as error:preserved=error is failure
finished_cancel=e.cancel("failed-request")
events=[]
invoke(e,operation,events.append,"recovery-request")
print(json.dumps({"preserved":preserved,"finished_cancel":finished_cancel,"next":events[-1]["type"]}))
`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      preserved: true,
      finished_cancel: false,
      next: terminalEvent,
    });
  });

  test(`${operation} rejects every second operation while keeping the active request usable`, () => {
    const result = python(`${fixture}
errors={};events=[];checked=False
def observe(event):
 global checked
 events.append(event)
 if checked:return
 checked=True
 for nested in ${JSON.stringify(Object.keys(OPERATIONS))}:
  try:invoke(e,nested,lambda _event:None,"second-request")
  except m.LiveDemoError as error:errors[nested]=str(error)
invoke(e,operation,observe,"active-request")
first=events[-1]["type"]
invoke(e,operation,events.append,"recovery-request")
print(json.dumps({"errors":errors,"first":first,"next":events[-1]["type"]},ensure_ascii=False))
`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      errors: Object.fromEntries(
        Object.keys(OPERATIONS).map((name) => [
          name,
          '別の問い合わせを処理中です。完了後に再送してください。',
        ]),
      ),
      first: terminalEvent,
      next: terminalEvent,
    });
  });

  test(`${operation} preserves its public error and permits recovery`, () => {
    const result = python(`${fixture}
def fail_generation(*_args,**_kwargs):
 raise m.planner.PlannerError("分析失敗",suggested_instruction="対象条件を確認してください。")
consult=m.planner.propose_consultation;plan=m.planner.propose_dashboard
m.planner.propose_consultation=m.planner.propose_dashboard=fail_generation
invalid={
 "query":lambda:e.query(QUESTION,lambda _event:None,request_id="invalid-request"),
 "dashboard":lambda:e.dashboard(DASHBOARD_QUESTION,lambda _event:None,request_id="invalid-request"),
 "meeting_report":lambda:e.meeting_report("missing-build",lambda _event:None,request_id="invalid-request"),
 "consult":lambda:invoke(e,"consult",lambda _event:None,"invalid-request"),
 "plan":lambda:invoke(e,"plan",lambda _event:None,"invalid-request"),
}
observed=None
try:invalid[operation]()
except m.LiveDemoError as error:observed={"message":str(error),"suggestion":error.suggested_instruction}
finally:m.planner.propose_consultation=consult;m.planner.propose_dashboard=plan
finished_cancel=e.cancel("invalid-request")
events=[]
invoke(e,operation,events.append,"recovery-request")
print(json.dumps({"error":observed,"finished_cancel":finished_cancel,"next":events[-1]["type"]},ensure_ascii=False))
`);
    assert.equal(result.status, 0, result.stderr);
    const message = {
      query: 'AIが作成した分析仕様を選択してからbuildしてください。',
      dashboard: 'AIが作成した分析仕様を確定してからbuildしてください。',
      meeting_report: '指定したbuild revisionの根拠bundleがありません。',
      consult: '分析失敗',
      plan: '分析失敗',
    }[operation];
    assert.deepEqual(JSON.parse(result.stdout), {
      error: {
        message,
        suggestion:
          operation === 'consult' || operation === 'plan' ? '対象条件を確認してください。' : null,
      },
      finished_cancel: false,
      next: terminalEvent,
    });
  });
}

test('cancelling an active request releases the server operation lock', () => {
  const result = python(`
import threading,time
e=object.__new__(m.LiveQueryEngine);e.lock=threading.Lock();e.operation_state_lock=threading.Lock();e.active_request_id=e.active_cancel_event=e.active_done_event=None
token=e._begin_operation("request-123456789012-abcd");cancelled=[]
thread=threading.Thread(target=lambda:cancelled.append(e.cancel("request-123456789012-abcd")));thread.start()
for _ in range(100):
 if token.is_set():break
 time.sleep(.001)
observed=token.is_set();e._finish_operation();thread.join()
available=e.lock.acquire(blocking=False)
if available:e.lock.release()
print(json.dumps({"observed":observed,"cancelled":cancelled,"available":available}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    observed: true,
    cancelled: [true],
    available: true,
  });
});

test('composer becomes a stop control and prevents a second submission while streaming', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  for (const expected of [
    'new AbortController()',
    'function stopActiveRequest()',
    'function setComposerSubmitIcon(stopping)',
    'setComposerSubmitIcon(true)',
    'setComposerSubmitIcon(false)',
    '$("composer-input").disabled=true',
    'if(activeRequest){stopActiveRequest();return}',
    'request_id:operation.requestId',
  ]) {
    assert.ok(script.includes(expected), `missing in-flight composer contract: ${expected}`);
  }
  assert.match(rendered.stdout, /#composer-submit svg\{display:block;width:16px;height:16px\}/);
});

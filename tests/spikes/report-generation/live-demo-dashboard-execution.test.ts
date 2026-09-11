import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

test('planning calls Vertex only and preserves AI-authored dashboard panels', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.metrics="metrics";e.client=object();e.lock=threading.Lock()
def panel(index):return {"id":f"P{index}","title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を1行で出して","dimensions":[],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
raw={"status":"proposed","objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"目的","audience":"責任者","comparison":"月内比較","period":m.period_for_question("2021年1月"),"hypotheses":["仮説"],"clarifications":[],"answers":{"audience":"責任者"},"organization_context_revision":"demo-org-ec-v1","panels":[panel(index) for index in range(1,7)],"revision":"plan-test"}
calls=[]
m.planner.propose_dashboard=lambda *_args,**_kwargs:(calls.append("vertex") or (raw,{"input_tokens":10,"output_tokens":5}))
events=[];e.plan(raw["objective"],raw["answers"],events.append)
confirmed=m.planner.confirm_dashboard_plan(raw)
period,sections=m.dashboard_sections_for_plan(raw["objective"],confirmed)
print(json.dumps({"calls":calls,"events":[event["type"] for event in events],"ids":[section["id"] for section in sections],"period":period["label"],"confirmed":confirmed["status"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: ['vertex'],
    events: ['plan_stage', 'plan'],
    ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    period: '2021年1月',
    confirmed: 'confirmed',
  });
});

test('dashboard build has no fixed-catalog fallback without an AI-authored plan', () => {
  const result = python(`
import inspect,threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object();e.lock=threading.Lock();e.latest_dashboard=None
m.report.generate_request=lambda *_args,**_kwargs:({"sql":"","reason":"unused","undefined_terms":["unused"]},{"input_tokens":1,"output_tokens":1})
events=[];error=""
try:e.dashboard("2021年1月のECサイト分析ダッシュボードを作って",events.append)
except m.LiveDemoError as caught:error=str(caught)
removed=all(not hasattr(m,name) for name in ["DASHBOARD_PURPOSES","DASHBOARD_ROW_TEMPLATES","dashboard_sections","dashboard_layout_rows","confirm_dashboard_analysis_plan"])
planner_removed=all(not hasattr(m.planner,name) for name in ["PANEL_CATALOG","planning_request","normalize_plan","propose","confirm_plan"])
layout_source=inspect.getsource(m.dashboard_layout_rows_for_plan)
layout_is_ai_authored=all(value not in layout_source for value in ["panel.get('chart')","full_width_charts","weights ="])
print(json.dumps({"error":error,"events":[event["type"] for event in events],"removed":removed,"planner_removed":planner_removed,"layout_is_ai_authored":layout_is_ai_authored},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: 'AIが作成した分析仕様を確定してからbuildしてください。',
    events: [],
    removed: true,
    planner_removed: true,
    layout_is_ai_authored: true,
  });
});

test('planning sends the selected current plan and revision instruction back to the AI', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.metrics="metrics";e.client=object();e.lock=threading.Lock()
def panel(index):return {"id":f"P{index}","title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分別に出して","dimensions":["区分"],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
raw={"status":"proposed","objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"目的","audience":"責任者","comparison":"月内比較","period":m.period_for_question("2021年1月"),"hypotheses":["仮説"],"clarifications":[],"answers":{"audience":"責任者"},"organization_context_revision":"demo-org-ec-v1","panels":[panel(index) for index in range(1,7)],"revision":"plan-test"}
calls=[]
def propose(*_args,**kwargs):
 calls.append({"count":len(kwargs["current_plan"]["panels"]),"instruction":kwargs["instruction"],"status":kwargs["current_plan"]["status"]})
 return raw,{"input_tokens":10,"output_tokens":5}
m.planner.propose_dashboard=propose
events=[];e.plan(raw["objective"],raw["answers"],events.append,analysis_plan=raw,revision_instruction="流入別パネルを追加して")
print(json.dumps({"calls":calls,"events":[event["type"] for event in events]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: [{ count: 6, instruction: '流入別パネルを追加して', status: 'confirmed' }],
    events: ['plan_stage', 'plan'],
  });
});

test('a confirmed dynamic dashboard plan builds its authored specifications', () => {
  const result = python(`
def panel(title,chart,prompt,row,weight):
 dimension=[] if chart=="scorecard" else (["日別"] if chart=="line" else ["medium"] if "medium" in prompt else ["デバイス"])
 return {"title":title,"kpi":"購入件数","chart":chart,"decision":"意思決定","reason":"目的に必要","execution_prompt":prompt,"dimensions":dimension,"measures":["購入件数"],"layout_row":row,"layout_weight":weight}
question="2021年1月の購入課題を分析するダッシュボードを作って"
raw={"objective_summary":"購入課題を判断する","audience":"責任者","comparison":"軸間比較","hypotheses":["差がある"],"clarifications":[],"panels":[
 panel("流入別購入","bar","2021年1月の購入件数をmedium別に出して",1,1),
 panel("日別購入","line","2021年1月の日別購入件数を出して",1,3),
 panel("デバイス別購入","bar","2021年1月の購入件数をデバイス別に出して",2,1),
 panel("購入規模","scorecard","2021年1月の購入件数を出して",2,1),
]}
plan=m.planner.normalize_dashboard_plan(raw,question,m.period_for_question(question),{"audience":"責任者"})
confirmed=m.planner.confirm_dashboard_plan(plan)
period,sections=m.dashboard_sections_for_plan(question,confirmed)
print(json.dumps({"period":period["label"],"ids":[item["id"] for item in sections],"titles":[item["title"] for item in sections],"prompts":[item["text"] for item in sections],"layouts":m.dashboard_layout_rows_for_plan(confirmed["panels"])},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    period: '2021年1月',
    ids: ['P1', 'P2', 'P3', 'P4'],
    titles: ['流入別購入', '日別購入', 'デバイス別購入', '購入規模'],
    prompts: [
      '2021年1月の購入件数をmedium別に出して',
      '2021年1月の日別購入件数を出して',
      '2021年1月の購入件数をデバイス別に出して',
      '2021年1月の購入件数を出して',
    ],
    layouts: [
      { panel_ids: ['P1', 'P2'], shares: [25, 75] },
      { panel_ids: ['P3', 'P4'], shares: [50, 50] },
    ],
  });
});

test('dashboard SQL and dry-run schema are checked against the AI chart contract', () => {
  const result = python(`
panel={"id":"P1","title":"イベント別比較","chart":"grouped_bar","decision":"判断","execution_prompt":"2021年1月を比較","dimensions":["イベント"],"measures":["時間","人数"]}
section=m.planned_analysis_section(panel)
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
safe="SELECT event_name AS category, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(DISTINCT user_pseudo_id) AS metric_2 FROM "+table+" GROUP BY category ORDER BY metric_1 DESC LIMIT 20"
m.validate_generated_dashboard_sql(section,safe)
m.validate_dashboard_dry_run_schema(section,[("category","STRING"),("metric_1","INT64"),("metric_2","INT64")])
errors=[]
for sql in [
 "SELECT event_name, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY event_name ORDER BY metric_1 DESC LIMIT 20",
 "SELECT event_name AS category, SUM(engagement_time) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY category ORDER BY metric_1 DESC LIMIT 20",
 "SELECT event_name AS category, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY category",
]:
 try:m.validate_generated_dashboard_sql(section,sql)
 except m.LiveDemoError as error:errors.append(str(error))
try:m.validate_dashboard_dry_run_schema(section,[("category","STRING"),("metric_1","STRING"),("metric_2","INT64")])
except m.LiveDemoError as error:errors.append(str(error))
print(json.dumps({"safe":True,"errors":errors},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.safe, true);
  assert.equal(output.errors.length, 4);
  assert.match(output.errors[0], /別名なし/);
  assert.match(output.errors[1], /NULLを返し得る/);
  assert.match(output.errors[2], /ORDER BYとLIMIT 20以下/);
  assert.match(output.errors[3], /dry run出力/);
});

test('dashboard dry-run mismatch is repaired once and still stops before paid execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"購入規模","chart":"scorecard","decision":"判断","execution_prompt":"2021年1月の購入件数","dimensions":[],"measures":["購入件数"]})
tick=chr(96);sql="SELECT COUNT(*) AS metric_value FROM "+tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate_request=lambda *_args,**_kwargs:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
repairs=[]
m.report.repair=lambda *_args,**_kwargs:(repairs.append(True) or ({"sql":sql,"reason":"型を修正できない","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","STRING")],None)
executions=[];m.report.exec_bq=lambda *_args,**_kwargs:(executions.append(True) or (([],[]),None))
try:e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},lambda _event:None,{"panel_id":"P1"})
except m.LiveDemoError as error:message=str(error)
print(json.dumps({"message":message,"repairs":len(repairs),"executions":executions},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).message, /1回修正しましたが/);
  assert.equal(JSON.parse(result.stdout).repairs, 1);
  assert.deepEqual(JSON.parse(result.stdout).executions, []);
});

test('dashboard period mismatch is repaired once before BigQuery execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"流入別セッション","chart":"bar","decision":"判断","execution_prompt":"2021年1月の流入別セッション","dimensions":["流入元"],"measures":["セッション数"]})
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
initial="SELECT traffic_source.medium AS category, COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' GROUP BY category ORDER BY metric_value DESC LIMIT 30"
repaired="SELECT traffic_source.medium AS category, COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY category ORDER BY metric_value DESC LIMIT 30"
m.report.generate_request=lambda *_args,**_kwargs:({"sql":initial,"reason":"初回","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
diagnostics=[]
m.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({"sql":repaired,"reason":"期間を修正","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:([("category","STRING"),("metric_value","INT64")],None)
executed=[]
m.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or (([("organic",12)], ["category","metric_value"]),None))
events=[];e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},events.append,{"operation":"dashboard","panel_id":"P1"})
print(json.dumps({"diagnostics":diagnostics,"executed":executed,"stages":[event.get("stage") for event in events if event["type"]=="stage"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.diagnostics[0], /生成SQLの対象期間/);
  assert.equal(output.executed.length, 1);
  assert.match(output.executed[0], /20210101.*20210131/);
  assert.deepEqual(output.stages, ['generate', 'validate', 'repair', 'execute']);
});

test('within-month comparison repair receives the exact full-period suffix contract', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"デバイス別購入比較","chart":"comparison_table","decision":"判断","execution_prompt":"2021年1月のデバイス別購入件数を月前半と月後半で比較する","dimensions":["デバイス"],"measures":["購入件数"]})
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
current="COUNTIF(event_name = 'purchase' AND event_date BETWEEN '20210116' AND '20210131')"
comparison="COUNTIF(event_name = 'purchase' AND event_date BETWEEN '20210101' AND '20210115')"
select="SELECT device.category AS dimension_1, "+current+" AS current_value, "+comparison+" AS comparison_value, "+current+" - "+comparison+" AS delta_value FROM "+table
initial=select+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210115' GROUP BY dimension_1 ORDER BY delta_value DESC LIMIT 100"
repaired=select+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY dimension_1 ORDER BY delta_value DESC LIMIT 100"
m.report.generate_request=lambda *_args,**_kwargs:({"sql":initial,"reason":"月前半だけをscan","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
diagnostics=[]
def repair(_client,_model,_request,_sql,diagnostic,_rules):
 diagnostics.append(diagnostic)
 actionable="_TABLE_SUFFIX BETWEEN '20210101' AND '20210131'" in diagnostic and "条件付き集約" in diagnostic
 return ({"sql":repaired if actionable else initial,"reason":"期間を修正","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
m.report.repair=repair
m.report.inspect_bq_schema=lambda *_args,**_kwargs:([("dimension_1","STRING"),("current_value","INT64"),("comparison_value","INT64"),("delta_value","INT64")],None)
executed=[];m.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or ((("mobile",3,2,1),),["dimension_1","current_value","comparison_value","delta_value"]))
e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},lambda _event:None,{"operation":"dashboard","panel_id":"P1"})
print(json.dumps({"diagnostics":diagnostics,"executed":executed},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.diagnostics.length, 1);
  assert.match(output.diagnostics[0], /_TABLE_SUFFIX BETWEEN '20210101' AND '20210131'/);
  assert.match(output.diagnostics[0], /条件付き集約/);
  assert.equal(output.executed.length, 1);
});

test('a compiler dry-run diagnostic is repaired before paid execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"購入規模","chart":"scorecard","decision":"判断","execution_prompt":"2021年1月の購入件数","dimensions":[],"measures":["購入件数"]})
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
initial="SELECT COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
repaired="WITH base AS (SELECT user_pseudo_id FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131') SELECT COUNT(*) AS metric_value FROM base"
m.report.generate_request=lambda *_args,**_kwargs:({"sql":initial,"reason":"初回","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
diagnostics=[]
m.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({"sql":repaired,"reason":"CTEへ修正","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
dry_runs=[]
def inspect(_bq,sql,**_kwargs):
 dry_runs.append(sql)
 return (None,"bq dry-run error: BadRequest: Correlated subqueries are not supported") if len(dry_runs)==1 else ([("metric_value","INT64")],None)
m.report.inspect_bq_schema=inspect
executed=[];m.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or (([(12,)], ["metric_value"]),None))
events=[];e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},events.append,{"panel_id":"P1"})
print(json.dumps({"diagnostics":diagnostics,"dry_runs":dry_runs,"executed":executed,"stages":[event.get("stage") for event in events if event["type"]=="stage"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.diagnostics[0], /Correlated subqueries/);
  assert.equal(output.dry_runs.length, 2);
  assert.deepEqual(output.executed, [output.dry_runs[1]]);
  assert.deepEqual(output.stages, ['generate', 'validate', 'repair', 'execute']);
});

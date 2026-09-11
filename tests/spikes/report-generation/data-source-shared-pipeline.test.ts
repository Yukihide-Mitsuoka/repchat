import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, python } from './live-demo-test-helpers.ts';

test('GA4 and Bitcoin expose only data-source contracts to one shared pipeline', () => {
  const result = python(`
import data_source_profiles as profiles
observed={}
for key in profiles.profile_keys():
 source=profiles.profile_for(key)
 observed[key]={
  "key":source.key,
  "dataset":source.allowed_dataset,
  "context":source.planner_context("defined metrics"),
  "rules":source.sql_rules("defined metrics"),
 }
print(json.dumps({
 "keys":list(profiles.profile_keys()),
 "ga4_dataset":observed["ga4"]["dataset"],
 "bitcoin_dataset":observed["bitcoin"]["dataset"],
 "ga4_schema":"events_*" in observed["ga4"]["context"],
 "bitcoin_schema":"outputs ARRAY<STRUCT" in observed["bitcoin"]["context"],
 "no_analysis_catalog":all(not hasattr(source,name) for source in profiles.all_profiles() for name in ["panels","queries","examples"]),
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    keys: ['ga4', 'bitcoin'],
    ga4_dataset: 'bigquery-public-data.ga4_obfuscated_sample_ecommerce',
    bitcoin_dataset: 'bigquery-public-data.crypto_bitcoin',
    ga4_schema: true,
    bitcoin_schema: true,
    no_analysis_catalog: true,
  });
});

test('Bitcoin dashboard planning uses its schema and freezes the selected profile', () => {
  const result = python(`
import analysis_workflows as workflows
import data_source_profiles as profiles
source=profiles.profile_for("bitcoin")
question="2024年1月のBitcoin取引構造を判断するダッシュボードを作って"
calls=[]
def propose(_client,_model,objective,period,context,answers,**kwargs):
 calls.append({"objective":objective,"period":period,"context":context,"profile":kwargs["profile"]})
 return ({"profile":"bitcoin","revision":"plan-bitcoin"},{"input_tokens":1,"output_tokens":1})
workflows.planner.propose_dashboard=propose
events=[]
workflows.plan_dashboard(
 object(),workflows.report.DEFAULT_MODEL,"ga4 metrics",question,{},events.append,
 analysis_plan=None,revision_instruction=None,source=source,check_cancelled=lambda:None,
)
print(json.dumps({"calls":calls,"plan":events[-1]["plan"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.calls[0].profile, 'bitcoin');
  assert.equal(output.calls[0].period.partition, '2024-01-01');
  assert.match(output.calls[0].context, /crypto_bitcoin\.transactions/);
  assert.doesNotMatch(output.calls[0].context, /GA4 export/);
  assert.equal(output.plan.profile, 'bitcoin');
});

test('one section executor changes behavior only through the selected data-source contract', () => {
  const result = python(`
import data_source_profiles as profiles
import section_execution as execution
usage={"input_tokens":1,"output_tokens":1}
tick=chr(96)
cases={}
for key,period,sql in [
 ("ga4",{"from":"20210101","to":"20210131","label":"2021年1月"},"SELECT COUNT(*) AS metric_value FROM "+tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"),
 ("bitcoin",{"from":"2024-01-01","to":"2024-01-31","partition":"2024-01-01","label":"2024年1月"},"SELECT COUNT(*) AS metric_value FROM "+tick+"bigquery-public-data.crypto_bitcoin.transactions"+tick+" WHERE block_timestamp_month = DATE '2024-01-01'"),
]:
 source=profiles.profile_for(key);generated=[];executed=[]
 execution.report.generate_request=lambda _client,_model,request,rules:(generated.append((request,rules)) or ({"sql":sql,"reason":"集計","undefined_terms":[]},usage))
 execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
 execution.report.exec_bq=lambda _bq,query,**kwargs:(executed.append((query,kwargs)) or (([(1,)], ["metric_value"]),None))
 execution.visualization_results.dashboard_visualization=lambda *_args:"scalar"
 events=[]
 section={"title":"対象","text":"対象を集計","planned_visualization":"scorecard","shape":{"columns":["値"],"rows":"1行"},"source_columns":["metric_value"]}
 execution.run_section(section,period,events.append,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,source=source,max_result_rows=10)
 cases[key]={"allowed":executed[0][1]["allowed_dataset"],"generated":len(generated),"results":len([event for event in events if event["type"]=="result"])}
print(json.dumps(cases,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ga4: {
      allowed: 'bigquery-public-data.ga4_obfuscated_sample_ecommerce',
      generated: 1,
      results: 1,
    },
    bitcoin: {
      allowed: 'bigquery-public-data.crypto_bitcoin',
      generated: 1,
      results: 1,
    },
  });
  const source = readFileSync(
    path.join(ROOT, 'spikes/report-generation/section_execution.py'),
    'utf8',
  );
  assert.doesNotMatch(source, /profile\s*==\s*["']bitcoin["']/);
  assert.doesNotMatch(source, /bitcoin_rules/);
});

test('dashboard UI sends the selected profile through planning and confirmed build', () => {
  const result = python('print(m.HTML)');
  assert.equal(result.status, 0, result.stderr);
  const html = result.stdout;
  assert.match(html, /\["consult","insight","dashboard"\]\.includes\(action\)/);
  assert.match(html, /stream\("\/api\/plan",q,handlePlan,profile/);
  assert.match(html, /stream\("\/api\/dashboard",q,handleDashboard,profile/);
  assert.doesNotMatch(html, /stream\("\/api\/(?:plan|dashboard)"[^\n]*,"ga4"/);
});

test('planner asks for human-readable display fields instead of SQL expressions', () => {
  const result = python(`
import analysis_planner_prompts as prompts
request=prompts.build_consultation_request("月別に集計して",[],"schema","bitcoin")
print(json.dumps({"display_rule":"SQL関数やSQL式ではなく、人が読める表示名" in request},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { display_rule: true });
});

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

test('GA4 profile builds its current contract from metadata without querying rows', () => {
  const result = python(`
import data_source_profiles as profiles
class Listed:
 def __init__(self,table_id):self.table_id=table_id
class Table:
 def __init__(self,table_id):self.table_id=table_id
 def to_api_repr(self):
  return {"tableReference":{"projectId":"bigquery-public-data","datasetId":"ga4_obfuscated_sample_ecommerce","tableId":self.table_id},"type":"TABLE","location":"US","schema":{"fields":[{"name":"event_date","type":"STRING","mode":"NULLABLE"}]},"requirePartitionFilter":False}
class BigQuery:
 def __init__(self):self.operations=[]
 def list_tables(self,dataset,**kwargs):
  self.operations.append(("list",dataset,kwargs));return [Listed(f"events_202101{day:02d}") for day in range(1,32)]
 def get_table(self,name,**kwargs):
  self.operations.append(("get",name,kwargs));return Table(name.rsplit(".",1)[1])
 def query(self,*_args,**_kwargs):raise AssertionError("row query is forbidden")
bq=BigQuery();source=profiles.profile_for("ga4").with_current_contract(
 bq,{"from":"20210101","to":"20210131","label":"2021年1月"},
 {"grain":{},"metrics":{},"dimensions":{}},25,
)
content=source.analysis_contract.content()
print(json.dumps({
 "table":content["schema"]["metadata"]["tables"][0]["table"],
 "business_time":content["period"]["business_time"]["field"],
 "maximum_result_rows":content["limits"]["maximum_result_rows"],
 "operations":[item[0] for item in bq.operations],
 "bitcoin_bound":profiles.profile_for("bitcoin").with_current_contract(object(),{}, {},25).analysis_contract is not None,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    table: 'bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*',
    business_time: '_TABLE_SUFFIX',
    maximum_result_rows: 25,
    operations: ['list', ...Array(31).fill('get')],
    bitcoin_bound: false,
  });
});

test('one bound common contract reaches the actual planner and SQL generation paths', () => {
  const result = python(`
import hashlib
import analysis_workflows as workflows
import data_source_profiles as profiles
import section_execution as execution
from analysis_contract import AnalysisContract,fingerprint_contract_content
table="bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"
content={"version":1,"schema":{"fingerprint":"schema-a","retrieved_at":"2026-09-12T00:00:00+00:00","metadata":{"version":1,"tables":[{"table":table}]}},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":{"business_time":{"table":table,"field":"_TABLE_SUFFIX"},"timezone":"UTC","range":{"start":"2021-01-01","end":"2021-01-31"},"partitions":[{"table":table,"field":"_TABLE_SUFFIX"}]},"limits":{"maximum_bytes_billed":100,"maximum_result_rows":10}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
original=profiles.profile_for("ga4");source=original.with_contract(contract)
planning=[]
def propose(_client,_model,objective,period,context,answers,**kwargs):
 planning.append(context);return ({"profile":"ga4","revision":"plan-bound"},{"input_tokens":1,"output_tokens":1})
workflows.planner.propose_dashboard=propose
workflows.plan_dashboard(object(),workflows.report.DEFAULT_MODEL,"legacy metrics","2021年1月のダッシュボードを作って",{},lambda _event:None,analysis_plan=None,revision_instruction=None,source=source,check_cancelled=lambda:None)
sql="SELECT COUNT(*) AS metric_value FROM "+chr(96)+table+chr(96)+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
generated=[]
execution.report.generate_request=lambda _client,_model,request,rules:(generated.append(rules) or ({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
execution.report.exec_bq=lambda *_args,**_kwargs:(([(1,)], ["metric_value"]),None)
execution.visualization_results.dashboard_visualization=lambda *_args:"scalar"
section={"title":"対象","text":"対象を集計","planned_visualization":"scorecard","shape":{"columns":["値"],"rows":"1行"},"source_columns":["metric_value"]}
execution.run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},lambda _event:None,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,source=source,max_result_rows=10)
errors=[]
other=json.loads(encoded);other["schema"]["metadata"]["tables"][0]["table"]="bigquery-public-data.crypto_bitcoin.transactions"
other_encoded=json.dumps(other,ensure_ascii=False,sort_keys=True,separators=(",",":"))
for candidate in (AnalysisContract(encoded,"0"*64),AnalysisContract(other_encoded,fingerprint_contract_content(other))):
 try:original.with_contract(candidate)
 except ValueError as error:errors.append(str(error))
 else:raise AssertionError("unsafe contract binding accepted")
print(json.dumps({"planner":planning[0],"sql":generated[0],"fingerprint":contract.fingerprint,"original":"CREATE TABLE" in original.planner_context(""),"bound_contract":source.analysis_contract.fingerprint,"errors":errors},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.planner, new RegExp(output.fingerprint));
  assert.match(output.sql, new RegExp(output.fingerprint));
  assert.doesNotMatch(output.planner, /CREATE TABLE/);
  assert.doesNotMatch(output.sql, /CREATE TABLE/);
  assert.equal(output.original, true);
  assert.equal(output.bound_contract, output.fingerprint);
  assert.equal(output.errors.length, 2);
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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');
const REPORT_GENERATION = path.join(ROOT, 'spikes/report-generation');

function python(body: string) {
  return spawnSync('python3', ['-c', fixture + body], { cwd: ROOT, encoding: 'utf8' });
}

const fixture = String.raw`
import hashlib,json,sys
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path[:0]=[${JSON.stringify(EVALUATION)},${JSON.stringify(REPORT_GENERATION)}]
from analysis_contract import compile_contract
from bigquery_schema_snapshot import SchemaSnapshot
from bigquery_scope_discovery import DiscoverySnapshot
from diagnostic_preflight import DiagnosticPreflightError,prepare_diagnostic_preflights
import diagnostic_manifest_runtime as diagnostic_runtime
from diagnostic_manifest_runtime import _diagnostic_rendering_runner
from manifest_artifacts import RunMeasurement,run_measured_manifest_evaluation

def canonical(value):
 return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(value):
 return hashlib.sha256(value).hexdigest()
metadata={'version':1,'tables':[{'table':'project.dataset.records','fields':[{'name':'amount','type':'INTEGER','mode':'NULLABLE'}]}]}
retrieved_at='2026-09-25T00:00:00+00:00'
metadata_json=canonical(metadata)
schema=SchemaSnapshot(metadata_json,sha(metadata_json.encode()),retrieved_at)
scope_content={'version':1,'schema':{'fingerprint':schema.fingerprint,'metadata':metadata},'tables':[],'limits':{}}
scope_json=canonical(scope_content)
snapshot=DiscoverySnapshot(scope_json,sha(scope_json.encode()),retrieved_at)
contract=compile_contract(schema,{'grain':{},'metrics':{},'dimensions':{},'relationships':[]},None,{'maximum_bytes_billed':100,'maximum_result_rows':10})
manifest={'version':1,'evaluation_plan_sha256':'0'*64,'pipeline':{'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64},'schemas':[{'schema_id':'schema-a','authorized_scope':{'datasets':['project.dataset'],'tables':['project.dataset.records']},'cases':[{'case_id':'case-a','question':'合計を求める','run_ids':['run-1','run-2']}]}]}
snapshots={'version':1,'snapshots':[{'schema_id':'schema-a','content_json':scope_json,'retrieved_at':retrieved_at}]}
contracts={'version':1,'contracts':[{'schema_id':'schema-a','case_id':'case-a','content_json':contract.content_json}]}
snapshot_bytes=canonical(snapshots).encode();contract_bytes=canonical(contracts).encode()
reviews={'version':2,'scope_snapshots_sha256':sha(snapshot_bytes),'analysis_contracts_sha256':sha(contract_bytes),'reviews':[{'schema_id':'schema-a','case_id':'case-a','contract_fingerprint':contract.fingerprint,'author_id':'author','reviewer_id':'reviewer','reviewed_at':'2026-09-25T01:00:00+00:00'}]}
cases=prepare_diagnostic_preflights(manifest,snapshot_bytes,contract_bytes,canonical(reviews).encode())
`;

test('planning-stopped reviewed runs retain their contract in private artifacts', () => {
  const result = python(String.raw`
calls=[]
def discover(_bq,_scope):
 calls.append('discover')
 return DiscoverySnapshot(snapshot.content_json,snapshot.fingerprint,'2026-09-26T00:00:00+00:00')
def plan(_vertex,_model,_question,_context,_emit,**kwargs):
 calls.append(('plan',kwargs['contract'].fingerprint))
runner=_diagnostic_rendering_runner(cases,discoverer=discover,planning_runner=plan)
def meter(_identity,execute):
 execute()
 return RunMeasurement(0,0)
with TemporaryDirectory() as temp:
 output=Path(temp)/'artifacts'
 paths=run_measured_manifest_evaluation(manifest,object(),object(),'model',as_of=date(2026,9,26),output_directory=output,meter=meter,rendering_runner=runner)
 recordings=json.loads(paths['recordings'].read_text())
 assert [item['run']['failure_stage'] for item in recordings['runs']]==['planning','planning']
 assert [item['run']['runtime_input']['analysis_contract_fingerprint'] for item in recordings['runs']]==[contract.fingerprint]*2
 assert json.loads(paths['analysis_contracts'].read_text())==contracts
 assert json.loads(paths['scope_snapshots'].read_text())==snapshots
assert calls==['discover',('plan',contract.fingerprint)]*2
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('reviewed contract reaches SQL generation through the measured diagnostic runner', () => {
  const result = python(String.raw`
import manifest_sql_generation as generation
calls=[]
def discover(_bq,_scope):
 return DiscoverySnapshot(snapshot.content_json,snapshot.fingerprint,retrieved_at)
def plan(_vertex,_model,_question,_context,emit,**kwargs):
 panel={'id':'P1','title':'値','execution_prompt':'値を集計する','decision':'値を確認する','chart':'bar','dimensions':['区分'],'measures':['値']}
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[],'panels':[panel]},'cost_jpy':0})
def sql(_vertex,_model,_section,_period,rules):
 calls.append(rules)
 return ({'sql':'SELECT 1 AS metric_value','reason':'検査','undefined_terms':[],'clarification_question':''},{'input_tokens':1,'output_tokens':1})
generation.report.vertex_cost_jpy=lambda _model,_usage:0
runner=_diagnostic_rendering_runner(cases,discoverer=discover,planning_runner=plan,sql_runner=sql)
def meter(_identity,execute):
 execute()
 return RunMeasurement(0,0)
with TemporaryDirectory() as temp:
 paths=run_measured_manifest_evaluation(manifest,object(),object(),'model',as_of=date(2026,9,26),output_directory=Path(temp)/'artifacts',meter=meter,rendering_runner=runner)
 runs=[item['run'] for item in json.loads(paths['recordings'].read_text())['runs']]
 assert [run['failure_stage'] for run in runs]==['sql_validation','sql_validation']
 assert [run['generated_sql'] for run in runs]==['SELECT 1 AS metric_value']*2
 assert all(run['runtime_input']['analysis_contract_fingerprint']==contract.fingerprint for run in runs)
assert len(calls)==2 and all(contract.fingerprint in rules for rules in calls)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('reviewed scope rejects an unauthorized generated table before BigQuery', () => {
  const result = python(String.raw`
import manifest_sql_generation as generation
class NoWarehouse:
 def __getattr__(self,name):
  raise AssertionError('BigQuery was called before local SQL authorization: '+name)
def discover(_bq,_scope):
 return DiscoverySnapshot(snapshot.content_json,snapshot.fingerprint,retrieved_at)
def plan(_vertex,_model,_question,_context,emit,**kwargs):
 panel={'id':'P1','title':'値','execution_prompt':'値を集計する','decision':'値を確認する','chart':'bar','dimensions':['区分'],'measures':['値']}
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[],'panels':[panel]},'cost_jpy':0})
sql_text='SELECT COUNT(*) AS metric_value FROM '+chr(96)+'outside.dataset.records'+chr(96)+' LIMIT 10'
def sql(_vertex,_model,_section,_period,_rules):
 return ({'sql':sql_text,'reason':'検査','undefined_terms':[],'clarification_question':''},{'input_tokens':1,'output_tokens':1})
generation.report.vertex_cost_jpy=lambda _model,_usage:0
runner=_diagnostic_rendering_runner(cases,discoverer=discover,planning_runner=plan,sql_runner=sql)
def meter(_identity,execute):
 execute()
 return RunMeasurement(0,0)
with TemporaryDirectory() as temp:
 paths=run_measured_manifest_evaluation(manifest,NoWarehouse(),object(),'model',as_of=date(2026,9,26),output_directory=Path(temp)/'artifacts',meter=meter,rendering_runner=runner)
 runs=[item['run'] for item in json.loads(paths['recordings'].read_text())['runs']]
 assert len(runs)==2
 assert all(run['failure_stage']=='sql_validation' and run['failure_code']=='sql_validation_failed' for run in runs)
 assert all(run['unauthorized_reference'] is True and run['dangerous_sql'] is False for run in runs)
 assert all(run['generated_sql']==sql_text for run in runs)
 assert all(run['runtime_input']['analysis_contract_fingerprint']==contract.fingerprint for run in runs)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('reviewed SQL reaches only the bounded dry-run boundary', () => {
  const result = python(String.raw`
import types
from types import SimpleNamespace
import manifest_sql_generation as generation
bigquery=types.ModuleType('google.cloud.bigquery')
bigquery.QueryJobConfig=lambda **kwargs:SimpleNamespace(**kwargs)
cloud=types.ModuleType('google.cloud');cloud.bigquery=bigquery
google=types.ModuleType('google');google.cloud=cloud
sys.modules.update({'google':google,'google.cloud':cloud,'google.cloud.bigquery':bigquery})
sql_text='SELECT COUNT(*) AS metric_value FROM '+chr(96)+'project.dataset.records'+chr(96)
class DryRunOnlyWarehouse:
 def __init__(self):self.calls=[]
 def query(self,query,job_config):
  assert job_config.dry_run is True
  self.calls.append((query,job_config))
  return SimpleNamespace(statement_type='SELECT',referenced_tables=[SimpleNamespace(project='project',dataset_id='dataset',table_id='records')],schema=[SimpleNamespace(name='metric_value',field_type='INT64',mode='NULLABLE')],total_bytes_processed=101)
def discover(_bq,_scope):
 return DiscoverySnapshot(snapshot.content_json,snapshot.fingerprint,retrieved_at)
def plan(_vertex,_model,_question,_context,emit,**kwargs):
 panel={'id':'P1','title':'値','execution_prompt':'件数を求める','decision':'件数を確認する','chart':'scorecard','dimensions':[],'measures':['値']}
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[],'panels':[panel]},'cost_jpy':0})
def sql(_vertex,_model,_section,_period,_rules):
 return ({'sql':sql_text,'reason':'検査','undefined_terms':[],'clarification_question':''},{'input_tokens':1,'output_tokens':1})
generation.report.vertex_cost_jpy=lambda _model,_usage:0
warehouse=DryRunOnlyWarehouse()
runner=_diagnostic_rendering_runner(cases,discoverer=discover,planning_runner=plan,sql_runner=sql)
def meter(_identity,execute):
 execute()
 return RunMeasurement(0,0)
with TemporaryDirectory() as temp:
 paths=run_measured_manifest_evaluation(manifest,warehouse,object(),'model',as_of=date(2026,9,26),output_directory=Path(temp)/'artifacts',meter=meter,rendering_runner=runner)
 runs=[item['run'] for item in json.loads(paths['recordings'].read_text())['runs']]
 assert len(runs)==2
 assert all(run['failure_stage']=='dry_run' and run['failure_code']=='dry_run_failed' for run in runs)
 assert all(run['scan_limit_exceeded'] is True and run['sql_execution_succeeded'] is False for run in runs)
 assert all(run['generated_sql']==sql_text and run['runtime_input']['analysis_contract_fingerprint']==contract.fingerprint for run in runs)
assert len(warehouse.calls)==2
assert all(query==sql_text and config.maximum_bytes_billed==100 and config.use_query_cache is False for query,config in warehouse.calls)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('valid review is bound to the budgeted runner before any provider call', () => {
  const result = python(String.raw`
calls=[]
def budgeted(_manifest,_bq,_vertex,_model,**options):
 calls.append(options['rendering_runner'])
 return {'recordings':Path('recorded-runs.json')}
diagnostic_runtime.run_budgeted_manifest_evaluation=budgeted
paths=diagnostic_runtime.run_budgeted_diagnostic_manifest_evaluation(manifest,object(),object(),'model',as_of=date(2026,9,26),output_directory='unused',pricing_snapshot=object(),region='global',execution_date=date(2026,9,26),gate=object(),scope_snapshots_bytes=snapshot_bytes,contracts_bytes=contract_bytes,review_record_bytes=canonical(reviews).encode())
assert paths=={'recordings':Path('recorded-runs.json')}
assert len(calls)==1 and callable(calls[0])
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('changed authorized scope stops the diagnostic run without artifacts', () => {
  const result = python(String.raw`
calls=[]
def plan(*_args,**_kwargs):
 calls.append('plan')
def meter(_identity,execute):
 execute()
 return RunMeasurement(0,0)
with TemporaryDirectory() as temp:
 output=Path(temp)/'artifacts'
 wrong=lambda _bq,_scope:DiscoverySnapshot('{}',sha(b'{}'),retrieved_at)
 try:
  run_measured_manifest_evaluation(manifest,object(),object(),'model',as_of=date(2026,9,26),output_directory=output,meter=meter,rendering_runner=_diagnostic_rendering_runner(cases,discoverer=wrong,planning_runner=plan))
 except DiagnosticPreflightError:
  pass
 else:
  raise AssertionError('changed scope was accepted')
 assert not output.exists()
assert calls==[]
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('invalid review stops before the budgeted provider runner', () => {
  const result = python(String.raw`
called=[]
diagnostic_runtime.run_budgeted_manifest_evaluation=lambda *args,**kwargs:called.append('provider')
try:
 diagnostic_runtime.run_budgeted_diagnostic_manifest_evaluation(manifest,object(),object(),'model',as_of=date(2026,9,26),output_directory='unused',pricing_snapshot=object(),region='global',execution_date=date(2026,9,26),gate=object(),scope_snapshots_bytes=snapshot_bytes,contracts_bytes=contract_bytes,review_record_bytes=canonical({**reviews,'reviews':[]}).encode())
except DiagnosticPreflightError:
 pass
else:
 raise AssertionError('unreviewed contract was accepted')
assert called==[]
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

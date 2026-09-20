import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const REPORT_GENERATION = path.join(ROOT, 'spikes/report-generation');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import sys\nsys.path[:0]=[${JSON.stringify(EVALUATION)},${JSON.stringify(REPORT_GENERATION)}]\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import types
from datetime import date
from types import MappingProxyType,SimpleNamespace
import manifest_execution as execution
from analysis_contract_context import AnalysisExecutionPolicy,AnalysisResultPolicy
from analysis_schema_policy import AnalysisFieldPolicy
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_dry_run import DryRunAttempt
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from manifest_sql_generation import GeneratedSQLAttempt
from manifest_sql_validation import ValidatedSQLAttempt
from preflight import PreflightResult
table='alpha.dataset.records'
policy=AnalysisExecutionPolicy(
 frozenset({table}),frozenset({table}),100,10,None,
 (AnalysisFieldPolicy(table,('category',),'STRING','NULLABLE',False,False),),
 result=AnalysisResultPolicy(frozenset({'区分'}),frozenset({'値'})),
)
contract=SimpleNamespace(fingerprint='b'*64)
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-21T00:00:00+00:00')
preflight=PreflightResult('区分別の値を集計して',snapshot,contract,{'input_tokens':1,'output_tokens':1})
identity=PlannedPreflightAttempt('schema-a','case-a','run-1',MappingProxyType({'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64}),preflight)
planned=PlannedAnalysisAttempt(identity,{'panels':[{'id':'P1'}]},0.25)
section={
 'id':'P1','title':'区分別の値','planned_visualization':'bar',
 'source_columns':['category','metric_value'],'semantic_dimensions':['区分'],
 'semantic_measures':['値'],'dimension_count':1,'measure_count':1,
 'nonnull_metric_columns':['metric_value'],'max_result_rows':10,
}
sql='SELECT r.category AS category, COUNT(*) AS metric_value FROM '+chr(96)+table+chr(96)+' AS r GROUP BY r.category ORDER BY metric_value DESC LIMIT 10'
generated=GeneratedSQLAttempt(planned,section,sql,0.5)
validated=ValidatedSQLAttempt(generated,sql)
dry=DryRunAttempt(validated,(('category','STRING','NULLABLE'),('metric_value','INT64','NULLABLE')),42)
execution.analysis_contract_context.execution_policy=lambda _contract:policy
def dry_runs(*_args,**_kwargs):return (dry,)
bigquery=types.ModuleType('google.cloud.bigquery')
bigquery.QueryJobConfig=lambda **kwargs:SimpleNamespace(**kwargs)
cloud=types.ModuleType('google.cloud');cloud.bigquery=bigquery
google=types.ModuleType('google');google.cloud=cloud
sys.modules.update({'google':google,'google.cloud':cloud,'google.cloud.bigquery':bigquery})
`;

test('successful dry run executes once and retains rows columns and actual bytes', () => {
  assertPython(String.raw`
${setup}
class Rows(list):
 schema=[SimpleNamespace(name='category'),SimpleNamespace(name='metric_value')]
class Job:
 total_bytes_processed=84
 def result(self,**kwargs):self.result_options=kwargs;return Rows([{'category':'A','metric_value':2}])
class Client:
 def __init__(self):self.calls=[];self.job=Job()
 def query(self,query,job_config):self.calls.append((query,job_config));return self.job
client=Client()
attempt=execution.run_manifest_executions({},client,object(),'model',as_of=date(2026,9,21),dry_run_runner=dry_runs)[0]
assert attempt.succeeded
assert attempt.rows==(('A',2),)
assert attempt.columns==('category','metric_value')
assert attempt.bytes_processed==84
assert len(client.calls)==1
assert client.calls[0][1].maximum_bytes_billed==100
assert client.calls[0][1].use_query_cache is True
assert client.job.result_options=={'timeout':180,'max_results':11}
try:attempt.failure_recording(bytes_processed=84,cost_jpy=0.75)
except ValueError as error:assert str(error)=='a successful execution attempt cannot create a failure recording'
else:raise AssertionError('successful execution must continue to result validation')
`);
});

test('upstream failures skip execution and retain their original recording', () => {
  assertPython(String.raw`
${setup}
failed=DryRunAttempt(validated,None,None,'dry_run','dry_run_failed',scan_limit_exceeded=True)
class Client:
 def query(self,*_args,**_kwargs):raise AssertionError('BigQuery was contacted')
def dry_runs(*_args,**_kwargs):return (failed,)
attempt=execution.run_manifest_executions({},Client(),object(),'model',as_of=date(2026,9,21),dry_run_runner=dry_runs)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('dry_run','dry_run_failed')
recording=attempt.failure_recording(bytes_processed=0,cost_jpy=0.75)
assert recording['run']['scan_limit_exceeded'] is True
`);
});

test('execution metadata failures retain only fixed evidence and measured bytes', () => {
  assertPython(String.raw`
from run_outcome import validate_run_outcome
${setup}
class Rows(list):schema=[]
class Job:
 def result(self,**_kwargs):return Rows([])
class Client:
 def query(self,*_args,**_kwargs):return Job()
attempt=execution.run_manifest_executions({},Client(),object(),'model',as_of=date(2026,9,21),dry_run_runner=dry_runs)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('execution','execution_failed')
recording=attempt.failure_recording(bytes_processed=7,cost_jpy=0.75)
assert recording['run']['generated_sql']==sql
assert recording['run']['bytes_processed']==7
validate_run_outcome(recording['run'])
`);
});

test('execution scan-limit errors become safety evidence', () => {
  assertPython(String.raw`
${setup}
class Error(Exception):
 errors=[{'message':'Query exceeded limit for bytes billed: 100'}]
class Job:
 def result(self,**_kwargs):raise Error()
class Client:
 def query(self,*_args,**_kwargs):return Job()
attempt=execution.run_manifest_executions({},Client(),object(),'model',as_of=date(2026,9,21),dry_run_runner=dry_runs)[0]
assert not attempt.succeeded and attempt.scan_limit_exceeded
assert 'Query exceeded limit' not in repr(attempt)
`);
});

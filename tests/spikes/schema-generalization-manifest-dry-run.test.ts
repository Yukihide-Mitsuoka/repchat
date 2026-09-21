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
from types import MappingProxyType,SimpleNamespace
from analysis_contract_context import AnalysisExecutionPolicy,AnalysisResultPolicy
from analysis_schema_policy import AnalysisFieldPolicy
from bigquery_scope_discovery import DiscoverySnapshot
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
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
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
bigquery=types.ModuleType('google.cloud.bigquery')
bigquery.QueryJobConfig=lambda **kwargs:SimpleNamespace(**kwargs)
cloud=types.ModuleType('google.cloud');cloud.bigquery=bigquery
google=types.ModuleType('google');google.cloud=cloud
sys.modules.update({'google':google,'google.cloud':cloud,'google.cloud.bigquery':bigquery})
`;

test('successful SQL uses one common dry run and retains parsed schema and estimate', () => {
  assertPython(String.raw`
from datetime import date
import manifest_dry_run as dry_run
${setup}
dry_run.analysis_contract_context.execution_policy=lambda selected:policy if selected is contract else None
class Job:
 statement_type='SELECT'
 referenced_tables=[SimpleNamespace(project='alpha',dataset_id='dataset',table_id='records')]
 schema=[SimpleNamespace(name='category',field_type='STRING',mode='NULLABLE'),SimpleNamespace(name='metric_value',field_type='INT64',mode='NULLABLE')]
 total_bytes_processed=42
class Client:
 def __init__(self):self.calls=[]
 def query(self,query,job_config):self.calls.append((query,job_config));return Job()
client=Client()
def validation(*_args,**_kwargs):return (validated,)
attempt=dry_run.run_manifest_dry_runs(
 {},client,object(),'model',as_of=date(2026,9,20),validation_runner=validation,
)[0]
assert attempt.succeeded
assert attempt.dry_run_schema==(('category','STRING','NULLABLE'),('metric_value','INT64','NULLABLE'))
assert attempt.estimated_bytes_processed==42
assert len(client.calls)==1
assert client.calls[0][1].dry_run is True
assert client.calls[0][1].maximum_bytes_billed==100
assert client.calls[0][1].use_query_cache is False
try:
 attempt.failure_recording(bytes_processed=0,cost_jpy=0.75)
except ValueError as error:
 assert str(error)=='a successful dry run attempt cannot create a failure recording'
else:
 raise AssertionError('successful dry run must continue to execution')
`);
});

test('upstream failures skip BigQuery and retain their original stage', () => {
  assertPython(String.raw`
from datetime import date
import manifest_dry_run as dry_run
${setup}
failed=ValidatedSQLAttempt(generated,None,'sql_validation','sql_validation_failed',dangerous_sql=True)
class Client:
 def query(self,*_args,**_kwargs):raise AssertionError('BigQuery was contacted')
def validation(*_args,**_kwargs):return (failed,)
attempt=dry_run.run_manifest_dry_runs(
 {},Client(),object(),'model',as_of=date(2026,9,20),validation_runner=validation,
)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('sql_validation','sql_validation_failed')
recording=attempt.failure_recording(bytes_processed=0,cost_jpy=0.75)
assert recording['run']['dangerous_sql'] is True
`);
});

test('dry run metadata and scan failures become safe evidence flags', () => {
  assertPython(String.raw`
from datetime import date
import manifest_dry_run as dry_run
from run_outcome import validate_run_outcome
${setup}
dry_run.analysis_contract_context.execution_policy=lambda _contract:policy
class Client:
 def __init__(self,job):self.job=job
 def query(self,*_args,**_kwargs):return self.job
def validation(*_args,**_kwargs):return (validated,)
jobs=(
 (SimpleNamespace(statement_type='SELECT',referenced_tables=[SimpleNamespace(project='other',dataset_id='dataset',table_id='records')],schema=[],total_bytes_processed=1),(True,False,False,1)),
 (SimpleNamespace(statement_type='SELECT',referenced_tables=[SimpleNamespace(project='alpha',dataset_id='dataset',table_id='records')],schema=[],total_bytes_processed=101),(False,True,False,101)),
 (SimpleNamespace(statement_type='DELETE',referenced_tables=[SimpleNamespace(project='alpha',dataset_id='dataset',table_id='records')],schema=[],total_bytes_processed=1),(False,False,True,1)),
)
for job,expected in jobs:
 attempt=dry_run.run_manifest_dry_runs(
  {},Client(job),object(),'model',as_of=date(2026,9,20),validation_runner=validation,
 )[0]
 assert not attempt.succeeded
 assert (attempt.failure_stage,attempt.failure_code)==('dry_run','dry_run_failed')
 assert (attempt.unauthorized_reference,attempt.scan_limit_exceeded,attempt.dangerous_sql)==expected[:3]
 assert attempt.estimated_bytes_processed==expected[3]
 assert 'statement type' not in repr(attempt)
 recording=attempt.failure_recording(bytes_processed=7,cost_jpy=0.75)
 assert recording['run']['bytes_processed']==7
 assert recording['run']['generated_sql']==sql
 assert recording['run']['unauthorized_reference']==expected[0]
 assert recording['run']['scan_limit_exceeded']==expected[1]
 assert recording['run']['dangerous_sql']==expected[2]
 validate_run_outcome(recording['run'])
 try:
  attempt.failure_recording(bytes_processed=-1,cost_jpy=0.75)
 except ValueError as error:
  assert str(error)=='dry run bytes must be a non-negative integer'
 else:
  raise AssertionError('negative measured bytes were accepted')
`);
});

test('dry run output schema mismatch is a semantic error', () => {
  assertPython(String.raw`
from datetime import date
import manifest_dry_run as dry_run
${setup}
dry_run.analysis_contract_context.execution_policy=lambda _contract:policy
class Job:
 statement_type='SELECT'
 referenced_tables=[SimpleNamespace(project='alpha',dataset_id='dataset',table_id='records')]
 schema=[SimpleNamespace(name='wrong_name',field_type='STRING',mode='NULLABLE')]
 total_bytes_processed=42
class Client:
 def query(self,*_args,**_kwargs):return Job()
def validation(*_args,**_kwargs):return (validated,)
attempt=dry_run.run_manifest_dry_runs(
 {},Client(),object(),'model',as_of=date(2026,9,20),validation_runner=validation,
)[0]
assert not attempt.succeeded and attempt.semantic_error
assert attempt.estimated_bytes_processed==42
`);
});

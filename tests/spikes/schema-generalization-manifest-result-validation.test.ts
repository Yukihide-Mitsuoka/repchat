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
from datetime import date
from decimal import Decimal
from types import MappingProxyType,SimpleNamespace
import manifest_result_validation as result_validation
from analysis_contract_context import AnalysisExecutionPolicy,AnalysisResultPolicy
from analysis_schema_policy import AnalysisFieldPolicy
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_dry_run import DryRunAttempt
from manifest_execution import ExecutionAttempt
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
result_validation.analysis_contract_context.execution_policy=lambda _contract:policy
`;

test('successful execution uses the shared result contract and retains JSON-safe rows', () => {
  assertPython(String.raw`
${setup}
executed=ExecutionAttempt(dry,((date(2026,9,1),Decimal('2.5')),),('category','metric_value'),84)
def executions(*_args,**_kwargs):return (executed,)
attempt=result_validation.run_manifest_result_validation(
 {},object(),object(),'model',as_of=date(2026,9,21),execution_runner=executions,
)[0]
assert attempt.succeeded
assert attempt.rows==(('2026-09-01',2.5),)
assert attempt.columns==('category','metric_value')
assert attempt.visualization=='bar'
assert attempt.bytes_processed==84
try:attempt.failure_recording(bytes_processed=84,cost_jpy=0.75)
except ValueError as error:assert str(error)=='a successful result validation cannot create a failure recording'
else:raise AssertionError('successful result validation must continue to rendering')
`);
});

test('row overflow fails closed after execution and records measured evidence', () => {
  assertPython(String.raw`
from run_outcome import validate_run_outcome
${setup}
section['max_result_rows']=1
executed=ExecutionAttempt(dry,(('A',2),('B',1)),('category','metric_value'),84)
def executions(*_args,**_kwargs):return (executed,)
attempt=result_validation.run_manifest_result_validation(
 {},object(),object(),'model',as_of=date(2026,9,21),execution_runner=executions,
)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('result_validation','result_validation_failed')
assert attempt.semantic_error
recording=attempt.failure_recording(bytes_processed=84,cost_jpy=0.75)
assert recording['run']['sql_execution_succeeded'] is True
assert recording['run']['actual_rows']==[]
assert recording['run']['bytes_processed']==84
assert recording['run']['cost_jpy']==0.75
validate_run_outcome(recording['run'])
assert attempt.failure_recording(bytes_processed=126,cost_jpy=0.8)['run']['bytes_processed']==126
try:attempt.failure_recording(bytes_processed=83,cost_jpy=0.75)
except ValueError as error:assert str(error)=='result validation bytes must include execution metadata'
else:raise AssertionError('measured execution bytes must not be replaced')
`);
});

test('non-JSON numeric values fail closed without leaking raw rows', () => {
  assertPython(String.raw`
${setup}
section['planned_visualization']='table'
executed=ExecutionAttempt(dry,(('A',float('nan')),),('category','metric_value'),84)
def executions(*_args,**_kwargs):return (executed,)
attempt=result_validation.run_manifest_result_validation(
 {},object(),object(),'model',as_of=date(2026,9,21),execution_runner=executions,
)[0]
assert not attempt.succeeded and attempt.semantic_error
assert attempt.rows is None
recording=attempt.failure_recording(bytes_processed=84,cost_jpy=0.75)
assert recording['run']['actual_rows']==[]
`);
});

test('upstream failures skip result validation and retain their original recording', () => {
  assertPython(String.raw`
${setup}
failed=ExecutionAttempt(dry,None,None,None,'execution','execution_failed',scan_limit_exceeded=True)
def executions(*_args,**_kwargs):return (failed,)
result_validation.common_result_validation.validate_dashboard_result=lambda *_args,**_kwargs:(_ for _ in ()).throw(AssertionError('result validation ran'))
attempt=result_validation.run_manifest_result_validation(
 {},object(),object(),'model',as_of=date(2026,9,21),execution_runner=executions,
)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('execution','execution_failed')
recording=attempt.failure_recording(bytes_processed=7,cost_jpy=0.75)
assert recording['run']['scan_limit_exceeded'] is True
assert recording['run']['bytes_processed']==7
`);
});

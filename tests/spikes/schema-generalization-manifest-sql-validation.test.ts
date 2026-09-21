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
from types import MappingProxyType,SimpleNamespace
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from manifest_sql_generation import GeneratedSQLAttempt
from preflight import PreflightResult
table='alpha.dataset.records'
policy=AnalysisExecutionPolicy(
 frozenset({table}),frozenset({table}),100,10,None,
 (AnalysisFieldPolicy(table,('category',),'STRING','NULLABLE',False,False),),
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
safe_sql='SELECT r.category AS category, COUNT(*) AS metric_value FROM '+chr(96)+table+chr(96)+' AS r GROUP BY r.category ORDER BY metric_value DESC LIMIT 10;'
generated=GeneratedSQLAttempt(planned,section,safe_sql,0.5)
`;

test('successful generated SQL passes every common local validator without BigQuery', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_validation as validation
${setup}
validation.analysis_contract_context.execution_policy=lambda selected:policy if selected is contract else None
calls=[]
def generation(manifest,bq,vertex,model,*,as_of):
 calls.append((manifest,bq,vertex,model,as_of));return (generated,)
bq=object();vertex=object()
attempt=validation.run_manifest_sql_validation(
 {'manifest':'value'},bq,vertex,'model',as_of=date(2026,9,20),generation_runner=generation,
)[0]
assert attempt.succeeded
assert attempt.validated_sql==safe_sql[:-1]
assert not attempt.unauthorized_reference
assert not attempt.dangerous_sql
assert not attempt.semantic_error
assert calls==[({'manifest':'value'},bq,vertex,'model',date(2026,9,20))]
try:
 attempt.failure_recording(bytes_processed=0,cost_jpy=0.75)
except ValueError as error:
 assert str(error)=='a successful SQL validation attempt cannot create a failure recording'
else:
 raise AssertionError('successful SQL validation must continue to dry run')
`);
});

test('upstream failures skip validation and retain their original stage', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_validation as validation
${setup}
failed=GeneratedSQLAttempt(planned,None,None,None,'sql_generation','sql_generation_failed')
validation.analysis_contract_context.execution_policy=lambda _contract:(_ for _ in ()).throw(AssertionError('validation called'))
def generation(*_args,**_kwargs):return (failed,)
attempt=validation.run_manifest_sql_validation(
 {},object(),object(),'model',as_of=date(2026,9,20),generation_runner=generation,
)[0]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('sql_generation','sql_generation_failed')
recording=attempt.failure_recording(bytes_processed=0,cost_jpy=0.75)
assert recording['run']['failure_stage']=='sql_generation'
`);
});

test('validation failures preserve SQL and classify safety evidence without raw diagnostics', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_validation as validation
from manifest_sql_generation import GeneratedSQLAttempt
from run_outcome import validate_run_outcome
${setup}
validation.analysis_contract_context.execution_policy=lambda _contract:policy
cases=(
 ('dangerous','WITH source AS (SELECT 1) DELETE FROM '+chr(96)+table+chr(96),(False,True,False)),
 ('outside','SELECT COUNT(*) AS metric_value FROM '+chr(96)+'other.dataset.records'+chr(96),(True,False,False)),
 ('unknown_field','SELECT r.unknown AS category, COUNT(*) AS metric_value FROM '+chr(96)+table+chr(96)+' AS r GROUP BY r.unknown ORDER BY metric_value LIMIT 10',(True,False,False)),
 ('shape','SELECT r.category AS category, COUNT(*) AS metric_value FROM '+chr(96)+table+chr(96)+' AS r GROUP BY r.category',(False,False,True)),
)
for name,sql,expected in cases:
 current=GeneratedSQLAttempt(planned,section,sql,0.5)
 def generation(*_args,attempt=current,**_kwargs):return (attempt,)
 attempt=validation.run_manifest_sql_validation(
  {},object(),object(),'model',as_of=date(2026,9,20),generation_runner=generation,
 )[0]
 assert not attempt.succeeded,name
 assert (attempt.failure_stage,attempt.failure_code)==('sql_validation','sql_validation_failed'),name
 assert (attempt.unauthorized_reference,attempt.dangerous_sql,attempt.semantic_error)==expected,name
 assert 'BigQueryへ送信' not in repr(attempt)
 recording=attempt.failure_recording(bytes_processed=7,cost_jpy=0.75)
 assert recording['run']['bytes_processed']==7
 assert recording['run']['generated_sql']==sql
 assert recording['run']['unauthorized_reference']==expected[0]
 assert recording['run']['dangerous_sql']==expected[1]
 assert recording['run']['semantic_error']==expected[2]
 validate_run_outcome(recording['run'])
 try:
  attempt.failure_recording(bytes_processed=-1,cost_jpy=0.75)
 except ValueError as error:
  assert str(error)=='SQL validation bytes must be a non-negative integer'
 else:
  raise AssertionError('negative measured bytes were accepted')
`);
});

test('period validation failure is recorded as a semantic error', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_validation as validation
${setup}
validation.analysis_contract_context.execution_policy=lambda _contract:policy
validation.contract_period_validation.contract_period_diagnostic=lambda _sql,_policy:'private period diagnostic'
def generation(*_args,**_kwargs):return (generated,)
attempt=validation.run_manifest_sql_validation(
 {},object(),object(),'model',as_of=date(2026,9,20),generation_runner=generation,
)[0]
assert not attempt.succeeded and attempt.semantic_error
assert 'private period diagnostic' not in repr(attempt)
`);
});

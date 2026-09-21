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
from types import MappingProxyType,SimpleNamespace
import manifest_rendering as rendering
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_dry_run import DryRunAttempt
from manifest_execution import ExecutionAttempt
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from manifest_result_validation import ResultValidationAttempt
from manifest_sql_generation import GeneratedSQLAttempt
from manifest_sql_validation import ValidatedSQLAttempt
from preflight import PreflightResult
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
sql='SELECT r.category AS category, COUNT(*) AS metric_value FROM '+chr(96)+'alpha.dataset.records'+chr(96)+' AS r GROUP BY r.category ORDER BY metric_value DESC LIMIT 10'
generated=GeneratedSQLAttempt(planned,section,sql,0.5)
validated=ValidatedSQLAttempt(generated,sql)
dry=DryRunAttempt(validated,(('category','STRING','NULLABLE'),('metric_value','INT64','NULLABLE')),42)
executed=ExecutionAttempt(dry,(('A',2),('B',1)),('category','metric_value'),84)
valid_result=ResultValidationAttempt(executed,(('A',2),('B',1)),('category','metric_value'),'bar',84)
`;

test('validated generic results reach the real renderer and create a successful run', () => {
  assertPython(String.raw`
from run_outcome import validate_run_outcome
${setup}
def validations(*_args,**_kwargs):return (valid_result,)
attempt=rendering.run_manifest_rendering(
 {},object(),object(),'model',as_of=date(2026,9,21),result_runner=validations,
)[0]
assert attempt.succeeded and attempt.render_succeeded
recording=attempt.recording(bytes_processed=84,cost_jpy=0.75)
assert recording['schema_id']=='schema-a' and recording['case_id']=='case-a'
assert recording['run']['failure_stage']=='none'
assert recording['run']['failure_code']==''
assert recording['run']['sql_execution_succeeded'] is True
assert recording['run']['actual_rows']==[['A',2],['B',1]]
assert recording['run']['render_succeeded'] is True
assert recording['run']['bytes_processed']==84
assert recording['run']['cost_jpy']==0.75
assert attempt.recording(bytes_processed=126,cost_jpy=0.9)['run']['bytes_processed']==126
validate_run_outcome(recording['run'])
`);
});

test('renderer rejection or exception fails closed while retaining validated evidence', () => {
  assertPython(String.raw`
from run_outcome import validate_run_outcome
${setup}
def validations(*_args,**_kwargs):return (valid_result,)
def raises(_payload):raise RuntimeError('sensitive provider detail')
for renderer in (lambda _payload:False,raises):
 attempt=rendering.run_manifest_rendering(
  {},object(),object(),'model',as_of=date(2026,9,21),
  result_runner=validations,renderer=renderer,
 )[0]
 assert not attempt.succeeded and not attempt.render_succeeded
 assert (attempt.failure_stage,attempt.failure_code)==('rendering','rendering_failed')
 recording=attempt.recording(bytes_processed=84,cost_jpy=0.75)
 assert recording['run']['actual_rows']==[['A',2],['B',1]]
 assert recording['run']['failure_code']=='rendering_failed'
 assert 'sensitive' not in repr(recording)
 validate_run_outcome(recording['run'])
`);
});

test('upstream failures skip rendering and preserve their original outcome', () => {
  assertPython(String.raw`
${setup}
failed_result=ResultValidationAttempt(
 executed,None,None,None,84,'result_validation','result_validation_failed',True,
)
def validations(*_args,**_kwargs):return (failed_result,)
def must_not_render(_payload):raise AssertionError('renderer ran')
attempt=rendering.run_manifest_rendering(
 {},object(),object(),'model',as_of=date(2026,9,21),
 result_runner=validations,renderer=must_not_render,
)[0]
assert not attempt.succeeded and not attempt.render_succeeded
assert (attempt.failure_stage,attempt.failure_code)==('result_validation','result_validation_failed')
recording=attempt.recording(bytes_processed=84,cost_jpy=0.75)
assert recording['run']['actual_rows']==[]
assert recording['run']['semantic_error'] is True
`);
});

test('final recording rejects substituted measurements', () => {
  assertPython(String.raw`
${setup}
def validations(*_args,**_kwargs):return (valid_result,)
attempt=rendering.run_manifest_rendering(
 {},object(),object(),'model',as_of=date(2026,9,21),
 result_runner=validations,renderer=lambda _payload:True,
)[0]
for kwargs,message in (
 ({'bytes_processed':83,'cost_jpy':0.75},'rendering bytes must include execution metadata'),
 ({'bytes_processed':84,'cost_jpy':float('nan')},'rendering cost must be finite and non-negative'),
):
 try:attempt.recording(**kwargs)
 except ValueError as error:assert str(error)==message
 else:raise AssertionError('invalid measured evidence was accepted')
`);
});

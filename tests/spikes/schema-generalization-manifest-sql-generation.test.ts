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
import json
from types import MappingProxyType
from analysis_contract import AnalysisContract,fingerprint_contract_content
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from preflight import PreflightResult
content={'version':1,'schema':{},'semantics':{},'period':None,'limits':{}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(',',':'))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
preflight=PreflightResult('区分別の値を集計して',snapshot,contract,{'input_tokens':1,'output_tokens':1})
identity=PlannedPreflightAttempt('schema-a','case-a','run-1',MappingProxyType({'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64}),preflight)
panel={'id':'P1','title':'区分別の値','execution_prompt':'区分別の値を集計する','decision':'重点区分を判断する','chart':'bar','dimensions':['区分'],'measures':['値']}
plan={'revision':'plan-123456789abc','analysis_contract_fingerprint':contract.fingerprint,'clarifications':[],'panels':[panel]}
planned=PlannedAnalysisAttempt(identity,plan,0.25)
`;

test('successful planned attempts use the common section and SQL generator contracts', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_generation as generation
${setup}
calls=[]
def planning(*args,**kwargs):
 calls.append(('planning',args,kwargs));return (planned,)
def sql(client,model,section,period,rules):
 calls.append(('sql',client,model,section,period,rules))
 return ({'sql':' SELECT 1 AS metric_value ','reason':'集計','undefined_terms':[],'clarification_question':''},{'input_tokens':2,'output_tokens':3})
generation.report.vertex_cost_jpy=lambda model,usage:0.5
vertex=object();bq=object()
attempts=generation.run_manifest_sql_generation(
 {'manifest':'value'},bq,vertex,'model',as_of=date(2026,9,20),
 planning_runner=planning,sql_runner=sql,
)
assert len(attempts)==1 and attempts[0].succeeded
assert attempts[0].generated_sql=='SELECT 1 AS metric_value'
assert attempts[0].sql_generation_cost_jpy==0.5
assert attempts[0].section['planned_visualization']=='bar'
assert attempts[0].section['source_columns']==['category','metric_value']
assert calls[0][1]==({'manifest':'value'},bq,vertex,'model')
assert calls[0][2]=={'as_of':date(2026,9,20)}
sql_call=calls[1]
assert sql_call[1:3]==(vertex,'model')
assert sql_call[4] is None
assert contract.fingerprint in sql_call[5]
try:
 attempts[0].failure_recording(bytes_processed=0,cost_jpy=0.75)
except ValueError as error:
 assert str(error)=='a successful SQL generation attempt cannot create a failure recording'
else:
 raise AssertionError('successful SQL generation must continue to validation')
`);
});

test('upstream failures skip SQL generation and retain the original stage', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_generation as generation
${setup}
failed=PlannedAnalysisAttempt(identity,None,None,'planning','planning_failed')
calls=[]
def planning(*_args,**_kwargs):return (failed,)
def sql(*args,**kwargs):calls.append((args,kwargs))
attempt=generation.run_manifest_sql_generation(
 {},object(),object(),'model',as_of=date(2026,9,20),
 planning_runner=planning,sql_runner=sql,
)[0]
assert calls==[]
assert not attempt.succeeded
assert (attempt.failure_stage,attempt.failure_code)==('planning','planning_failed')
recording=attempt.failure_recording(bytes_processed=0,cost_jpy=0.25)
assert recording['run']['failure_stage']=='planning'
`);
});

test('SQL generation failures use one safe stage and never expose provider detail', () => {
  assertPython(String.raw`
from datetime import date
import manifest_sql_generation as generation
from run_outcome import validate_run_outcome
${setup}
secret='private-provider-response'
def planning(*_args,**_kwargs):return (planned,)
def raises(*_args,**_kwargs):raise RuntimeError(secret)
def empty(*_args,**_kwargs):return ({'sql':'','reason':secret,'undefined_terms':[]},{'input_tokens':1,'output_tokens':1})
def refusal(*_args,**_kwargs):return ({'sql':'','reason':secret,'undefined_terms':['unknown']},{'input_tokens':1,'output_tokens':1})
def conflicted(*_args,**_kwargs):return ({'sql':'SELECT 1','reason':secret,'undefined_terms':['unknown']},{'input_tokens':1,'output_tokens':1})
def malformed(*_args,**_kwargs):return ({'sql':'SELECT 1','reason':'ok','undefined_terms':'unknown'},{'input_tokens':1,'output_tokens':1})
for runner in (raises,empty,refusal,conflicted,malformed):
 attempt=generation.run_manifest_sql_generation(
  {},object(),object(),'model',as_of=date(2026,9,20),
  planning_runner=planning,sql_runner=runner,
 )[0]
 assert not attempt.succeeded
 assert (attempt.failure_stage,attempt.failure_code)==('sql_generation','sql_generation_failed')
 assert attempt.generated_sql is None and attempt.sql_generation_cost_jpy is None
 assert secret not in repr(attempt)
 recording=attempt.failure_recording(bytes_processed=7,cost_jpy=0.75)
 assert recording['run']['bytes_processed']==7
 assert recording['run']['generated_sql']==''
 assert recording['run']['failure_stage']=='sql_generation'
 assert recording['run']['failure_code']=='sql_generation_failed'
 validate_run_outcome(recording['run'])
 try:
  attempt.failure_recording(bytes_processed=-1,cost_jpy=0.75)
 except ValueError as error:
  assert str(error)=='SQL generation bytes must be a non-negative integer'
 else:
  raise AssertionError('negative measured bytes were accepted')
`);
});

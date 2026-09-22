import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const REPORT_GENERATION = path.join(ROOT, 'spikes/report-generation');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import sys\nsys.path[:0]=[${JSON.stringify(EVALUATION)},${JSON.stringify(REPORT_GENERATION)}]\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

function assertPython(body: string) {
  const result = python(body);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const manifest = String.raw`{
 'version':1,
 'evaluation_plan_sha256':'0'*64,
 'pipeline':{'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64},
 'schemas':[{
  'schema_id':'schema-a',
  'authorized_scope':{'datasets':['project.dataset'],'tables':['project.dataset.table']},
  'cases':[{'case_id':'case-a','question':'区分別の値を集計して','run_ids':['run-1','run-2']}],
 }],
}`;

const contract = String.raw`
import json
from analysis_contract import AnalysisContract,fingerprint_contract_content
content={'version':1,'schema':{},'semantics':{},'period':None,'limits':{}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(',',':'))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
`;

test('successful manifest preflights use the common dashboard planner with the exact contract', () => {
  assertPython(String.raw`
from datetime import date
from types import SimpleNamespace
import analysis_workflows
import manifest_planning
from bigquery_scope_discovery import DiscoverySnapshot
from preflight import PreflightResult
${contract}
manifest=${manifest}
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
def preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,contract,{'input_tokens':1,'output_tokens':1})
calls=[]
def propose(client,model,question,period,context,answers,*,current_plan,instruction,initial_panel_count):
 calls.append((client,model,question,period,context,answers,current_plan,instruction,initial_panel_count))
 return ({'revision':'plan-123456789abc','clarifications':[],'panels':[{'id':'P1','chart':'scorecard','dimensions':[]}]},{'input_tokens':1,'output_tokens':1})
analysis_workflows.planner.propose_dashboard=propose
analysis_workflows.analysis_contract_context.execution_policy=lambda _contract:SimpleNamespace(result=None)
analysis_workflows.report.vertex_cost_jpy=lambda _model,_usage:0.25
client=object()
attempts=manifest_planning.run_manifest_planning(
 manifest,object(),client,'model',as_of=date(2026,9,20),
 preflight_runner=preflight,
)
assert [(item.preflight_attempt.schema_id,item.preflight_attempt.case_id,item.preflight_attempt.run_id) for item in attempts]==[
 ('schema-a','case-a','run-1'),('schema-a','case-a','run-2'),
]
assert all(item.succeeded for item in attempts)
assert all(item.plan['revision'].startswith('plan-') for item in attempts)
assert all(item.plan['analysis_contract_fingerprint']==contract.fingerprint for item in attempts)
assert [item.planning_cost_jpy for item in attempts]==[0.25,0.25]
assert all(call[:4]==(client,'model','区分別の値を集計して',None) for call in calls)
assert all(contract.fingerprint in call[4] for call in calls)
assert all(call[5:] == ({},None,None,1) for call in calls)
try:
 attempts[0].failure_recording(bytes_processed=0,cost_jpy=0.25)
except ValueError as error:
 assert str(error)=='a successful planning attempt cannot create a failure recording'
else:
 raise AssertionError('successful planning must continue to SQL generation')
`);
});

test('failed preflights skip planning and retain their original failure recording', () => {
  assertPython(String.raw`
from datetime import date
import manifest_planning
from preflight import PreflightResult
from run_outcome import validate_run_outcome
manifest=${manifest}
def preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(
  question,None,None,{'input_tokens':0,'output_tokens':0},
  failure_stage='scope_discovery',failure_code='scope_discovery_failed',
 )
calls=[]
def plan(*args,**kwargs):calls.append((args,kwargs))
attempts=manifest_planning.run_manifest_planning(
 manifest,object(),object(),'model',as_of=date(2026,9,20),
 preflight_runner=preflight,planning_runner=plan,
)
assert calls==[]
assert all(not item.succeeded and item.failure_stage=='scope_discovery' for item in attempts)
recording=attempts[0].failure_recording(bytes_processed=7,cost_jpy=0.1)
assert recording['run']['failure_stage']=='scope_discovery'
assert recording['run']['failure_code']=='scope_discovery_failed'
assert recording['run']['bytes_processed']==7
validate_run_outcome(recording['run'])
`);
});

test('explicit planner output failures keep every attempt with a safe code', () => {
  assertPython(String.raw`
from datetime import date
import analysis_workflows
import manifest_planning
from bigquery_scope_discovery import DiscoverySnapshot
from preflight import PreflightResult
from run_outcome import validate_run_outcome
${contract}
manifest=${manifest}
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
def preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,contract,{'input_tokens':1,'output_tokens':1})
detail='generated-output-detail'
output_error=analysis_workflows.AnalysisWorkflowOutputError
def plan(*_args,**_kwargs):raise output_error(detail)
attempts=manifest_planning.run_manifest_planning(
 manifest,object(),object(),'model',as_of=date(2026,9,20),
 preflight_runner=preflight,planning_runner=plan,
)
assert len(attempts)==2
assert all(not item.succeeded for item in attempts)
assert all((item.failure_stage,item.failure_code)==('planning','planning_failed') for item in attempts)
assert detail not in repr(attempts)
recording=attempts[0].failure_recording(bytes_processed=7,cost_jpy=0.2)
assert recording['run']['bytes_processed']==7
assert recording['run']['runtime_input']=={
 'scope_snapshot_fingerprint':'a'*64,
 'analysis_contract_fingerprint':contract.fingerprint,
 'question':'区分別の値を集計して',
}
assert recording['run']['generated_sql']==''
assert recording['run']['failure_stage']=='planning'
assert recording['run']['failure_code']=='planning_failed'
validate_run_outcome(recording['run'])
try:
 attempts[0].failure_recording(bytes_processed=-1,cost_jpy=0.2)
except ValueError as error:
 assert str(error)=='planning bytes must be a non-negative integer'
else:
 raise AssertionError('negative measured bytes were accepted')
`);
});

test('planning runner and invariant failures propagate instead of becoming quality failures', () => {
  assertPython(String.raw`
from datetime import date
import analysis_workflows
import manifest_planning
from bigquery_scope_discovery import DiscoverySnapshot
from preflight import PreflightResult
${contract}
manifest=${manifest}
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
def preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,contract,{'input_tokens':1,'output_tokens':1})
def unknown(*_args,**_kwargs):raise RuntimeError('private-provider-response')
def classified(*_args,**_kwargs):raise analysis_workflows.AnalysisWorkflowError('safe-provider-failure')
for runner,error_type,message in (
 (unknown,RuntimeError,'private-provider-response'),
 (classified,analysis_workflows.AnalysisWorkflowError,'safe-provider-failure'),
):
 try:
  manifest_planning.run_manifest_planning(
   manifest,object(),object(),'model',as_of=date(2026,9,20),
   preflight_runner=preflight,planning_runner=runner,
  )
 except error_type as error:
  assert str(error)==message
 else:
  raise AssertionError('planning runner failure became a quality failure')
def non_json_plan(_client,_model,_question,_answers,emit,**kwargs):
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[],'panels':[{'id':'P1'}],'opaque':object()},'cost_jpy':0})
try:
 manifest_planning.run_manifest_planning(
  manifest,object(),object(),'model',as_of=date(2026,9,20),
  preflight_runner=preflight,planning_runner=non_json_plan,
 )
except TypeError:
 pass
else:
 raise AssertionError('non-serializable plan became a quality failure')
def incomplete_preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,None,{'input_tokens':1,'output_tokens':1})
try:
 manifest_planning.run_manifest_planning(
  manifest,object(),object(),'model',as_of=date(2026,9,20),
  preflight_runner=incomplete_preflight,planning_runner=lambda *_args,**_kwargs:None,
 )
except ValueError as error:
 assert str(error)=='successful preflight requires an analysis contract'
else:
 raise AssertionError('missing successful-preflight contract became a quality failure')
`);
});

test('missing or contract-mismatched plan events fail closed', () => {
  assertPython(String.raw`
from datetime import date
import manifest_planning
from bigquery_scope_discovery import DiscoverySnapshot
from preflight import PreflightResult
${contract}
manifest=${manifest}
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
def preflight(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,contract,{'input_tokens':1,'output_tokens':1})
def no_plan(*_args,**_kwargs):return None
def wrong_contract(_client,_model,_question,_answers,emit,**_kwargs):
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':'f'*64,'clarifications':[],'panels':[{'id':'P1'}]},'cost_jpy':0})
def needs_answer(_client,_model,_question,_answers,emit,**kwargs):
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[{'field':'audience'}],'panels':[{'id':'P1'}]},'cost_jpy':0})
def multiple_panels(_client,_model,_question,_answers,emit,**kwargs):
 emit({'type':'plan','plan':{'revision':'plan-123456789abc','analysis_contract_fingerprint':kwargs['contract'].fingerprint,'clarifications':[],'panels':[{'id':'P1'},{'id':'P2'}]},'cost_jpy':0})
for runner in (no_plan,wrong_contract,needs_answer,multiple_panels):
 attempts=manifest_planning.run_manifest_planning(
  manifest,object(),object(),'model',as_of=date(2026,9,20),
  preflight_runner=preflight,planning_runner=runner,
 )
 assert all((item.failure_stage,item.failure_code)==('planning','planning_failed') for item in attempts)
`);
});

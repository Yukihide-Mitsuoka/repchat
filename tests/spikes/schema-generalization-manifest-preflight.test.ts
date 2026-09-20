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

const manifest = String.raw`{
 'version':1,
 'evaluation_plan_sha256':'0'*64,
 'pipeline':{'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64},
 'schemas':[
  {
   'schema_id':'schema-a',
   'authorized_scope':{
    'datasets':['project.dataset'],
    'tables':['project.dataset.table'],
   },
   'cases':[
    {'case_id':'case-a','question':'first question','run_ids':['run-1','run-2']},
    {'case_id':'case-b','question':'second question','run_ids':['run-1']},
   ],
  },
 ],
}`;

test('manifest preflight runs every planned attempt with only authorized scope and question', () => {
  const result = python(String.raw`
from datetime import date
import manifest_preflight
from preflight import PreflightResult

manifest=${manifest}
calls=[]
bq=object();vertex=object();as_of=date(2026,9,20)
def run(bq_value,vertex_value,model,scope,question,*,as_of):
 calls.append((bq_value,vertex_value,model,scope,question,as_of))
 return PreflightResult(
  question,None,None,{'input_tokens':0,'output_tokens':0},
  failure_stage='scope_discovery',failure_code='scope_discovery_failed',
 )
attempts=manifest_preflight.run_manifest_preflights(
 manifest,bq,vertex,'model',as_of=as_of,preflight_runner=run,
)
assert [(item.schema_id,item.case_id,item.run_id) for item in attempts]==[
 ('schema-a','case-a','run-1'),
 ('schema-a','case-a','run-2'),
 ('schema-a','case-b','run-1'),
]
assert all(item.pipeline_fingerprints==manifest['pipeline'] for item in attempts)
try:
 attempts[0].pipeline_fingerprints['runtime']='f'*64
except TypeError:
 pass
else:
 raise AssertionError('pipeline fingerprints must remain bound to the manifest')
assert [call[4] for call in calls]==['first question','first question','second question']
assert all(call[:3]==(bq,vertex,'model') and call[5]==as_of for call in calls)
assert all(call[3].datasets==frozenset({'project.dataset'}) for call in calls)
assert all(call[3].tables==frozenset({'project.dataset.table'}) for call in calls)
recording=attempts[0].failure_recording(bytes_processed=7,cost_jpy=0.25)
assert (recording['schema_id'],recording['case_id'])==('schema-a','case-a')
assert recording['run']['run_id']=='run-1'
assert recording['run']['runtime']=='1'*64
assert recording['run']['bytes_processed']==7
assert recording['run']['cost_jpy']==0.25
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('manifest preflight rejects reference data and duplicate attempts before runtime calls', () => {
  const result = python(String.raw`
import copy
import manifest_preflight

manifest=${manifest}
calls=[]
def run(*args,**kwargs):
 calls.append((args,kwargs))
 raise AssertionError('runtime must not run for an invalid manifest')
with_reference=copy.deepcopy(manifest)
with_reference['schemas'][0]['cases'][1]['reference']={'sql':'SELECT 1'}
duplicate=copy.deepcopy(manifest)
duplicate['schemas'][0]['cases'][0]['run_ids']=['run-1','run-1']
invalid_scope=copy.deepcopy(manifest)
invalid_scope['schemas'][0]['authorized_scope']['tables']=['not-qualified']
invalid_scope_type=copy.deepcopy(manifest)
invalid_scope_type['schemas'][0]['authorized_scope']['tables']=[{'table':'hidden'}]
for value in (with_reference,duplicate,invalid_scope,invalid_scope_type):
 try:
  manifest_preflight.run_manifest_preflights(
   value,object(),object(),'model',
   as_of=__import__('datetime').date(2026,9,20),preflight_runner=run,
  )
 except manifest_preflight.ExecutionManifestError:
  pass
 else:
  raise AssertionError('invalid manifest must be rejected')
assert calls==[]
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('successful preflight cannot be converted into a failed recording', () => {
  const result = python(String.raw`
from datetime import date
import manifest_preflight
from analysis_contract import AnalysisContract
from bigquery_scope_discovery import DiscoverySnapshot
from preflight import PreflightResult

manifest=${manifest}
snapshot=DiscoverySnapshot('{}','a'*64,'2026-09-20T00:00:00+00:00')
contract=AnalysisContract('{}','b'*64)
def run(_bq,_vertex,_model,_scope,question,*,as_of):
 return PreflightResult(question,snapshot,contract,{'input_tokens':1,'output_tokens':1})
attempt=manifest_preflight.run_manifest_preflights(
 manifest,object(),object(),'model',as_of=date(2026,9,20),preflight_runner=run,
)[0]
assert attempt.result.succeeded
try:
 attempt.failure_recording(bytes_processed=0,cost_jpy=0)
except ValueError as error:
 assert str(error)=='a successful preflight cannot create a failure recording'
else:
 raise AssertionError('successful preflight must continue to later runtime stages')
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

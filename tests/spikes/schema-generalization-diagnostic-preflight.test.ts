import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');
const REPORT_GENERATION = path.join(ROOT, 'spikes/report-generation');

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

const fixture = String.raw`
import hashlib,json
from datetime import date
from analysis_contract import compile_contract
from bigquery_schema_snapshot import SchemaSnapshot
from bigquery_scope_discovery import AuthorizedScope,DiscoverySnapshot
from diagnostic_preflight import DiagnosticPreflightError,prepare_diagnostic_preflights

def canonical(value):
 return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(value):
 return hashlib.sha256(value).hexdigest()
metadata={'version':1,'tables':[{'table':'project.dataset.records','fields':[
 {'name':'amount','type':'INTEGER','mode':'NULLABLE'}
]}]}
retrieved_at='2026-09-25T00:00:00+00:00'
metadata_json=canonical(metadata)
schema=SchemaSnapshot(metadata_json,sha(metadata_json.encode()),retrieved_at)
scope_content={'version':1,'schema':{'fingerprint':schema.fingerprint,'metadata':metadata},'tables':[],'limits':{}}
scope_json=canonical(scope_content)
snapshot=DiscoverySnapshot(scope_json,sha(scope_json.encode()),retrieved_at)
contract=compile_contract(schema,{'grain':{},'metrics':{},'dimensions':{},'relationships':[]},None,
 {'maximum_bytes_billed':100,'maximum_result_rows':10})
scope=AuthorizedScope(datasets=frozenset({'project.dataset'}),tables=frozenset({'project.dataset.records'}))
manifest={'version':1,'evaluation_plan_sha256':'0'*64,
 'pipeline':{'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64},
 'schemas':[{'schema_id':'schema-a','authorized_scope':{
  'datasets':['project.dataset'],'tables':['project.dataset.records']},
  'cases':[{'case_id':'case-a','question':'合計を求める','run_ids':['run-1']}]}]}
snapshots={'version':1,'snapshots':[{'schema_id':'schema-a','content_json':scope_json,'retrieved_at':retrieved_at}]}
contracts={'version':1,'contracts':[{'schema_id':'schema-a','case_id':'case-a','content_json':contract.content_json}]}
contracts_bytes=canonical(contracts).encode()
reviews={'version':2,'scope_snapshots_sha256':sha(canonical(snapshots).encode()),
 'analysis_contracts_sha256':sha(contracts_bytes),'reviews':[{
 'schema_id':'schema-a','case_id':'case-a','contract_fingerprint':contract.fingerprint,
 'author_id':'contract-author','reviewer_id':'contract-reviewer',
 'reviewed_at':'2026-09-25T01:00:00+00:00'}]}
def prepare():
 return prepare_diagnostic_preflights(manifest,canonical(snapshots).encode(),contracts_bytes,canonical(reviews).encode())
`;

test('reviewed contract reaches planning only after fresh authorized scope matches', () => {
  const result = python(
    fixture +
      String.raw`
from manifest_planning import run_manifest_planning
prepared=prepare()
case=prepared[('schema-a','case-a')]
calls=[]
def discover(_bq,received_scope):
 calls.append(('discover',received_scope))
 return DiscoverySnapshot(snapshot.content_json,snapshot.fingerprint,'2026-09-26T00:00:00+00:00')
def plan(_vertex,_model,_question,_context,emit,**kwargs):
 calls.append(('plan',kwargs['contract'].fingerprint))
 # A rejected plan is enough to prove the planner received this exact contract.
attempts=run_manifest_planning(manifest,object(),object(),'model',as_of=date(2026,9,26),
 preflight_runner=lambda *args,**kwargs:case.run(*args,discoverer=discover,**kwargs),
 planning_runner=plan)
assert len(attempts)==1
assert attempts[0].failure_stage=='planning'
assert calls==[('discover',scope),('plan',contract.fingerprint)]
assert attempts[0].preflight_attempt.result.contract.content_json==contract.content_json
assert attempts[0].preflight_attempt.result.discovery.retrieved_at==retrieved_at
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('tampered review or contract bytes fail before any provider call', () => {
  const result = python(
    fixture +
      String.raw`
for changed in (canonical({**reviews,'analysis_contracts_sha256':'f'*64}).encode(),
 canonical({**reviews,'reviews':[]}).encode()):
 try:
  prepare_diagnostic_preflights(manifest,canonical(snapshots).encode(),contracts_bytes,changed)
 except DiagnosticPreflightError:
  pass
 else:
  raise AssertionError('invalid review accepted')
changed=contracts_bytes+b' '
try:
 prepare_diagnostic_preflights(manifest,canonical(snapshots).encode(),changed,canonical(reviews).encode())
except DiagnosticPreflightError:
 pass
else:
 raise AssertionError('changed contract bytes accepted')
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('different authorized scope or fresh snapshot cannot use a reviewed contract', () => {
  const result = python(
    fixture +
      String.raw`
case=prepare()[('schema-a','case-a')]
calls=[]
def discover(_bq,_scope):
 calls.append('discovered')
 return DiscoverySnapshot('{}',sha(b'{}'),retrieved_at)
different=AuthorizedScope(datasets=frozenset({'project.other'}),tables=frozenset())
try:
 case.run(object(),object(),'model',different,'合計を求める',as_of=date(2026,9,26),discoverer=discover)
except DiagnosticPreflightError:
 pass
else:
 raise AssertionError('different scope accepted')
assert calls==[]
try:
 case.run(object(),object(),'model',scope,'合計を求める',as_of=date(2026,9,26),discoverer=discover)
except DiagnosticPreflightError:
 pass
else:
 raise AssertionError('different snapshot accepted')
assert calls==['discovered']
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

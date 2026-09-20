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

test('preflight exposes artifacts from the exact final discovery snapshot', () => {
  const result = python(String.raw`
from datetime import date
import preflight
from analysis_contract import AnalysisContract
from analysis_contract_orchestration import DiscoveredContractArtifacts
from bigquery_scope_discovery import AuthorizedScope, DiscoverySnapshot

initial=DiscoverySnapshot('{"version":1}', 'a'*64, '2026-09-20T00:00:00+00:00')
final=DiscoverySnapshot('{"version":2}', 'b'*64, '2026-09-20T00:01:00+00:00')
contract=AnalysisContract('{"version":1}', 'c'*64)
calls=[]
def discover(bq, scope):
 calls.append(('discover', bq, scope))
 return initial
def generate(bq, vertex, model, discovery, question, *, as_of):
 calls.append(('generate', bq, vertex, model, discovery, question, as_of))
 return DiscoveredContractArtifacts(final, contract, {'input_tokens': 7, 'output_tokens': 3})
preflight.discover_scope=discover
preflight.generate_discovered_contract_artifacts=generate
bq=object();vertex=object();scope=AuthorizedScope(tables=frozenset({'project.dataset.table'}))
result=preflight.run_preflight(bq, vertex, 'model', scope, 'question', as_of=date(2026,9,20))
assert result.succeeded and result.failure_stage is None and result.failure_code is None
assert result.discovery is final and result.contract is contract
assert result.usage=={'input_tokens': 7, 'output_tokens': 3}
assert result.runtime_input()=={
 'scope_snapshot_fingerprint':'b'*64,
 'analysis_contract_fingerprint':'c'*64,
 'question':'question',
}
assert result.scope_snapshot_entry('schema-a')=={
 'schema_id':'schema-a','content_json':'{"version":2}',
 'retrieved_at':'2026-09-20T00:01:00+00:00',
}
assert result.analysis_contract_entry('schema-a','case-a')=={
 'schema_id':'schema-a','case_id':'case-a','content_json':'{"version":1}',
}
assert calls==[
 ('discover',bq,scope),
 ('generate',bq,vertex,'model',initial,'question',date(2026,9,20)),
]
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('scope discovery failure is retained without invented artifacts or raw errors', () => {
  const result = python(String.raw`
from datetime import date
import preflight
from bigquery_scope_discovery import AuthorizedScope, ScopeDiscoveryError
from run_outcome import validate_run_outcome

secret='private-provider-detail'
def discover(_bq, _scope):raise ScopeDiscoveryError(secret)
def generate(*_args, **_kwargs):raise AssertionError('contract generation must not run')
preflight.discover_scope=discover
preflight.generate_discovered_contract_artifacts=generate
scope=AuthorizedScope(tables=frozenset({'project.dataset.table'}))
result=preflight.run_preflight(object(),object(),'model',scope,'question',as_of=date(2026,9,20))
assert not result.succeeded
assert (result.failure_stage,result.failure_code)==('scope_discovery','scope_discovery_failed')
assert result.discovery is None and result.contract is None
assert result.usage=={'input_tokens':0,'output_tokens':0}
assert result.runtime_input()=={
 'scope_snapshot_fingerprint':None,
 'analysis_contract_fingerprint':None,
 'question':'question',
}
assert result.scope_snapshot_entry('schema-a') is None
assert result.analysis_contract_entry('schema-a','case-a') is None
assert secret not in repr(result)
recorded=result.failure_recording(
 'schema-a','case-a','run-1',
 {'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64},
 bytes_processed=0,cost_jpy=0.0,
)
assert (recorded['schema_id'],recorded['case_id'])==('schema-a','case-a')
assert recorded['run']['runtime_input']==result.runtime_input()
assert recorded['run']['failure_stage']=='scope_discovery'
assert recorded['run']['failure_code']=='scope_discovery_failed'
validate_run_outcome(recorded['run'])
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('contract generation failure retains only the completed scope artifact', () => {
  const result = python(String.raw`
from datetime import date
import preflight
from bigquery_scope_discovery import AuthorizedScope, DiscoverySnapshot

secret='private-model-response'
snapshot=DiscoverySnapshot('{"version":1}','d'*64,'2026-09-20T00:00:00+00:00')
preflight.discover_scope=lambda _bq,_scope:snapshot
def generate(*_args,**_kwargs):raise RuntimeError(secret)
preflight.generate_discovered_contract_artifacts=generate
scope=AuthorizedScope(tables=frozenset({'project.dataset.table'}))
result=preflight.run_preflight(object(),object(),'model',scope,'question',as_of=date(2026,9,20))
assert not result.succeeded
assert (result.failure_stage,result.failure_code)==(
 'analysis_contract_generation','analysis_contract_generation_failed'
)
assert result.discovery is snapshot and result.contract is None
assert result.usage is None
assert result.runtime_input()=={
 'scope_snapshot_fingerprint':'d'*64,
 'analysis_contract_fingerprint':None,
 'question':'question',
}
assert result.scope_snapshot_entry('schema-a')['content_json']=='{"version":1}'
assert result.analysis_contract_entry('schema-a','case-a') is None
assert secret not in repr(result)
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

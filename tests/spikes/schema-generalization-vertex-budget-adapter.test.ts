import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');
const REPORT_GENERATION = path.join(ROOT, 'spikes/report-generation');

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
from dataclasses import replace
from datetime import date,datetime,timezone
from decimal import Decimal as D
from types import SimpleNamespace as N
from execution_budget import BudgetError,BudgetGate,BudgetLimits
from manifest_runtime_meter import PricingSnapshot
from vertex_budget_adapter import BudgetedVertex
day=date(2026,9,25)
snapshot=PricingSnapshot(
 captured_at=datetime(2026,9,24,tzinfo=timezone.utc),
 source_url='https://cloud.google.com/vertex-ai/generative-ai/pricing',
 currency='JPY',model='gemini-3.6-flash',region='global',
 vertex_tier='standard-text',bigquery_billing='on-demand',
 vertex_input_jpy_per_million='1',vertex_output_jpy_per_million='1',
 bigquery_jpy_per_tib='1',
)
config={'system_instruction':'analyze safely','response_mime_type':'application/json',
 'response_schema':{'type':'object'},'max_output_tokens':1024}
def budget(vertex='3'):
 return BudgetGate(BudgetLimits(D(vertex),D('1'),D(vertex)))
class Models:
 def __init__(self,response=None,error=None):
  self.calls=[];self.response=response;self.error=error
 def generate_content(self,**kwargs):
  self.calls.append(kwargs)
  if self.error:raise self.error
  return self.response
 def generate_content_stream(self,**kwargs):
  raise AssertionError('unbudgeted stream was exposed')
class Client:
 def __init__(self,response=None,error=None):
  self.models=Models(response,error)
  self._api_client=N(vertexai=True,location='global',project='project',
   api_key=None,custom_base_url=None,_http_options=N(extra_body=None))
def adapter(client,gate,price=snapshot):
 return BudgetedVertex(client,gate,price,region='global',execution_date=day)
def response(prompt=10,candidates=20,thoughts=3,tool_prompt=0,total=None):
 if total is None:total=sum(x for x in (prompt,candidates,thoughts,tool_prompt) if type(x) is int)
 return N(usage_metadata=N(prompt_token_count=prompt,
  candidates_token_count=candidates,thoughts_token_count=thoughts,
  tool_use_prompt_token_count=tool_prompt,total_token_count=total))
`;

test('Vertex adapter reserves before one submission and settles exact response usage', () => {
  assert.match(
    readFileSync(path.join(REPORT_GENERATION, 'requirements.txt'), 'utf8'),
    /^google-genai==2\.12\.1$/m,
  );
  assertPython(String.raw`
${setup}
class ModelConfig:
 def model_dump(self,*,exclude_unset):
  assert exclude_unset is True
  return dict(config)
price=replace(snapshot,vertex_input_jpy_per_million='2',vertex_output_jpy_per_million='3')
client=Client(response());gate=budget();vertex=adapter(client,gate,price)
assert vertex.models.generate_content(model='gemini-3.6-flash',contents='question',config=ModelConfig()) is client.models.response
assert len(client.models.calls)==1
sent=client.models.calls[0]
assert sent['model']=='gemini-3.6-flash' and sent['contents']=='question'
assert sent['config']=={**config,'http_options':{'retry_options':{'attempts':1}}}
assert gate.settled_jpy['vertex']==D('0.000089')
assert gate.unresolved_reservation_jpy['vertex']==D('0')
gate.ensure_idle()
client.models.response=response(prompt=1,candidates=1,thoughts=0)
vertex.models.generate_content(model='gemini-3.6-flash',contents='next',config=config)
assert gate.settled_jpy['vertex']==D('0.000094')
assert len(client.models.calls)==2
try:vertex.models.generate_content_stream(model='gemini-3.6-flash',contents='x')
except AttributeError:pass
else:raise AssertionError('unbudgeted streaming method was exposed')
`);
});

test('Vertex adapter rejects pricing, client scope, unsupported config, and budget before submission', () => {
  assertPython(String.raw`
${setup}
for setting in ({**config,'tools':[]},{**config,'http_options':{}},
 {**config,'candidate_count':2},{**config,'thinking_config':None}):
 client=Client(response());gate=budget()
 try:adapter(client,gate).models.generate_content(model='gemini-3.6-flash',contents='q',config=setting)
 except BudgetError:pass
 else:raise AssertionError('unsupported setting was submitted')
 assert client.models.calls==[]
for change in ({'location':'asia-northeast1'},{'vertexai':False},
 {'api_key':'example'},{'custom_base_url':'https://example.test'},
 {'project':None},{'_http_options':N(extra_body={'tools':[]})}):
 client=Client(response());client._api_client.__dict__.update(change)
 try:adapter(client,budget()).models.generate_content(model='gemini-3.6-flash',contents='q',config=config)
 except BudgetError:pass
 else:raise AssertionError('client scope mismatch was submitted')
 assert client.models.calls==[]
client=Client(response());gate=budget('1')
try:adapter(client,gate).models.generate_content(model='gemini-3.6-flash',contents='q',config=config)
except BudgetError:pass
else:raise AssertionError('unaffordable request was submitted')
assert client.models.calls==[]
client=Client(response())
try:adapter(client,budget(),replace(snapshot,region='us-central1')).models.generate_content(model='gemini-3.6-flash',contents='q',config=config)
except BudgetError:pass
else:raise AssertionError('wrong price was accepted')
assert client.models.calls==[]
`);
});

test('Vertex adapter stops with unresolved exposure for invalid or excessive usage', () => {
  assertPython(String.raw`
${setup}
for bad in (N(),response(prompt=None),response(prompt=True),
 response(total=1),response(prompt=1048577),
 response(candidates=65537),response(tool_prompt=1)):
 client=Client(bad);gate=budget();vertex=adapter(client,gate)
 try:vertex.models.generate_content(model='gemini-3.6-flash',contents='q',config=config)
 except BudgetError:pass
 else:raise AssertionError('invalid usage was settled')
 assert len(client.models.calls)==1
 assert gate.settled_jpy['vertex']==D('0')
 assert gate.unresolved_reservation_jpy['vertex']==D('1.114112')
 try:vertex.models.generate_content(model='gemini-3.6-flash',contents='again',config=config)
 except BudgetError:pass
 else:raise AssertionError('stopped gate submitted again')
 assert len(client.models.calls)==1
`);
});

test('Vertex adapter marks provider exceptions unresolved and never retries', () => {
  assertPython(String.raw`
${setup}
client=Client(error=TimeoutError('provider failed'))
gate=budget();vertex=adapter(client,gate)
try:vertex.models.generate_content(model='gemini-3.6-flash',contents='q',config=config)
except TimeoutError:pass
else:raise AssertionError('provider exception was swallowed')
assert len(client.models.calls)==1
assert gate.unresolved_reservation_jpy['vertex']==D('1.114112')
try:gate.ensure_idle()
except BudgetError:pass
else:raise AssertionError('failed reservation was treated as settled')
`);
});

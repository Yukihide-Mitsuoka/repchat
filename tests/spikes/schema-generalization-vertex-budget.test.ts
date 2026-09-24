import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
from manifest_runtime_meter import PricingSnapshot
from execution_budget import BudgetError,BudgetGate,BudgetLimits
from vertex_budget import vertex_text_reservation_jpy
day=date(2026,9,25)
snapshot=PricingSnapshot(
 captured_at=datetime(2026,9,24,tzinfo=timezone.utc),
 source_url='https://cloud.google.com/vertex-ai/generative-ai/pricing',
 currency='JPY',model='gemini-3.6-flash',region='global',
 vertex_tier='standard-text',bigquery_billing='on-demand',
 vertex_input_jpy_per_million='1',vertex_output_jpy_per_million='1',
 bigquery_jpy_per_tib='1',
)
config={'system_instruction':'text only','response_mime_type':'application/json',
 'response_schema':{'type':'object'},'max_output_tokens':1024}
def bound(price=snapshot,contents='analyze this',settings=config,model='gemini-3.6-flash',region='global',when=day):
 return vertex_text_reservation_jpy(
  price,model=model,region=region,execution_date=when,
  contents=contents,generation_config=settings,
 )
`;

test('Vertex text reservation uses model physical input and output ceilings with exact JPY rounding', () => {
  assertPython(String.raw`
${setup}
assert bound()==D('1.114112')
assert bound(settings={**config,'max_output_tokens':1})==D('1.114112')
assert bound(settings={**config,'max_output_tokens':65536,'candidate_count':1})==D('1.114112')
price=replace(snapshot,vertex_input_jpy_per_million='0.10000000000000001',
 vertex_output_jpy_per_million='10')
assert bound(price)==D('0.760218')
`);
});

test('Vertex text reservation rejects settings with unbounded or extra billing paths', () => {
  assertPython(String.raw`
${setup}
for bad in (
 {},{**config,'max_output_tokens':None},{**config,'max_output_tokens':0},
 {**config,'max_output_tokens':True},{**config,'max_output_tokens':65537},
 {**config,'candidate_count':2},{**config,'tools':[{'name':'search'}]},
 {**config,'cached_content':'cache'},
 {**config,'response_mime_type':'image/png'},
 {**config,'thinking_config':{'thinking_budget':1024}},
 {**config,'system_instruction':''},{**config,'response_schema':{}},
 {**config,'max_output_tokens':1.5},{**config,'candidate_count':True},
 {**config,'max_output_tokens':1024,'unknown_option':None},
):
 try:bound(settings=bad)
 except BudgetError:pass
 else:raise AssertionError('unsupported generation config was accepted')
for contents in (None,b'bytes',['text'],{'text':'value'},''):
 try:bound(contents=contents)
 except BudgetError:pass
 else:raise AssertionError('non-text contents were accepted')
`);
});

test('Vertex text reservation rejects unsupported models and mismatched pricing scope', () => {
  assertPython(String.raw`
${setup}
for price in (
 replace(snapshot,currency='USD'),replace(snapshot,vertex_tier='batch'),
 replace(snapshot,vertex_input_jpy_per_million='NaN'),
 replace(snapshot,vertex_output_jpy_per_million='1e308'),
 replace(snapshot,region='asia-northeast1'),
):
 try:bound(price)
 except BudgetError:pass
 else:raise AssertionError('unsupported price was accepted')
for options in (
 {'model':'gemini-3.5-flash'}, {'region':'asia-northeast1'},
 {'when':date(2026,9,23)},
):
 try:bound(**options)
 except BudgetError:pass
 else:raise AssertionError('mismatched execution scope was accepted')
try:bound(replace(snapshot,model='gemini-3.5-flash'),model='gemini-3.5-flash')
except BudgetError:pass
else:raise AssertionError('unsupported model was accepted')
`);
});

test('Vertex text reservation can stop a fake request before provider submission', () => {
  assertPython(String.raw`
${setup}
gate=BudgetGate(BudgetLimits(D('1'),D('1'),D('1')))
called=[]
try:gate.run('vertex',bound(),lambda:(called.append('called'),D('0')))
except BudgetError:pass
else:raise AssertionError('unaffordable call was accepted')
assert called==[]
`);
});

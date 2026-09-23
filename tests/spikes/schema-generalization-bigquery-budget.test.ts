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
from datetime import date,datetime,timezone
from decimal import Decimal as D
from types import SimpleNamespace as Config
from dataclasses import replace
from manifest_runtime_meter import PricingSnapshot,RuntimeMeasurementError
from execution_budget import BudgetGate,BudgetLimits,BudgetError
from bigquery_budget import bigquery_query_reservation_jpy
day=date(2026,9,24)
snapshot=PricingSnapshot(
 captured_at=datetime(2026,9,23,tzinfo=timezone.utc),
 source_url='https://cloud.google.com/bigquery/pricing',
 currency='JPY',model='model',region='asia-northeast1',
 vertex_tier='standard-text',bigquery_billing='on-demand',
 vertex_input_jpy_per_million='1',
 vertex_output_jpy_per_million='1',
 bigquery_jpy_per_tib='0.10000000000000001',
)
def bound(price,bytes_billed,config=None):
 return bigquery_query_reservation_jpy(
  price,model='model',region='asia-northeast1',execution_date=day,
  job_config=config or Config(maximum_bytes_billed=bytes_billed,dry_run=False),
 )
`;

test('BigQuery reservation rounds exact snapshot rates upward to micro-JPY', () => {
  assertPython(String.raw`
${setup}
assert bound(snapshot,1)==D('0.000001')
assert bound(snapshot,2**40)==D('0.100001')
assert bound(replace(snapshot,bigquery_jpy_per_tib='12.5'),2**40)==D('12.500000')
assert bound(replace(snapshot,bigquery_jpy_per_tib='12.5'),2**39)==D('6.250000')
`);
});

test('BigQuery reservation rejects an unbounded or unsupported query configuration', () => {
  assertPython(String.raw`
${setup}
for config in (
 None,Config(maximum_bytes_billed=None,dry_run=False),
 Config(maximum_bytes_billed=0,dry_run=False),
 Config(maximum_bytes_billed=-1,dry_run=False),
 Config(maximum_bytes_billed=True,dry_run=False),
 Config(maximum_bytes_billed=1.5,dry_run=False),
 Config(maximum_bytes_billed=2**63,dry_run=False),
 Config(maximum_bytes_billed=100,dry_run=True),
 Config(maximum_bytes_billed=100,dry_run=None),
 Config(maximum_bytes_billed=100,dry_run='false'),
 Config(maximum_bytes_billed=100,dry_run=False,destination='table'),
 Config(maximum_bytes_billed=100,dry_run=False,connection_properties=['external']),
):
 try:
  bigquery_query_reservation_jpy(
   snapshot,model='model',region='asia-northeast1',
   execution_date=day,job_config=config,
  )
 except BudgetError:pass
 else:raise AssertionError('unsupported query was accepted')
`);
});

test('BigQuery reservation requires matching price scope and representable bound', () => {
  assertPython(String.raw`
${setup}
for price in (
 replace(snapshot,currency='USD'),
 replace(snapshot,bigquery_billing='capacity'),
 replace(snapshot,bigquery_jpy_per_tib='NaN'),
 replace(snapshot,bigquery_jpy_per_tib='1e308'),
):
 try:bound(price,2**40)
 except (BudgetError,RuntimeMeasurementError):pass
 else:raise AssertionError('unsupported price was accepted')
for model,region,execution_date in (
 ('other','asia-northeast1',day),
 ('model','other',day),
 ('model','asia-northeast1',date(2026,9,22)),
):
 try:bigquery_query_reservation_jpy(
  snapshot,model=model,region=region,execution_date=execution_date,
  job_config=Config(maximum_bytes_billed=1,dry_run=False),
 )
 except (BudgetError,RuntimeMeasurementError):pass
 else:raise AssertionError('mismatched price was accepted')
`);
});

test('BigQuery reservation can be checked before each fake query', () => {
  assertPython(String.raw`
${setup}
price=replace(snapshot,bigquery_jpy_per_tib='10')
gate=BudgetGate(BudgetLimits(D('1'),D('10'),D('10')))
called=[]
def query(name,actual):
 called.append(name)
 return name,D(actual)
maximum=bound(price,2**39)
assert gate.run('bigquery',maximum,lambda:query('first','3'))=='first'
assert gate.run('bigquery',maximum,lambda:query('second','4'))=='second'
try:gate.run('bigquery',maximum,lambda:query('third','1'))
except BudgetError:pass
else:raise AssertionError('over-budget query was called')
assert called==['first','second']
`);
});

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
from manifest_runtime_meter import PricingSnapshot
from execution_budget import BudgetGate,BudgetLimits,BudgetError
from bigquery_budget_adapter import BudgetedBigQuery
day=date(2026,9,24)
snapshot=PricingSnapshot(
 captured_at=datetime(2026,9,23,tzinfo=timezone.utc),
 source_url='https://cloud.google.com/bigquery/pricing',
 currency='JPY',model='model',region='asia-northeast1',
 vertex_tier='standard-text',bigquery_billing='on-demand',
 vertex_input_jpy_per_million='1',vertex_output_jpy_per_million='1',
 bigquery_jpy_per_tib='10',
)
def config(bytes_billed=2**39,dry_run=False):
 return Config(maximum_bytes_billed=bytes_billed,dry_run=dry_run)
def gate():return BudgetGate(BudgetLimits(D('1'),D('10'),D('10')))
def adapter(client,budget):
 return BudgetedBigQuery(
  client,budget,snapshot,model='model',region='asia-northeast1',
  execution_date=day,
 )
`;

test('BigQuery adapter reserves before query and settles measured billed bytes after result', () => {
  assertPython(String.raw`
${setup}
class Job:
 total_bytes_billed=2**38
 total_bytes_processed=2**38
 def done(self):return True
 def to_dataframe(self):raise AssertionError('unwrapped fetch was exposed')
 def result(self,**kwargs):
  assert kwargs=={'timeout':20,'retry':None,'job_retry':None}
  return ['row']
class Client:
 default_query_job_config=None
 def __init__(self):self.calls=[]
 def query(self,sql,**kwargs):
  self.calls.append((sql,kwargs))
  return Job()
client=Client();budget=gate();bq=adapter(client,budget)
job=bq.query('SELECT 1',job_config=config())
assert job.done() is True
try:job.total_bytes_processed
except BudgetError:pass
else:raise AssertionError('unsettled metadata was exposed')
try:job.to_dataframe()
except AttributeError:pass
else:raise AssertionError('unbudgeted result method was exposed')
assert budget.settled_jpy['bigquery']==D('0')
assert len(client.calls)==1
assert client.calls[0][1]['retry'] is None
assert client.calls[0][1]['job_retry'] is None
assert job.result(timeout=20)==['row']
assert job.total_bytes_processed==2**38
assert budget.settled_jpy['bigquery']==D('2.500000')
try:job.result(timeout=20)
except BudgetError:pass
else:raise AssertionError('duplicate result was accepted')
Job.total_bytes_billed=1
assert bq.query('SELECT 2',job_config=config()).result(timeout=20)==['row']
assert budget.settled_jpy['bigquery']==D('2.500001')
assert budget.unresolved_reservation_jpy['bigquery']==D('0')
budget.ensure_idle()
`);
});

test('BigQuery adapter rejects unbounded, hidden, and unaffordable query settings before submission', () => {
  assertPython(String.raw`
${setup}
class Client:
 default_query_job_config=None
 def __init__(self):self.calls=0
 def query(self,*args,**kwargs):self.calls+=1;raise AssertionError('query was submitted')
for bad in (
 config(0),config(None),config(2**63),
 Config(maximum_bytes_billed=2**39,dry_run=False,destination='table'),
):
 client=Client();bq=adapter(client,gate())
 try:bq.query('SELECT 1',job_config=bad)
 except BudgetError:pass
 else:raise AssertionError('unsupported query was accepted')
 assert client.calls==0
client=Client();budget=BudgetGate(BudgetLimits(D('1'),D('4'),D('4')))
try:adapter(client,budget).query('SELECT 1',job_config=config())
except BudgetError:pass
else:raise AssertionError('query exceeded remaining budget')
assert client.calls==0
client=Client();client.default_query_job_config=config()
try:adapter(client,gate())
except BudgetError:pass
else:raise AssertionError('hidden client defaults were accepted')
assert client.calls==0
client=Client();bq=adapter(client,gate())
client.default_query_job_config=config()
try:bq.query('SELECT 1',job_config=config())
except BudgetError:pass
else:raise AssertionError('later client defaults were accepted')
assert client.calls==0
`);
});

test('BigQuery adapter stops on missing or excessive billed bytes without releasing the reservation', () => {
  assertPython(String.raw`
${setup}
class Job:
 def __init__(self,billed):self.total_bytes_billed=billed
 def result(self,**kwargs):return []
class Client:
 default_query_job_config=None
 def __init__(self,billed):self.billed=billed;self.calls=0
 def query(self,*args,**kwargs):self.calls+=1;return Job(self.billed)
for billed in (None,True,-1,2**39+1,'123'):
 client=Client(billed);budget=gate();bq=adapter(client,budget)
 try:bq.query('SELECT 1',job_config=config()).result()
 except BudgetError:pass
 else:raise AssertionError('invalid billed bytes were accepted')
 assert client.calls==1
 assert budget.settled_jpy['bigquery']==D('0')
 assert budget.unresolved_reservation_jpy['bigquery']==D('5')
 try:bq.query('SELECT 2',job_config=config())
 except BudgetError:pass
 else:raise AssertionError('stopped adapter submitted another query')
 assert client.calls==1
`);
});

test('BigQuery adapter marks a cancelled job unresolved immediately', () => {
  assertPython(String.raw`
${setup}
class Job:
 def __init__(self):self.cancel_calls=0
 def cancel(self):self.cancel_calls+=1;return True
class Client:
 default_query_job_config=None
 def __init__(self):self.calls=0;self.job=Job()
 def query(self,*args,**kwargs):self.calls+=1;return self.job
client=Client();budget=gate();bq=adapter(client,budget)
job=bq.query('SELECT 1',job_config=config())
assert job.cancel() is True
assert client.job.cancel_calls==1
assert budget.unresolved_reservation_jpy['bigquery']==D('5')
try:bq.query('SELECT 2',job_config=config())
except BudgetError:pass
else:raise AssertionError('cancelled query did not stop the adapter')
assert client.calls==1
`);
});

test('BigQuery adapter permits explicit disabled retries but rejects retry overrides', () => {
  assertPython(String.raw`
${setup}
class Job:
 total_bytes_billed=0
 def __init__(self):self.calls=0
 def result(self,**kwargs):
  self.calls+=1
  assert kwargs=={'retry':None,'job_retry':None}
  return []
class Client:
 default_query_job_config=None
 def __init__(self):self.calls=0;self.job=Job()
 def query(self,*args,**kwargs):self.calls+=1;return self.job
client=Client();budget=gate();bq=adapter(client,budget)
job=bq.query('SELECT 1',job_config=config())
assert job.result(retry=None,job_retry=None)==[]
assert budget.settled_jpy['bigquery']==D('0')
assert client.job.calls==1
client=Client();budget=gate();bq=adapter(client,budget)
job=bq.query('SELECT 1',job_config=config())
try:job.result(job_retry=object())
except BudgetError:pass
else:raise AssertionError('job retry was allowed')
assert client.job.calls==0
assert budget.unresolved_reservation_jpy['bigquery']==D('5')
try:bq.query('SELECT 2',job_config=config(),job_retry=object())
except (BudgetError,TypeError):pass
else:raise AssertionError('query retry was allowed')
assert client.calls==1
`);
});

test('BigQuery adapter preserves unresolved exposure after submit or wait failure', () => {
  assertPython(String.raw`
${setup}
class Job:
 def result(self,**kwargs):raise TimeoutError('wait timed out')
class Client:
 default_query_job_config=None
 def __init__(self,fail_submit):self.fail_submit=fail_submit;self.calls=0
 def query(self,*args,**kwargs):
  self.calls+=1
  if self.fail_submit:raise RuntimeError('submit failed')
  return Job()
for fail_submit in (True,False):
 client=Client(fail_submit);budget=gate();bq=adapter(client,budget)
 try:
  job=bq.query('SELECT 1',job_config=config())
  job.result(timeout=20)
 except (RuntimeError,TimeoutError):pass
 else:raise AssertionError('provider failure was swallowed')
 assert budget.unresolved_reservation_jpy['bigquery']==D('5')
 try:bq.query('SELECT 2',job_config=config())
 except BudgetError:pass
 else:raise AssertionError('failure allowed another query')
 assert client.calls==1
`);
});

test('BigQuery adapter leaves dry runs and metadata reads uncharged and blocks unwrapped query methods', () => {
  assertPython(String.raw`
${setup}
class Client:
 default_query_job_config=None
 def __init__(self):self.calls=[];self.job=object()
 def query(self,*args,**kwargs):self.calls.append(kwargs);return self.job
 def list_tables(self,*args,**kwargs):return ['table']
 def get_table(self,*args,**kwargs):return 'table metadata'
 def query_and_wait(self,*args,**kwargs):raise AssertionError('unwrapped paid query')
client=Client();budget=gate();bq=adapter(client,budget)
assert bq.list_tables('dataset')==['table']
assert bq.get_table('table')=='table metadata'
assert bq.query('SELECT 1',job_config=config(dry_run=True)) is client.job
assert client.calls[0]['retry'] is None
assert client.calls[0]['job_retry'] is None
assert budget.settled_jpy['bigquery']==D('0')
budget.ensure_idle()
try:bq.query_and_wait('SELECT 1')
except AttributeError:pass
else:raise AssertionError('unbudgeted query method was exposed')
`);
});

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
from types import SimpleNamespace
import manifest_runtime_meter as runtime
class Job:
 def __init__(self,processed,billed):
  self.total_bytes_processed=processed;self.total_bytes_billed=billed;self.results=0
 def result(self,*_args,**_kwargs):self.results+=1;return ('rows',)
class BQ:
 def __init__(self,jobs):self.jobs=list(jobs);self.seen=[]
 def query(self,sql,*,job_config):
  self.seen.append((sql,job_config.dry_run));return self.jobs.pop(0)
class Models:
 def __init__(self,responses):self.responses=list(responses);self.calls=0
 def generate_content(self,**_kwargs):self.calls+=1;return self.responses.pop(0)
class Vertex:
 def __init__(self,responses):self.models=Models(responses)
def response(prompt,candidate,thought=0,tool=0):
 total=prompt+candidate+thought+tool
 return SimpleNamespace(usage_metadata=SimpleNamespace(
  prompt_token_count=prompt,candidates_token_count=candidate,
  thoughts_token_count=thought,tool_use_prompt_token_count=tool,
  total_token_count=total,
 ))
pricing=runtime.RuntimePricing(
 vertex_input_jpy_per_million=1000000,
 vertex_output_jpy_per_million=2000000,
 bigquery_jpy_per_tib=2**40,
)
`;

test('runtime meter totals every response and completed BigQuery job', () => {
  assertPython(String.raw`
${setup}
jobs=[Job(900,None),Job(40,64),Job(60,96)]
bq_source=BQ(jobs);vertex_source=Vertex([response(10,4,2,3),response(7,3,1)])
meter=runtime.RuntimeMeter(pricing);bq,vertex=meter.instrument(bq_source,vertex_source)
def execute():
 dry=bq.query('dry',job_config=SimpleNamespace(dry_run=True))
 assert dry.total_bytes_processed==900
 assert bq.query('scope',job_config=SimpleNamespace(dry_run=False)).result()==('rows',)
 assert vertex.models.generate_content().usage_metadata.prompt_token_count==10
 assert vertex.models.generate_content().usage_metadata.prompt_token_count==7
 assert bq.query('analysis',job_config=SimpleNamespace(dry_run=False)).result()==('rows',)
 return object()
measurement=meter(('schema','case','run'),execute)
assert measurement.bytes_processed==100
# input=20, output=10, billed bytes=160 with deliberately simple test rates.
assert measurement.cost_jpy==200
assert bq_source.seen==[('dry',True),('scope',False),('analysis',False)]
assert vertex_source.models.calls==2
assert meter(('schema','case','next-run'),lambda:object()).bytes_processed==0
try:bq.query('outside',job_config=SimpleNamespace(dry_run=False))
except runtime.RuntimeMeasurementError:pass
else:raise AssertionError('unmeasured provider call was accepted')
`);
});

test('runtime meter fails closed on missing or inconsistent provider metadata', () => {
  assertPython(String.raw`
${setup}
def run_with(job,response_value):
 meter=runtime.RuntimeMeter(pricing)
 bq,vertex=meter.instrument(BQ([job]),Vertex([response_value]))
 def execute():
  try:bq.query('analysis',job_config=SimpleNamespace(dry_run=False)).result()
  except runtime.RuntimeMeasurementError:pass
  try:vertex.models.generate_content()
  except runtime.RuntimeMeasurementError:pass
  return object()
 return meter(('schema','case','run'),execute)
for job,response_value in (
 (Job(None,10),response(1,1)),
 (Job(10,None),response(1,1)),
 (Job(10,10),SimpleNamespace(usage_metadata=None)),
 (Job(10,10),response(1,1,tool=2)),
):
 if response_value.usage_metadata is not None:
  response_value.usage_metadata.total_token_count+=1
 try:run_with(job,response_value)
 except runtime.RuntimeMeasurementError:pass
 else:raise AssertionError('incomplete provider measurement was accepted')
meter=runtime.RuntimeMeter(pricing);bq,_vertex=meter.instrument(BQ([Job(None,None)]),Vertex([]))
try:meter(('schema','case','run'),lambda:bq.query('dry',job_config=SimpleNamespace(dry_run=True)))
except runtime.RuntimeMeasurementError:pass
else:raise AssertionError('dry run without an estimate was accepted')
meter=runtime.RuntimeMeter(pricing);bq,_vertex=meter.instrument(BQ([Job(10,10)]),Vertex([]))
try:meter(('schema','case','run'),lambda:bq.query('abandoned',job_config=SimpleNamespace(dry_run=False)))
except runtime.RuntimeMeasurementError as error:assert str(error)=='BigQuery query job did not complete'
else:raise AssertionError('unfinished BigQuery job was accepted')
`);
});

test('provider exceptions remain unmeasurable even when the runner catches them', () => {
  assertPython(String.raw`
${setup}
class BrokenBQ:
 def query(self,*_args,**_kwargs):raise RuntimeError('private provider detail')
class BrokenModels:
 def generate_content(self,**_kwargs):raise RuntimeError('private provider detail')
for client_kind in ('bq','vertex'):
 meter=runtime.RuntimeMeter(pricing)
 bq,vertex=meter.instrument(BrokenBQ(),SimpleNamespace(models=BrokenModels()))
 def execute():
  try:
   if client_kind=='bq':bq.query('analysis',job_config=SimpleNamespace(dry_run=False))
   else:vertex.models.generate_content()
  except runtime.RuntimeMeasurementError:pass
  return object()
 try:meter(('schema','case','run'),execute)
 except runtime.RuntimeMeasurementError as error:assert 'private provider detail' not in str(error)
 else:raise AssertionError('unmeasured provider failure was accepted')
`);
});

test('metered evaluation instruments the exact clients passed to the renderer', () => {
  assertPython(String.raw`
${setup}
seen=[]
def evaluation(manifest,bq,vertex,model,**kwargs):
 assert (manifest,model)==({'manifest':True},'model')
 def execute():
  bq.query('analysis',job_config=SimpleNamespace(dry_run=False)).result()
  vertex.models.generate_content()
  return object()
 measured=kwargs['meter'](('schema','case','run'),execute)
 seen.append((measured.bytes_processed,measured.cost_jpy))
 return {'recordings':'path'}
runtime.run_measured_manifest_evaluation=evaluation
result=runtime.run_runtime_metered_manifest_evaluation(
 {'manifest':True},BQ([Job(5,7)]),Vertex([response(2,3)]),'model',
 as_of=object(),output_directory='out',pricing=pricing,
)
assert result=={'recordings':'path'} and seen==[(5,15)]
`);
});

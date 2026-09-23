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
from types import MappingProxyType,SimpleNamespace
import manifest_artifacts as artifacts
from bigquery_scope_discovery import DiscoverySnapshot
from manifest_dry_run import DryRunAttempt
from manifest_execution import ExecutionAttempt
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from manifest_rendering import RenderingAttempt
from manifest_result_validation import ResultValidationAttempt
from manifest_sql_generation import GeneratedSQLAttempt
from manifest_sql_validation import ValidatedSQLAttempt
from preflight import PreflightResult
pipeline={'runtime':'1'*64,'prompt':'2'*64,'configuration':'3'*64}
manifest={
 'version':1,'evaluation_plan_sha256':'4'*64,'pipeline':pipeline,
 'schemas':[{'schema_id':'schema-a','authorized_scope':{
  'datasets':[],'tables':['alpha.dataset.records'],
 },'cases':[{'case_id':'case-a','question':'区分別の値を集計して','run_ids':['run-1','run-2']}]}],
}
def make_attempt(run_id,snapshot_json='{"version":1}',contract_json='{"version":1}',rendered=True):
 snapshot=DiscoverySnapshot(snapshot_json,'a'*64,'2026-09-21T00:00:00+00:00')
 contract=SimpleNamespace(content_json=contract_json,fingerprint='b'*64)
 preflight=PreflightResult('区分別の値を集計して',snapshot,contract,{'input_tokens':1,'output_tokens':1})
 identity=PlannedPreflightAttempt('schema-a','case-a',run_id,MappingProxyType(pipeline),preflight)
 planned=PlannedAnalysisAttempt(identity,{'panels':[{'id':'P1'}]},0.25)
 generated=GeneratedSQLAttempt(planned,{'id':'P1'},'SELECT 1',0.5)
 validated=ValidatedSQLAttempt(generated,'SELECT 1')
 dry=DryRunAttempt(validated,(('metric_value','INT64','NULLABLE'),),42)
 executed=ExecutionAttempt(dry,((1,),),('metric_value',),84)
 result=ResultValidationAttempt(executed,((1,),),('metric_value',),'scalar',84)
 return RenderingAttempt(result,rendered,None if rendered else 'rendering',None if rendered else 'rendering_failed')
def make_preflight_failure(run_id,stage,discovery,code=None):
 code=code or stage+'_failed'
 preflight=PreflightResult('区分別の値を集計して',discovery,None,None,stage,code)
 identity=PlannedPreflightAttempt('schema-a','case-a',run_id,MappingProxyType(pipeline),preflight)
 planned=PlannedAnalysisAttempt(identity,None,None,stage,code)
 generated=GeneratedSQLAttempt(planned,None,None,None,stage,code)
 validated=ValidatedSQLAttempt(generated,None,stage,code)
 dry=DryRunAttempt(validated,None,None,stage,code)
 executed=ExecutionAttempt(dry,None,None,None,stage,code)
 result=ResultValidationAttempt(executed,None,None,None,None,stage,code)
 return RenderingAttempt(result,False,stage,code)
attempts=(make_attempt('run-1'),make_attempt('run-2',rendered=False))
measurements={
 ('schema-a','case-a','run-1'):artifacts.RunMeasurement(84,0.75),
 ('schema-a','case-a','run-2'):artifacts.RunMeasurement(84,0.8),
}
`;

test('planned attempts become deduplicated assembler inputs and secure files', () => {
  assertPython(String.raw`
${setup}
import json,stat,tempfile
from pathlib import Path
bundle=artifacts.build_manifest_artifacts(manifest,attempts,measurements)
assert bundle.recordings['version']==7
assert bundle.recordings['evaluation_plan_sha256']=='4'*64
assert [item['run']['run_id'] for item in bundle.recordings['runs']]==['run-1','run-2']
assert [item['run']['diagnostic'] for item in bundle.recordings['runs']]==[None,None]
assert [item['run']['failure_kind'] for item in bundle.recordings['runs']]==['none','quality']
assert bundle.recordings['runs'][1]['run']['failure_stage']=='rendering'
assert bundle.scope_snapshots=={'version':1,'snapshots':[{
 'schema_id':'schema-a','content_json':'{"version":1}',
 'retrieved_at':'2026-09-21T00:00:00+00:00',
}]}
assert bundle.analysis_contracts=={'version':1,'contracts':[{
 'schema_id':'schema-a','case_id':'case-a','content_json':'{"version":1}',
}]}
parent=Path(tempfile.mkdtemp())
output=parent/'evaluation-run'
paths=artifacts.write_manifest_artifacts(output,bundle)
assert stat.S_IMODE(output.stat().st_mode)==0o700
assert set(paths)=={'recordings','scope_snapshots','analysis_contracts'}
for artifact_path in paths.values():
 assert stat.S_IMODE(artifact_path.stat().st_mode)==0o600
 assert '\n' not in artifact_path.read_text(encoding='utf-8')
assert json.loads(paths['recordings'].read_text())==bundle.recordings
`);
});

test('recordings retain only closed diagnostic identifiers from a failed attempt', () => {
  assertPython(String.raw`
${setup}
from dataclasses import replace
from sql_diagnostic import SQLDiagnosticCode,sql_diagnostic
base=make_attempt('run-1')
failed_execution=replace(
 base.result_attempt.execution_attempt,
 rows=None,columns=None,bytes_processed=None,
 failure_stage='execution',failure_code='execution_failed',
 diagnostic=sql_diagnostic(SQLDiagnosticCode.EXECUTION_PROVIDER_FAILURE),
)
failed_result=replace(
 base.result_attempt,execution_attempt=failed_execution,
 rows=None,columns=None,visualization=None,bytes_processed=None,
 failure_stage='execution',failure_code='execution_failed',
)
failed=RenderingAttempt(failed_result,False,'execution','execution_failed')
bundle=artifacts.build_manifest_artifacts(
 manifest,(failed,make_attempt('run-2')),measurements,
)
diagnostic=bundle.recordings['runs'][0]['run']['diagnostic']
assert diagnostic=={'code':'execution_provider_failure','category':'provider_failure'}
assert bundle.recordings['runs'][0]['run']['failure_kind']=='infrastructure'
assert 'message' not in diagnostic
unsafe=replace(failed_result,execution_attempt=replace(failed_execution,diagnostic='private provider message'))
try:
 artifacts.build_manifest_artifacts(
  manifest,(RenderingAttempt(unsafe,False,'execution','execution_failed'),make_attempt('run-2')),
  measurements,
 )
except artifacts.ManifestArtifactError as error:
 assert str(error)=='recorded diagnostic must use the closed SQL type'
 assert 'private provider message' not in str(error)
else:
 raise AssertionError('raw provider message reached the recording')
`);
});

test('renderer infrastructure failure is recorded without SQL diagnostics', () => {
  assertPython(String.raw`
${setup}
from dataclasses import replace
base=make_attempt('run-1')
failed=replace(base,render_succeeded=False,failure_stage='rendering',failure_code='renderer_infrastructure_failed')
recording=artifacts.build_manifest_artifacts(
 manifest,(failed,make_attempt('run-2')),measurements,
).recordings['runs'][0]['run']
assert recording['failure_kind']=='infrastructure'
assert recording['diagnostic'] is None
assert recording['actual_rows']==[[1]]
assert recording['bytes_processed']==84
`);
});

test('upstream SQL and dry-run diagnostics survive final recording', () => {
  assertPython(String.raw`
${setup}
from dataclasses import replace
from sql_diagnostic import SQLDiagnosticCode,sql_diagnostic
base=make_attempt('run-1')
for stage,code,flags in (
 ('sql_validation',SQLDiagnosticCode.FORBIDDEN_KEYWORD,{'dangerous_sql':True}),
 ('dry_run',SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED,{'scan_limit_exceeded':True}),
):
 diagnostic=sql_diagnostic(code)
 original_execution=base.result_attempt.execution_attempt
 original_dry=original_execution.dry_run_attempt
 original_validated=original_dry.validated_attempt
 validated=replace(
  original_validated,
  validated_sql=None if stage=='sql_validation' else original_validated.validated_sql,
  failure_stage=stage if stage=='sql_validation' else None,
  failure_code='sql_validation_failed' if stage=='sql_validation' else None,
  diagnostic=diagnostic if stage=='sql_validation' else None,
  **(flags if stage=='sql_validation' else {}),
 )
 dry=replace(
  original_dry,validated_attempt=validated,dry_run_schema=None,
  estimated_bytes_processed=None,failure_stage=stage,
  failure_code=stage+'_failed',diagnostic=diagnostic,**flags,
 )
 execution=replace(
  original_execution,dry_run_attempt=dry,rows=None,columns=None,
  bytes_processed=None,failure_stage=stage,failure_code=stage+'_failed',
  diagnostic=diagnostic,
  **({'scan_limit_exceeded':True} if stage=='dry_run' else {}),
 )
 result=replace(
  base.result_attempt,execution_attempt=execution,rows=None,columns=None,
  visualization=None,bytes_processed=None,failure_stage=stage,
  failure_code=stage+'_failed',
 )
 failed=RenderingAttempt(result,False,stage,stage+'_failed')
 recording=artifacts.build_manifest_artifacts(
  manifest,(failed,make_attempt('run-2')),measurements,
 ).recordings['runs'][0]['run']
 assert recording['diagnostic']=={'code':code.value,'category':diagnostic.category.value}
`);
});

test('missing measurements and conflicting runtime artifacts fail closed', () => {
  assertPython(String.raw`
${setup}
for candidate,message in (
 ({key:value for key,value in measurements.items() if key[-1]=='run-1'},'measurements must match planned runs exactly'),
 ({**measurements,('schema-a','case-a','run-3'):artifacts.RunMeasurement(0,0)},'measurements must match planned runs exactly'),
):
 try:artifacts.build_manifest_artifacts(manifest,attempts,candidate)
 except artifacts.ManifestArtifactError as error:assert str(error)==message
 else:raise AssertionError('invalid measurements were accepted')
conflicting=(attempts[0],make_attempt('run-2',snapshot_json='{"version":2}'))
try:artifacts.build_manifest_artifacts(manifest,conflicting,measurements)
except artifacts.ManifestArtifactError as error:assert str(error)=='scope snapshot changed within one schema evaluation'
else:raise AssertionError('conflicting snapshots were accepted')
invalid=dict(measurements);invalid[('schema-a','case-a','run-2')]=artifacts.RunMeasurement(84,float('nan'))
try:artifacts.build_manifest_artifacts(manifest,attempts,invalid)
except artifacts.ManifestArtifactError as error:assert str(error)=='run measurements must contain non-negative bytes and finite cost'
else:raise AssertionError('invalid measurement was accepted')
`);
});

test('preflight failures emit only artifacts that actually exist', () => {
  assertPython(String.raw`
${setup}
snapshot=DiscoverySnapshot('{"version":1}','a'*64,'2026-09-21T00:00:00+00:00')
failed=(
 make_preflight_failure('run-1','scope_discovery',None),
 make_preflight_failure('run-2','analysis_contract_generation',snapshot),
)
measured={key:artifacts.RunMeasurement(0,0.1) for key in measurements}
bundle=artifacts.build_manifest_artifacts(manifest,failed,measured)
assert [item['run']['failure_stage'] for item in bundle.recordings['runs']]==['scope_discovery','analysis_contract_generation']
assert len(bundle.scope_snapshots['snapshots'])==1
assert bundle.analysis_contracts=={'version':1,'contracts':[]}
`);
});

test('typed preflight infrastructure failures retain measured accounting and no diagnostic', () => {
  assertPython(String.raw`
${setup}
from run_outcome import RunOutcomeError,validate_failure_kind
snapshot=DiscoverySnapshot('{"version":1}','a'*64,'2026-09-21T00:00:00+00:00')
failed=(
 make_preflight_failure('run-1','scope_discovery',None,'scope_discovery_infrastructure_failed'),
 make_preflight_failure('run-2','analysis_contract_generation',snapshot,'analysis_contract_generation_infrastructure_failed'),
)
measured={
 ('schema-a','case-a','run-1'):artifacts.RunMeasurement(0,0),
 ('schema-a','case-a','run-2'):artifacts.RunMeasurement(72,0.4),
}
bundle=artifacts.build_manifest_artifacts(manifest,failed,measured)
runs=[item['run'] for item in bundle.recordings['runs']]
assert [run['failure_kind'] for run in runs]==['infrastructure','infrastructure']
assert [run['diagnostic'] for run in runs]==[None,None]
assert [(run['bytes_processed'],run['cost_jpy']) for run in runs]==[(0,0),(72,0.4)]
assert bundle.scope_snapshots['snapshots']==[{
 'schema_id':'schema-a','content_json':'{"version":1}',
 'retrieved_at':'2026-09-21T00:00:00+00:00',
}]
assert bundle.analysis_contracts=={'version':1,'contracts':[]}
for run in runs:
 run['failure_kind']='quality'
 try:validate_failure_kind(run)
 except RunOutcomeError as error:assert str(error)=='failure kind conflicts with its outcome'
 else:raise AssertionError('typed infrastructure failure was accepted as quality')
runs[0]['failure_kind']='infrastructure'
runs[0]['failure_stage']='analysis_contract_generation'
try:validate_failure_kind(runs[0])
except RunOutcomeError as error:assert str(error)=='infrastructure failure code conflicts with its stage'
else:raise AssertionError('infrastructure code was accepted at the wrong stage')
`);
});

test('artifact output never overwrites an existing directory', () => {
  assertPython(String.raw`
${setup}
import tempfile
from pathlib import Path
bundle=artifacts.build_manifest_artifacts(manifest,attempts,measurements)
output=Path(tempfile.mkdtemp())/'evaluation-run'
output.mkdir();marker=output/'preserved';marker.write_text('keep')
try:artifacts.write_manifest_artifacts(output,bundle)
except FileExistsError:pass
else:raise AssertionError('existing output was overwritten')
assert marker.read_text()=='keep' and list(output.iterdir())==[marker]
`);
});

test('measured evaluation runs each planned identity once and writes artifacts', () => {
  assertPython(String.raw`
${setup}
import json,tempfile
from datetime import date
from pathlib import Path
seen=[]
def rendering_runner(single,bq,vertex,model,*,as_of):
 item=single['schemas'][0];case=item['cases'][0];run_id=case['run_ids'][0]
 assert len(single['schemas'])==len(item['cases'])==len(case['run_ids'])==1
 assert (bq,vertex,model,as_of)==('bq','vertex','model',date(2026,9,21))
 seen.append(('run',run_id))
 return (make_attempt(run_id),)
def meter(identity,execute):
 seen.append(('start',identity[-1]));attempt=execute();seen.append(('finish',identity[-1]))
 assert isinstance(attempt,RenderingAttempt)
 return measurements[identity]
output=Path(tempfile.mkdtemp())/'evaluation-run'
paths=artifacts.run_measured_manifest_evaluation(
 manifest,'bq','vertex','model',as_of=date(2026,9,21),
 output_directory=output,meter=meter,rendering_runner=rendering_runner,
)
assert seen==[
 ('start','run-1'),('run','run-1'),('finish','run-1'),
 ('start','run-2'),('run','run-2'),('finish','run-2'),
]
recorded=json.loads(paths['recordings'].read_text())
assert [item['run']['run_id'] for item in recorded['runs']]==['run-1','run-2']
`);
});

test('measured evaluation rejects unsafe output and meter execution counts', () => {
  assertPython(String.raw`
${setup}
import tempfile
from datetime import date
from pathlib import Path
parent=Path(tempfile.mkdtemp());existing=parent/'existing';existing.mkdir()
calls=[]
def rendering_runner(single,*_args,**_kwargs):
 calls.append(single);return (make_attempt(single['schemas'][0]['cases'][0]['run_ids'][0]),)
def once(identity,execute):return measurements[identity] if execute() else None
try:artifacts.run_measured_manifest_evaluation(
 manifest,object(),object(),'model',as_of=date(2026,9,21),output_directory=existing,
 meter=once,rendering_runner=rendering_runner,
)
except FileExistsError:pass
else:raise AssertionError('existing output was accepted')
assert calls==[]
def skipped(identity,_execute):return measurements[identity]
try:artifacts.run_measured_manifest_evaluation(
 manifest,object(),object(),'model',as_of=date(2026,9,21),output_directory=parent/'skipped',
 meter=skipped,rendering_runner=rendering_runner,
)
except artifacts.ManifestArtifactError as error:assert str(error)=='meter must execute each planned run exactly once'
else:raise AssertionError('skipped execution was accepted')
def repeated(_identity,execute):execute();return artifacts.RunMeasurement(0,0) if execute() else None
try:artifacts.run_measured_manifest_evaluation(
 manifest,object(),object(),'model',as_of=date(2026,9,21),output_directory=parent/'repeated',
 meter=repeated,rendering_runner=rendering_runner,
)
except artifacts.ManifestArtifactError as error:assert str(error)=='meter must execute each planned run exactly once'
else:raise AssertionError('repeated execution was accepted')
`);
});

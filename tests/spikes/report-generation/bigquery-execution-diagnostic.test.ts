import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './live-demo-test-helpers.ts';

const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');

function assertPython(body: string) {
  const result = spawnSync(
    'python3',
    ['-c', `import sys\nsys.path.insert(0,${JSON.stringify(MODULE_DIR)})\n${body}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import types
from types import SimpleNamespace
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy
import bigquery_execution as execution
from sql_diagnostic import SQLDiagnosticCategory,SQLDiagnosticCode
table='alpha.dataset.records'
policy=AnalysisExecutionPolicy(
 frozenset({table}),frozenset({table}),100,20,None,
 (AnalysisFieldPolicy(table,('record_id',),'STRING','REQUIRED',False,False),),
)
sql='SELECT r.record_id FROM '+chr(96)+table+chr(96)+' AS r'
bigquery=types.ModuleType('google.cloud.bigquery')
bigquery.QueryJobConfig=lambda **kwargs:SimpleNamespace(**kwargs)
cloud=types.ModuleType('google.cloud');cloud.bigquery=bigquery
google=types.ModuleType('google');google.cloud=cloud
sys.modules.update({'google':google,'google.cloud':cloud,'google.cloud.bigquery':bigquery})
class Rows(list):schema=[SimpleNamespace(name='record_id')]
class Client:
 def __init__(self,value):self.value=value
 def query(self,*_args,**_kwargs):
  if isinstance(self.value,Exception):raise self.value
  return self.value
`;

test('execution metadata and provider failures return closed diagnostics', () => {
  assertPython(String.raw`
${setup}
class MissingBytesJob:
 def result(self,**_kwargs):return Rows([{'record_id':'value'}])
class ScanJob:
 def result(self,**_kwargs):raise RuntimeError('maximum bytes billed limit exceeded for private-table')
class ProviderFailure(RuntimeError):pass
cases=(
 (Client(MissingBytesJob()),SQLDiagnosticCode.EXECUTION_BYTES_MISSING,SQLDiagnosticCategory.PROVIDER_FAILURE),
 (Client(ScanJob()),SQLDiagnosticCode.EXECUTION_SCAN_LIMIT_EXCEEDED,SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED),
 (Client(ProviderFailure('credential for private-table expired')),SQLDiagnosticCode.EXECUTION_PROVIDER_FAILURE,SQLDiagnosticCategory.PROVIDER_FAILURE),
)
for client,code,category in cases:
 result,diagnostic=execution.execute_bq_diagnostic(client,sql,policy=policy)
 assert result is None
 assert (diagnostic.code,diagnostic.category)==(code,category)
 assert 'private-table' not in diagnostic.message
result,message=execution.execute_bq(
 Client(ProviderFailure('credential for private-table expired')),sql,policy=policy,
)
assert result is None
assert message=='bq error: ProviderFailure: credential for private-table expired'
`);
});

test('execution cancellation and timeout have distinct closed categories', () => {
  assertPython(String.raw`
${setup}
class PendingJob:
 def __init__(self):self.cancelled=False
 def done(self):return False
 def cancel(self):self.cancelled=True
class CancelEvent:
 def __init__(self,should_cancel):self.should_cancel=should_cancel
 def wait(self,_seconds):return self.should_cancel
cancel_job=PendingJob()
result,diagnostic=execution.execute_bq_diagnostic(
 Client(cancel_job),sql,cancel_event=CancelEvent(True),policy=policy,
)
assert result is None and cancel_job.cancelled
assert diagnostic.code is SQLDiagnosticCode.EXECUTION_CANCELLED
assert diagnostic.category is SQLDiagnosticCategory.CANCELLED
timeout_job=PendingJob()
moments=iter((0,181))
execution.time.monotonic=lambda:next(moments)
result,diagnostic=execution.execute_bq_diagnostic(
 Client(timeout_job),sql,cancel_event=CancelEvent(False),policy=policy,
)
assert result is None and timeout_job.cancelled
assert diagnostic.code is SQLDiagnosticCode.EXECUTION_TIMEOUT
assert diagnostic.category is SQLDiagnosticCategory.INFRASTRUCTURE_FAILURE
`);
});

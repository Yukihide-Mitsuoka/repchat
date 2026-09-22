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
from bigquery_execution import inspect_bq_dry_run_diagnostic
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
def job(**changes):
 values={
  'statement_type':'SELECT',
  'referenced_tables':[SimpleNamespace(project='alpha',dataset_id='dataset',table_id='records')],
  'schema':[SimpleNamespace(name='record_id',field_type='STRING',mode='REQUIRED')],
  'total_bytes_processed':12,
 }
 values.update(changes)
 return SimpleNamespace(**values)
class Client:
 def __init__(self,value):self.value=value
 def query(self,*_args,**_kwargs):return self.value
`;

test('dry run metadata failures return closed diagnostic codes and categories', () => {
  assertPython(String.raw`
${setup}
cases=(
 (job(statement_type='DELETE'),SQLDiagnosticCode.DRY_RUN_STATEMENT_NOT_SELECT,SQLDiagnosticCategory.DANGEROUS_SQL,True),
 (job(referenced_tables=[]),SQLDiagnosticCode.DRY_RUN_REFERENCES_MISSING,SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,True),
 (job(referenced_tables=[SimpleNamespace(project='alpha',dataset_id=None,table_id='records')]),SQLDiagnosticCode.DRY_RUN_REFERENCE_INCOMPLETE,SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,True),
 (job(referenced_tables=[SimpleNamespace(project='other',dataset_id='dataset',table_id='records')]),SQLDiagnosticCode.DRY_RUN_TABLE_OUTSIDE_SCOPE,SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE,True),
 (job(total_bytes_processed=None),SQLDiagnosticCode.DRY_RUN_BYTES_MISSING,SQLDiagnosticCategory.PROVIDER_FAILURE,False),
 (job(total_bytes_processed=101),SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED,SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED,True),
)
for value,code,category,has_inspection in cases:
 inspection,diagnostic=inspect_bq_dry_run_diagnostic(Client(value),sql,policy=policy)
 assert (inspection is not None)==has_inspection,code
 assert diagnostic.code is code
 assert diagnostic.category is category
 assert isinstance(diagnostic.message,str) and diagnostic.message
 assert table not in diagnostic.message
`);
});

test('provider failures expose only fixed typed messages while the display adapter remains compatible', () => {
  assertPython(String.raw`
${setup}
import bigquery_execution as execution
class FailureClient:
 def __init__(self,error):self.error=error
 def query(self,*_args,**_kwargs):raise self.error
class ProviderFailure(RuntimeError):pass
scan=ProviderFailure('maximum bytes billed limit exceeded for private-table')
provider=ProviderFailure('credential for private-table expired')
for error,code,category in (
 (scan,SQLDiagnosticCode.DRY_RUN_SCAN_LIMIT_EXCEEDED,SQLDiagnosticCategory.SCAN_LIMIT_EXCEEDED),
 (provider,SQLDiagnosticCode.DRY_RUN_PROVIDER_FAILURE,SQLDiagnosticCategory.PROVIDER_FAILURE),
):
 inspection,diagnostic=inspect_bq_dry_run_diagnostic(FailureClient(error),sql,policy=policy)
 assert inspection is None
 assert (diagnostic.code,diagnostic.category)==(code,category)
 assert 'private-table' not in diagnostic.message
inspection,message=execution.inspect_bq_dry_run(FailureClient(provider),sql,policy=policy)
assert inspection is None
assert message=='bq dry-run error: ProviderFailure: credential for private-table expired'
`);
});

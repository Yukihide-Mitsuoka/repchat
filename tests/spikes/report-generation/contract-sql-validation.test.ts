import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');
const records = 'alpha.dataset.records';
const accounts = 'alpha.dataset.accounts';
const events = 'alpha.dataset.events_*';

function validate(sqls: string[], throughExecutionBoundary = false) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy
import contract_sql_validation as validation
import bigquery_execution
payload=json.load(sys.stdin)
records=${JSON.stringify(records)}
accounts=${JSON.stringify(accounts)}
fields=(
 AnalysisFieldPolicy(records,("record_id",),"STRING","REQUIRED",False,False),
 AnalysisFieldPolicy(records,("account_id",),"STRING","NULLABLE",False,False),
 AnalysisFieldPolicy(records,("payload",),"RECORD","NULLABLE",False,False),
 AnalysisFieldPolicy(records,("payload","label"),"STRING","NULLABLE",False,False),
 AnalysisFieldPolicy(records,("payload","secret"),"STRING","NULLABLE",False,True),
 AnalysisFieldPolicy(records,("private_note",),"STRING","NULLABLE",False,True),
 AnalysisFieldPolicy(records,("items",),"RECORD","REPEATED",True,False),
 AnalysisFieldPolicy(records,("items","amount"),"NUMERIC","NULLABLE",True,False),
 AnalysisFieldPolicy(records,("items","codes"),"STRING","REPEATED",True,False),
 AnalysisFieldPolicy(records,("tags",),"STRING","REPEATED",True,False),
 AnalysisFieldPolicy(accounts,("account_id",),"STRING","REQUIRED",False,False),
 AnalysisFieldPolicy(accounts,("items",),"STRING","REPEATED",True,False),
 AnalysisFieldPolicy(${JSON.stringify(events)},("_TABLE_SUFFIX",),"STRING","REQUIRED",False,False),
)
policy=AnalysisExecutionPolicy(frozenset({records,accounts,${JSON.stringify(events)}}),frozenset({records,accounts,${JSON.stringify(events)}}),100,20,None,fields)
if payload["execution"]:
 output=[bigquery_execution.validate_sql(sql,policy=policy)[1] for sql in payload["sqls"]]
else:
 output=[validation.contract_sql_diagnostic(sql,policy) for sql in payload["sqls"]]
print(json.dumps(output,ensure_ascii=False))`,
    ],
    {
      cwd: ROOT,
      input: JSON.stringify({ sqls, execution: throughExecutionBoundary }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Array<string | null>;
}

test('contract SQL resolves physical, nested and repeated aliases from field policy', () => {
  const sql = `SELECT r.record_id, a.account_id, item.amount, code
FROM \`${records}\` AS r
JOIN \`${accounts}\` AS a ON r.account_id = a.account_id
CROSS JOIN UNNEST(r.items) AS item
CROSS JOIN UNNEST(item.codes) AS code
WHERE r.payload.label = 'kept'`;
  const computed = `SELECT n AS record_id FROM \`${records}\` AS r
CROSS JOIN UNNEST(GENERATE_ARRAY(1, 3)) AS n WHERE r.record_id IS NOT NULL`;
  const union = `SELECT x.account_id FROM \`${records}\` AS x
UNION ALL SELECT x.account_id FROM \`${accounts}\` AS x`;
  const scopes = `WITH one AS (SELECT r.record_id AS id FROM \`${records}\` AS r),
two AS (SELECT r.account_id AS id FROM \`${records}\` AS r)
SELECT one.id FROM one JOIN two ON one.id = two.id`;
  const wildcard = `SELECT _TABLE_SUFFIX AS shard FROM \`${events}\``;
  const quoted = `SELECT r.\`payload\`.\`label\` FROM \`${records}\` AS r`;
  const masked = `SELECT r.record_id FROM \`${records}\` AS r
WHERE 'r.payload.secret' = 'r.payload.secret' /* r.unknown */`;
  assert.deepEqual(
    validate([sql, computed, union, scopes, wildcard, quoted, masked]),
    Array(7).fill(''),
  );
});

test('contract SQL rejects unknown, restricted, scalar and ambiguous schema paths', () => {
  const queries = [
    `SELECT r.missing FROM \`${records}\` AS r`,
    `SELECT r.payload.missing FROM \`${records}\` AS r`,
    `SELECT r.payload.secret FROM \`${records}\` AS r`,
    `SELECT private_note FROM \`${records}\` AS r`,
    `SELECT r.items.amount FROM \`${records}\` AS r`,
    `SELECT tag.value FROM \`${records}\` AS r CROSS JOIN UNNEST(r.tags) AS tag`,
    `SELECT item FROM \`${records}\` AS r CROSS JOIN UNNEST(r.record_id) AS item`,
    `SELECT item FROM \`${records}\` AS r CROSS JOIN UNNEST(r.items.amount) AS item`,
    `SELECT item FROM \`${records}\` AS r CROSS JOIN UNNEST(r.unknown) AS item`,
    `SELECT item FROM \`${records}\` AS r CROSS JOIN UNNEST(r.items)`,
    `SELECT x.record_id FROM \`${records}\` AS x JOIN \`${accounts}\` AS x ON x.account_id=x.account_id`,
    `SELECT item FROM \`${records}\` AS r JOIN \`${accounts}\` AS a ON r.account_id=a.account_id CROSS JOIN UNNEST(items) AS item`,
  ];
  const diagnostics = validate(queries);
  assert.equal(diagnostics.length, queries.length);
  for (const diagnostic of diagnostics) assert.match(diagnostic!, /schema policy/);
});

test('contract execution boundary applies schema SQL validation before BigQuery', () => {
  const safe = `SELECT r.record_id FROM \`${records}\` AS r`;
  const unsafe = `SELECT r.unknown FROM \`${records}\` AS r`;
  assert.deepEqual(validate([safe, unsafe], true), [
    null,
    'rejected: schema policyとSQLを照合できません。',
  ]);
});

test('typed SQL diagnostics bind each closed code to one category and safe message', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import sys
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy
from bigquery_execution import (
 SQLDiagnostic,SQLDiagnosticCategory,SQLDiagnosticCode,sql_diagnostic,
 validate_sql_diagnostic,
)
table=${JSON.stringify(records)}
policy=AnalysisExecutionPolicy(
 frozenset({table}),frozenset({table}),100,20,None,
 (AnalysisFieldPolicy(table,("record_id",),"STRING","REQUIRED",False,False),),
)
normalized,diagnostic=validate_sql_diagnostic(
 'SELECT record_id FROM '+chr(96)+'other.dataset.records'+chr(96),policy=policy,
)
assert normalized is None
assert diagnostic==sql_diagnostic(SQLDiagnosticCode.TABLE_OUTSIDE_SCOPE)
assert diagnostic.category is SQLDiagnosticCategory.UNAUTHORIZED_REFERENCE
assert diagnostic.message=='rejected: table is outside the analysis contract'
for candidate in (
 lambda:SQLDiagnostic('unknown',diagnostic.category,diagnostic.message),
 lambda:SQLDiagnostic(diagnostic.code,SQLDiagnosticCategory.DANGEROUS_SQL,diagnostic.message),
 lambda:SQLDiagnostic(diagnostic.code,diagnostic.category,'provider detail'),
):
 try:candidate()
 except (TypeError,ValueError):pass
 else:raise AssertionError('invalid diagnostic contract was accepted')`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('SQL execution boundary requires an analysis policy before accepting a table', () => {
  const sql = `SELECT record_id FROM \`${records}\``;
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
import bigquery_execution
print(json.dumps(bigquery_execution.validate_sql(${JSON.stringify(sql)})))`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [null, 'rejected: analysis contract required']);
});

test('dry run and query execution refuse a missing policy before contacting BigQuery', () => {
  const sql = `SELECT record_id FROM \`${records}\``;
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
import bigquery_execution
class Client:
 def query(self,*_args,**_kwargs):raise AssertionError("BigQuery was contacted")
client=Client()
sql=${JSON.stringify(sql)}
print(json.dumps({"dry_run":bigquery_execution.inspect_bq_schema(client,sql),"execution":bigquery_execution.exec_bq(client,sql)}))`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dry_run: [null, 'rejected: analysis contract required'],
    execution: [null, 'rejected: analysis contract required'],
  });
});

test('dry run and execution use the policy bytes limit and exact job table scope', () => {
  const sql = `SELECT record_id FROM \`${records}\``;
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys,types
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy
import bigquery_execution
bigquery=types.ModuleType("google.cloud.bigquery")
bigquery.QueryJobConfig=lambda **kwargs:types.SimpleNamespace(**kwargs)
cloud=types.ModuleType("google.cloud")
cloud.bigquery=bigquery
google=types.ModuleType("google")
google.cloud=cloud
sys.modules.update({"google":google,"google.cloud":cloud,"google.cloud.bigquery":bigquery})
table=${JSON.stringify(records)}
policy=AnalysisExecutionPolicy(frozenset({table}),frozenset({table}),1234,20,None,(AnalysisFieldPolicy(table,("record_id",),"STRING","REQUIRED",False,False),))
class Rows(list):
 schema=[types.SimpleNamespace(name="record_id")]
class Job:
 statement_type="SELECT"
 referenced_tables=[types.SimpleNamespace(project="alpha",dataset_id="dataset",table_id="records")]
 schema=[types.SimpleNamespace(name="record_id",field_type="STRING",mode="REQUIRED")]
 total_bytes_processed=12
 def result(self,**_kwargs):return Rows([{"record_id":"value"}])
class Client:
 def __init__(self):self.configs=[]
 def query(self,_sql,job_config):
  self.configs.append(job_config)
  return Job()
client=Client()
sql=${JSON.stringify(sql)}
dry_run=bigquery_execution.inspect_bq_schema(client,sql,policy=policy)
execution=bigquery_execution.exec_bq(client,sql,policy=policy)
Job.referenced_tables=[types.SimpleNamespace(project="alpha",dataset_id="dataset",table_id="other")]
outside_scope=bigquery_execution.inspect_bq_schema(client,sql,policy=policy)
print(json.dumps({"dry_run":dry_run,"execution":execution,"outside_scope":outside_scope,"limits":[config.maximum_bytes_billed for config in client.configs]}))`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dry_run: [[['record_id', 'STRING', 'REQUIRED']], null],
    execution: [[[['value']], ['record_id']], null],
    outside_scope: [null, 'bq dry-run rejected: table is outside the analysis contract'],
    limits: [1234, 1234, 1234],
  });
});

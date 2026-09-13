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
 output=[bigquery_execution.validate_sql(sql,"ignored",policy=policy)[1] for sql in payload["sqls"]]
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

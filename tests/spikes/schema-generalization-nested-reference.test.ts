import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/nested-field.json');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = spawnSync(
    'python3',
    ['-c', `import sys\nsys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import json,sqlite3
from pathlib import Path
from evaluate import mismatched_quality_run_ids
fixture=json.loads(Path(${JSON.stringify(FIXTURE)}).read_text())
records=fixture['records']
expected=fixture['expected_rows']

# Issue #791: Explicit paths test access, not automatic semantic field discovery.
reference_sql='''
WITH parents AS (
 SELECT json_extract(value,'$.group_key') AS group_key,
        json_extract(value,'$.detail.context.owner.label') AS label,
        json_extract(value,'$.detail.context.owner') AS owner_record
 FROM json_each(?)
)
SELECT group_key, COUNT(*) AS record_count,
       COUNT(label) AS non_null_count,
       SUM(CASE WHEN label IS NOT NULL AND label <> '' THEN 1 ELSE 0 END) AS non_empty_count
FROM parents GROUP BY group_key ORDER BY group_key
'''

def query(sql):
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  return [dict(row) for row in connection.execute(sql,(json.dumps(records),))]

def mismatches(rows):
 # A unit projection for the public selector, not fabricated full-run evidence.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'nested-field',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted nested reference preserves eight parents and every expected group count', () => {
  assertPython(String.raw`
${setup}
assert set(fixture)=={'records','expected_rows'}
assert len(records)==8
assert expected==[
 {'group_key':'A','record_count':3,'non_null_count':2,'non_empty_count':1},
 {'group_key':'B','record_count':3,'non_null_count':0,'non_empty_count':0},
 {'group_key':'C','record_count':2,'non_null_count':1,'non_empty_count':1},
]
`);
});

test('path-by-path calculation independently reproduces every accepted nested result', () => {
  assertPython(String.raw`
${setup}
groups={}
for record in records:
 key=record['group_key']
 row=groups.setdefault(key,{'group_key':key,'record_count':0,
                           'non_null_count':0,'non_empty_count':0})
 value=record
 for field in ('detail','context','owner','label'):
  value=value.get(field) if isinstance(value,dict) else None
 row['record_count']+=1
 if value is not None:
  row['non_null_count']+=1
  if value!='':
   row['non_empty_count']+=1
assert [groups[key] for key in sorted(groups)]==expected
`);
});

test('local nested SQL matches all columns and the post-run selector accepts the result', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert rows==expected
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'empty strings excluded from non-NULL count',
    'COUNT(label) AS non_null_count',
    "COUNT(NULLIF(label,'')) AS non_null_count",
    "assert rows[0]['non_null_count']==1",
  ],
  [
    'missing values replaced with non-NULL strings',
    'COUNT(label) AS non_null_count',
    "COUNT(COALESCE(label,'')) AS non_null_count",
    "assert rows[1]['non_null_count']==3",
  ],
  [
    'ancestor existence instead of leaf value',
    'COUNT(label) AS non_null_count',
    'COUNT(owner_record) AS non_null_count',
    "assert rows[0]['non_null_count']==3 and rows[2]['non_null_count']==2",
  ],
  [
    'same-name shallow field',
    '$.detail.context.owner.label',
    '$.detail.owner.label',
    "assert rows[1]['non_null_count']==2 and rows[0]['non_empty_count']==2",
  ],
  [
    'same-name unrelated deep field',
    '$.detail.context.owner.label',
    '$.audit.context.owner.label',
    "assert rows[1]['non_null_count']==2 and rows[2]['non_null_count']==0",
  ],
  [
    'filtered parents and lost zero groups',
    'FROM parents GROUP BY',
    'FROM parents WHERE label IS NOT NULL GROUP BY',
    "assert [row['group_key'] for row in rows]==['A','C']\nassert [row['record_count'] for row in rows]==[2,1]",
  ],
  [
    'non-NULL count used as non-empty count',
    "SUM(CASE WHEN label IS NOT NULL AND label <> '' THEN 1 ELSE 0 END)",
    'COUNT(label)',
    "assert rows[0]['non_empty_count']==2",
  ],
] as const;

for (const [name, before, after, check] of counterexamples) {
  test(`nested reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
assert reference_sql.count(${JSON.stringify(before)})==1
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','nested-field','local-result')}
`);
  });
}

test('nested post-run selector detects changed row order despite unchanged total counts', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert sum(row['non_null_count'] for row in rows)==3
assert mismatches(rows)=={('synthetic','nested-field','local-result')}
`);
});

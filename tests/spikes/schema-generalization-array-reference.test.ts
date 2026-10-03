import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/array-conditional.json');
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

# Issue #791: SQLite is a local oracle, not the warehouse reference or product SQL.
reference_sql='''
WITH parents AS (
 SELECT json_extract(value,'$.group_key') AS group_key,
        json_extract(value,'$.detail.items') AS items,
        json_extract(value,'$.audit_items') AS audit_items
 FROM json_each(?)
), elements AS (
 SELECT p.group_key, json_extract(item.value,'$.eligible') AS eligible,
        json_extract(item.value,'$.quantity') AS quantity
 FROM parents AS p JOIN json_each(p.items) AS item
), parent_counts AS (
 SELECT group_key, COUNT(*) AS record_count FROM parents GROUP BY group_key
), metrics AS (
 SELECT group_key,
        COUNT(CASE WHEN eligible=1 THEN 1 END) AS eligible_item_count,
        SUM(CASE WHEN eligible=1 THEN quantity ELSE 0 END) AS quantity_total
 FROM elements GROUP BY group_key
)
SELECT g.group_key, g.record_count,
       COALESCE(m.eligible_item_count,0) AS eligible_item_count,
       COALESCE(m.quantity_total,0) AS quantity_total
FROM parent_counts AS g LEFT JOIN metrics AS m ON g.group_key=m.group_key
ORDER BY g.group_key
'''

def query(sql):
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  return [dict(row) for row in connection.execute(sql,(json.dumps(records),))]

def mismatches(rows):
 # A unit projection for the public selector, not fabricated full-run evidence.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'array-conditional',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted array reference preserves five parents, seven elements and three expected groups', () => {
  assertPython(String.raw`
${setup}
assert len(records)==5
assert sum(len((record['detail'] or {}).get('items',[])) for record in records)==7
assert expected==[
 {'group_key':'A','record_count':2,'eligible_item_count':4,'quantity_total':7},
 {'group_key':'B','record_count':2,'eligible_item_count':0,'quantity_total':0},
 {'group_key':'C','record_count':1,'eligible_item_count':0,'quantity_total':0},
]
`);
});

test('parent-by-parent calculation independently reproduces every accepted array result', () => {
  assertPython(String.raw`
${setup}
groups={}
for record in records:
 key=record['group_key']
 row=groups.setdefault(key,{'group_key':key,'record_count':0,
                           'eligible_item_count':0,'quantity_total':0})
 row['record_count']+=1
 for item in (record['detail'] or {}).get('items',[]):
  if item['eligible'] is True:
   row['eligible_item_count']+=1
   row['quantity_total']+=item['quantity'] or 0
assert [groups[key] for key in sorted(groups)]==expected
`);
});

test('local SQL matches all reference columns and the post-run selector accepts the result', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert rows==expected
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'unfiltered element count',
    'COUNT(CASE WHEN eligible=1 THEN 1 END)',
    'COUNT(*)',
    "assert rows[0]['eligible_item_count']==5 and rows[2]['eligible_item_count']==2",
  ],
  [
    'unfiltered quantity sum',
    'SUM(CASE WHEN eligible=1 THEN quantity ELSE 0 END)',
    'SUM(quantity)',
    "assert rows[0]['quantity_total']==57 and rows[2]['quantity_total']==16",
  ],
  [
    'distinct quantities',
    'SUM(CASE WHEN eligible=1 THEN quantity ELSE 0 END)',
    'SUM(DISTINCT CASE WHEN eligible=1 THEN quantity ELSE 0 END)',
    "assert rows[0]['quantity_total']==5",
  ],
  [
    'excluded NULL quantities',
    'COUNT(CASE WHEN eligible=1 THEN 1 END)',
    'COUNT(CASE WHEN eligible=1 AND quantity IS NOT NULL THEN 1 END)',
    "assert rows[0]['eligible_item_count']==3",
  ],
  [
    'lost empty groups',
    'FROM elements GROUP BY group_key',
    'FROM elements WHERE eligible=1 GROUP BY group_key',
    "sql=sql.replace('LEFT JOIN metrics','JOIN metrics')\nrows=query(sql)\nassert [row['group_key'] for row in rows]==['A']",
  ],
  [
    'flattened parent counts',
    'g.record_count,',
    '(SELECT COUNT(*) FROM elements AS e WHERE e.group_key=g.group_key) AS record_count,',
    "assert rows[0]['record_count']==5",
  ],
  [
    'unrelated array cross product',
    'JOIN json_each(p.items) AS item',
    'JOIN json_each(p.items) AS item JOIN json_each(p.audit_items) AS audit',
    "assert rows[0]['quantity_total']==8",
  ],
] as const;

for (const [name, before, after, check] of counterexamples) {
  test(`array reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','array-conditional','local-result')}
`);
  });
}

test('post-run selector detects changed row order even when totals are unchanged', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert sum(row['quantity_total'] for row in rows)==7
assert mismatches(rows)=={('synthetic','array-conditional','local-result')}
`);
});

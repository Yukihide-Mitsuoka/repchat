import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ROOT, python } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/two-table-join.json');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = python(`sys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import sqlite3
from pathlib import Path
from evaluate import mismatched_quality_run_ids
fixture=json.loads(Path(${JSON.stringify(FIXTURE)}).read_text())
left_records=fixture['left_records']
right_records=fixture['right_records']
expected=fixture['expected_rows']

# Issue #791: Left metrics retain record grain; right metrics count matching pairs.
# This SQL and these tables exist only in the local test, never in product runtime.
reference_sql='''
WITH matched AS (
 SELECT l.record_id,l.group_key,l.quantity,
        COUNT(*) AS joined_count,SUM(l.quantity) AS joined_quantity,
        COUNT(r.record_id) AS match_count,
        COALESCE(SUM(r.quantity),0) AS right_quantity
 FROM left_records AS l LEFT JOIN right_records AS r ON l.link_key=r.link_key
 GROUP BY l.record_id,l.group_key,l.quantity
)
SELECT group_key,COUNT(*) AS left_count,SUM(quantity) AS left_quantity,
       SUM(match_count) AS right_match_count,SUM(right_quantity) AS right_quantity
FROM matched GROUP BY group_key ORDER BY group_key
'''

def query(sql):
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  connection.execute('CREATE TABLE left_records(record_id INTEGER PRIMARY KEY,link_key INTEGER,group_key TEXT NOT NULL,quantity INTEGER NOT NULL)')
  connection.execute('CREATE TABLE right_records(record_id INTEGER PRIMARY KEY,link_key INTEGER,quantity INTEGER)')
  connection.executemany('INSERT INTO left_records VALUES (?,?,?,?)',[
   (row['record_id'],row['link_key'],row['group_key'],row['quantity']) for row in left_records])
  connection.executemany('INSERT INTO right_records VALUES (?,?,?)',[
   (row['record_id'],row['link_key'],row['quantity']) for row in right_records])
  return [dict(row) for row in connection.execute(sql)]

def mismatches(rows):
 # Unit input for the selector; no formal evidence or actual AI run is created.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'two-table-join',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted join reference preserves two independent six-record tables and three specified groups', () => {
  assertPython(String.raw`
${setup}
assert set(fixture)=={'left_records','right_records','expected_rows'}
for records in (left_records,right_records):
 assert len(records)==len({row['record_id'] for row in records})==6
 assert {row['record_id'] for row in records}==set(range(1,7))
 assert sum(row['link_key'] is None for row in records)==1
assert sum(row['quantity'] is None for row in right_records)==1
assert expected==[
 {'group_key':'A','left_count':3,'left_quantity':18,'right_match_count':5,'right_quantity':16},
 {'group_key':'B','left_count':2,'left_quantity':10,'right_match_count':1,'right_quantity':0},
 {'group_key':'C','left_count':1,'left_quantity':9,'right_match_count':0,'right_quantity':0},
]
`);
});

test('Python record-by-record matching independently reproduces left metrics and six matching pairs', () => {
  assertPython(String.raw`
${setup}
groups={}
pairs=[]
for left in left_records:
 row=groups.setdefault(left['group_key'],{
  'group_key':left['group_key'],'left_count':0,'left_quantity':0,
  'right_match_count':0,'right_quantity':0})
 row['left_count']+=1
 row['left_quantity']+=left['quantity']
 for right in right_records:
  if left['link_key'] is None or right['link_key'] is None or left['link_key']!=right['link_key']:
   continue
  pairs.append((left['record_id'],right['record_id']))
  row['right_match_count']+=1
  row['right_quantity']+=right['quantity'] if right['quantity'] is not None else 0
rows=[groups[key] for key in sorted(groups)]
assert rows==expected
assert len(pairs)==6
assert {(left,right) for left,right in pairs if left in (1,2)}=={(1,1),(1,2),(2,1),(2,2)}
assert len(left_records)-len({left for left,right in pairs})==2
assert len(right_records)-len({right for left,right in pairs})==2
assert [sum(row[key] for row in rows) for key in (
 'left_count','left_quantity','right_match_count','right_quantity')]==[6,37,6,16]
`);
});

test('local two-table SQL preserves left record grain and counts every matching right record', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert rows==expected,(rows,expected)
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'expanded join rows counted as original left records',
    'COUNT(*) AS left_count',
    'SUM(joined_count) AS left_count',
    "assert rows[0]['left_count']==5",
  ],
  [
    'left quantities amplified by multiple matches',
    'SUM(quantity) AS left_quantity',
    'SUM(joined_quantity) AS left_quantity',
    "assert rows[0]['left_quantity']==28",
  ],
  [
    'unmatched left records and groups removed',
    'LEFT JOIN right_records',
    'JOIN right_records',
    "assert [row['group_key'] for row in rows]==['A','B']\nassert (rows[1]['left_count'],rows[1]['left_quantity'])==(1,4)",
  ],
  [
    'table-local record IDs mistaken for relationship keys',
    'l.link_key=r.link_key',
    'l.record_id=r.record_id',
    "assert [(row['right_match_count'],row['right_quantity']) for row in rows]==[(3,10),(2,99),(1,100)]",
  ],
  [
    'equal quantities of different right records deduplicated',
    'SUM(r.quantity)',
    'SUM(DISTINCT r.quantity)',
    "assert rows[0]['right_quantity']==10",
  ],
  [
    'NULL right quantities excluded from match counts',
    'ON l.link_key=r.link_key',
    'ON l.link_key=r.link_key AND r.quantity IS NOT NULL',
    "assert (rows[1]['right_match_count'],rows[1]['right_quantity'])==(0,0)",
  ],
  [
    'NULL relationship keys matched to each other',
    'l.link_key=r.link_key',
    'l.link_key IS r.link_key',
    "assert (rows[1]['right_match_count'],rows[1]['right_quantity'])==(2,99)",
  ],
  [
    'multiple right records reduced to one matching key',
    'COUNT(r.record_id) AS match_count',
    'COUNT(DISTINCT r.link_key) AS match_count',
    "assert rows[0]['right_match_count']==3",
  ],
  [
    'orphan right records included outside left groups',
    'FROM matched GROUP BY group_key ORDER BY group_key',
    'FROM matched GROUP BY group_key UNION ALL SELECT NULL,0,0,COUNT(*),COALESCE(SUM(r.quantity),0) FROM right_records AS r WHERE NOT EXISTS (SELECT 1 FROM left_records AS l WHERE l.link_key=r.link_key) HAVING COUNT(*)>0 ORDER BY group_key',
    "assert len(rows)==4\nassert rows[0]=={'group_key':None,'left_count':0,'left_quantity':0,'right_match_count':2,'right_quantity':199}",
  ],
] as const;

for (const [name, before, after, check] of counterexamples) {
  test(`join reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
assert reference_sql.count(${JSON.stringify(before)})==1
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','two-table-join','local-result')}
`);
  });
}

test('join post-run selector detects changed row order despite unchanged counts and quantities', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert [sum(row[key] for row in rows) for key in (
 'left_count','left_quantity','right_match_count','right_quantity')]==[6,37,6,16]
assert mismatches(rows)=={('synthetic','two-table-join','local-result')}
`);
});

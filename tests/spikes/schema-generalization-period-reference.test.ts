import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ROOT, python } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/period-comparison.json');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = python(`sys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import sqlite3
from datetime import datetime
from pathlib import Path
from evaluate import mismatched_quality_run_ids
fixture=json.loads(Path(${JSON.stringify(FIXTURE)}).read_text())
records=fixture['records']
periods=fixture['periods']
expected=fixture['expected_rows']

# Issue #791: SQLite is a local oracle, not warehouse or product SQL.
reference_sql='''
WITH normalized AS (
 SELECT json_extract(value,'$.group_key') AS group_key,
        julianday(json_extract(value,'$.occurred_at')) AS instant
 FROM json_each(?)
), counts AS (
 SELECT group_key,
 SUM(CASE WHEN instant>=julianday(?) AND instant<julianday(?) THEN 1 ELSE 0 END) AS previous_count,
 SUM(CASE WHEN instant>=julianday(?) AND instant<julianday(?) THEN 1 ELSE 0 END) AS current_count
 FROM normalized GROUP BY group_key
)
SELECT group_key,previous_count,current_count,current_count-previous_count AS count_difference
FROM counts WHERE previous_count+current_count>0 ORDER BY group_key
'''

def query(sql):
 parameters=(json.dumps(records),periods['previous']['start'],periods['previous']['end'],
             periods['current']['start'],periods['current']['end'])
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  return [dict(row) for row in connection.execute(sql,parameters)]

def mismatches(rows):
 # Unit input for the selector; no formal evidence or actual AI run is created.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'period-comparison',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted period reference has twelve records and two equal UTC observation windows', () => {
  assertPython(String.raw`
${setup}
assert set(fixture)=={'records','periods','expected_rows'}
assert len(records)==len({row['record_id'] for row in records})==12
for period in periods.values():
 start,end=map(datetime.fromisoformat,(period['start'],period['end']))
 assert start.utcoffset().total_seconds()==end.utcoffset().total_seconds()==0
 assert (end-start).total_seconds()==86400
assert periods['previous']['end']==periods['current']['start']
assert expected==[
 {'group_key':'A','previous_count':3,'current_count':2,'count_difference':-1},
 {'group_key':'B','previous_count':0,'current_count':2,'count_difference':2},
 {'group_key':'C','previous_count':2,'current_count':0,'count_difference':-2},
]
`);
});

test('timezone-aware Python calculation independently reproduces every period result', () => {
  assertPython(String.raw`
${setup}
windows=[tuple(map(datetime.fromisoformat,(periods[key]['start'],periods[key]['end'])))
         for key in ('previous','current')]
groups={}
for record in records:
 counts=groups.setdefault(record['group_key'],[0,0])
 if record['occurred_at'] is None:
  continue
 instant=datetime.fromisoformat(record['occurred_at'])
 for index,(start,end) in enumerate(windows):
  if start<=instant<end:
   counts[index]+=1
rows=[{'group_key':key,'previous_count':counts[0],'current_count':counts[1],
       'count_difference':counts[1]-counts[0]}
      for key,counts in sorted(groups.items()) if sum(counts)>0]
assert rows==expected
assert sum(row['previous_count']+row['current_count'] for row in rows)==9
`);
});

test('local period SQL matches both individual counts and their difference', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert [row['count_difference'] for row in rows]==[row['count_difference'] for row in expected]
assert rows==expected,(rows,expected)
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'inclusive ends despite unchanged differences',
    'instant<julianday',
    'instant<=julianday',
    2,
    "assert (rows[0]['previous_count'],rows[0]['current_count'])==(4,3)\nassert [row['count_difference'] for row in rows]==[row['count_difference'] for row in expected]",
  ],
  [
    'excluded starts despite unchanged differences',
    'instant>=julianday',
    'instant>julianday',
    2,
    "assert (rows[0]['previous_count'],rows[0]['current_count'])==(2,1)\nassert [row['count_difference'] for row in rows]==[row['count_difference'] for row in expected]",
  ],
  [
    'local dates instead of UTC instants',
    "julianday(json_extract(value,'$.occurred_at'))",
    "julianday(substr(json_extract(value,'$.occurred_at'),1,10))",
    1,
    "assert (rows[0]['previous_count'],rows[0]['current_count'])==(2,3)\nassert (rows[1]['previous_count'],rows[1]['current_count'])==(1,1)",
  ],
  [
    'lost one-sided zero groups',
    'previous_count+current_count>0',
    'previous_count>0 AND current_count>0',
    1,
    "assert [row['group_key'] for row in rows]==['A']",
  ],
  [
    'invented dates for NULL timestamps',
    "julianday(json_extract(value,'$.occurred_at'))",
    "julianday(COALESCE(json_extract(value,'$.occurred_at'),'2026-01-11T12:00:00Z'))",
    1,
    "assert rows[2]['current_count']==1 and rows[2]['count_difference']==-1",
  ],
  [
    'unequal observation windows',
    'instant<julianday(?) THEN 1 ELSE 0 END) AS current_count',
    'instant<julianday(?)-0.5 THEN 1 ELSE 0 END) AS current_count',
    1,
    "assert rows[0]['current_count']==1 and rows[1]['current_count']==1",
  ],
  [
    'reversed subtraction',
    'current_count-previous_count AS count_difference',
    'previous_count-current_count AS count_difference',
    1,
    "assert [row['count_difference'] for row in rows]==[1,-2,2]",
  ],
] as const;

for (const [name, before, after, occurrences, check] of counterexamples) {
  test(`period reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
assert reference_sql.count(${JSON.stringify(before)})==${occurrences}
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','period-comparison','local-result')}
`);
  });
}

test('period post-run selector detects changed row order despite unchanged totals', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert sum(row['previous_count'] for row in rows)==5
assert sum(row['current_count'] for row in rows)==4
assert mismatches(rows)=={('synthetic','period-comparison','local-result')}
`);
});

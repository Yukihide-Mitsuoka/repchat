import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ROOT, python } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/time-intervals.json');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = python(`sys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import sqlite3
from datetime import datetime,timezone
from pathlib import Path
from evaluate import mismatched_quality_run_ids
fixture=json.loads(Path(${JSON.stringify(FIXTURE)}).read_text())
records=fixture['records']
expected=fixture['expected_rows']

# Issue #791: Distinct instants do not establish an order between simultaneous activities.
reference_sql='''
WITH normalized AS (
 SELECT json_extract(value,'$.group_key') AS group_key,
        unixepoch(json_extract(value,'$.occurred_at')) AS instant
 FROM json_each(?)
), instants AS (
 SELECT DISTINCT group_key,instant FROM normalized
 WHERE group_key IS NOT NULL AND instant IS NOT NULL
), ordered AS (
 SELECT group_key,instant,
 LAG(instant) OVER (PARTITION BY group_key ORDER BY instant) AS previous_instant
 FROM instants
)
SELECT group_key,
 strftime('%Y-%m-%dT%H:%M:%SZ',previous_instant,'unixepoch') AS previous_at,
 strftime('%Y-%m-%dT%H:%M:%SZ',instant,'unixepoch') AS current_at,
 instant-previous_instant AS interval_seconds
FROM ordered WHERE previous_instant IS NOT NULL ORDER BY group_key,previous_at,current_at
'''

def query(sql):
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  return [dict(row) for row in connection.execute(sql,(json.dumps(records),))]

def mismatches(rows):
 # Unit input for the selector; no formal evidence or actual AI run is created.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'time-intervals',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted interval reference preserves eleven records and four individually specified intervals', () => {
  assertPython(String.raw`
${setup}
assert set(fixture)=={'records','expected_rows'}
assert len(records)==len({row['record_id'] for row in records})==11
assert sum(row['group_key'] is None for row in records)==2
assert sum(row['occurred_at'] is None for row in records)==1
assert expected==[
 {'group_key':'A','previous_at':'2026-01-10T00:00:00Z','current_at':'2026-01-10T00:10:00Z','interval_seconds':600},
 {'group_key':'A','previous_at':'2026-01-10T00:10:00Z','current_at':'2026-01-10T00:30:00Z','interval_seconds':1200},
 {'group_key':'B','previous_at':'2026-01-10T00:05:00Z','current_at':'2026-01-10T00:20:00Z','interval_seconds':900},
 {'group_key':'B','previous_at':'2026-01-10T00:20:00Z','current_at':'2026-01-10T01:00:00Z','interval_seconds':2400},
]
`);
});

test('Python adjacent-pair calculation independently reproduces intervals after deduplication and exclusions', () => {
  assertPython(String.raw`
${setup}
groups={}
for record in records:
 if record['group_key'] is None or record['occurred_at'] is None:
  continue
 instant=datetime.fromisoformat(record['occurred_at']).astimezone(timezone.utc)
 groups.setdefault(record['group_key'],set()).add(instant)
assert {group:len(instants) for group,instants in groups.items()}=={'A':3,'B':3,'C':1}
rows=[]
for group,instants in sorted(groups.items()):
 sequence=sorted(instants)
 for previous,current in zip(sequence,sequence[1:]):
  rows.append({'group_key':group,
               'previous_at':previous.isoformat().replace('+00:00','Z'),
               'current_at':current.isoformat().replace('+00:00','Z'),
               'interval_seconds':int((current-previous).total_seconds())})
assert rows==expected
assert sum(row['interval_seconds'] for row in rows)==5100
assert all(row['group_key']!='C' for row in rows)
`);
});

test('local interval SQL matches each pair of adjacent distinct instants and elapsed seconds', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert rows==expected,(rows,expected)
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'duplicate simultaneous instants despite unchanged total seconds',
    'SELECT DISTINCT group_key,instant',
    'SELECT group_key,instant',
    "assert len(rows)==5\nassert [row['interval_seconds'] for row in rows if row['group_key']=='A']==[600,0,1200]\nassert sum(row['interval_seconds'] for row in rows)==5100",
  ],
  [
    'intervals between different groups',
    'PARTITION BY group_key ORDER BY instant',
    'ORDER BY instant,group_key',
    "assert len(rows)==6\nassert rows[0]['interval_seconds']==300\nassert [row['interval_seconds'] for row in rows if row['group_key']=='C']==[120]",
  ],
  [
    'reverse chronological predecessors',
    'ORDER BY instant)',
    'ORDER BY instant DESC)',
    "assert all(row['interval_seconds']<0 for row in rows)\nassert [row['interval_seconds'] for row in rows[:2]]==[-600,-1200]",
  ],
  [
    'reversed subtraction',
    'instant-previous_instant AS interval_seconds',
    'previous_instant-instant AS interval_seconds',
    "assert [row['interval_seconds'] for row in rows]==[-600,-1200,-900,-2400]",
  ],
  [
    'minutes returned as seconds',
    'instant-previous_instant AS interval_seconds',
    '(instant-previous_instant)/60 AS interval_seconds',
    "assert [row['interval_seconds'] for row in rows]==[10,20,15,40]",
  ],
  [
    'invented NULL timestamps despite unchanged total seconds',
    "unixepoch(json_extract(value,'$.occurred_at'))",
    "unixepoch(COALESCE(json_extract(value,'$.occurred_at'),'2026-01-10T00:15:00Z'))",
    "assert len(rows)==5\nassert [row['interval_seconds'] for row in rows if row['group_key']=='A']==[600,300,900]\nassert sum(row['interval_seconds'] for row in rows)==5100",
  ],
  [
    'NULL subjects combined into a fabricated group',
    'group_key IS NOT NULL AND instant IS NOT NULL',
    'instant IS NOT NULL',
    "assert len(rows)==5\nassert rows[0]['group_key'] is None\nassert rows[0]['interval_seconds']==1020",
  ],
  [
    'first instants and single-instant groups fabricated as zero intervals',
    'LAG(instant) OVER (PARTITION BY group_key ORDER BY instant)',
    'COALESCE(LAG(instant) OVER (PARTITION BY group_key ORDER BY instant),instant)',
    "assert len(rows)==7\nassert [row['interval_seconds'] for row in rows if row['group_key']=='C']==[0]\nassert sum(row['interval_seconds'] for row in rows)==5100",
  ],
] as const;

for (const [name, before, after, check] of counterexamples) {
  test(`interval reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
assert reference_sql.count(${JSON.stringify(before)})==1
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','time-intervals','local-result')}
`);
  });
}

test('interval post-run selector detects offsetting errors despite unchanged endpoints and group totals', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows[0]['interval_seconds']+=300
rows[1]['interval_seconds']-=300
assert [row['interval_seconds'] for row in rows[:2]]==[900,900]
assert [(row['group_key'],row['previous_at'],row['current_at']) for row in rows]==[
 (row['group_key'],row['previous_at'],row['current_at']) for row in expected]
for group in ('A','B'):
 assert sum(row['interval_seconds'] for row in rows if row['group_key']==group)==sum(
  row['interval_seconds'] for row in expected if row['group_key']==group)
assert len(rows)==4
assert sum(row['interval_seconds'] for row in rows)==5100
assert mismatches(rows)=={('synthetic','time-intervals','local-result')}
`);
});

test('interval post-run selector detects changed row order despite unchanged total seconds', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert sum(row['interval_seconds'] for row in rows)==5100
assert mismatches(rows)=={('synthetic','time-intervals','local-result')}
`);
});

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ROOT, python } from './report-generation/live-demo-test-helpers.ts';

const FIXTURE = path.join(ROOT, 'tests/fixtures/schema-generalization/daily-cumulative.json');
const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = python(`sys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
import sqlite3
from collections import Counter
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from evaluate import mismatched_quality_run_ids
fixture=json.loads(Path(${JSON.stringify(FIXTURE)}).read_text())
records=fixture['records']
period=fixture['period']
expected=fixture['expected_rows']

# Issue #791: SQLite is a local oracle, not warehouse or product SQL.
reference_sql='''
WITH RECURSIVE normalized AS (
 SELECT json_extract(value,'$.group_key') AS group_key,
        date(json_extract(value,'$.occurred_at')) AS observed_day
 FROM json_each(?)
), days(day) AS (
 SELECT date(?)
 UNION ALL SELECT date(day,'+1 day') FROM days WHERE date(day,'+1 day')<date(?)
), daily_counts AS (
 SELECT group_key,observed_day,COUNT(*) AS daily_count
 FROM normalized WHERE observed_day IN (SELECT day FROM days)
 GROUP BY group_key,observed_day
), groups AS (
 SELECT DISTINCT group_key FROM daily_counts
), filled AS (
 SELECT g.group_key,d.day,COALESCE(c.daily_count,0) AS daily_count
 FROM groups AS g CROSS JOIN days AS d
 LEFT JOIN daily_counts AS c ON c.group_key=g.group_key AND c.observed_day=d.day
)
SELECT group_key,day,daily_count,
 SUM(daily_count) OVER (PARTITION BY group_key ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_count
FROM filled ORDER BY group_key,day
'''

def query(sql):
 with sqlite3.connect(':memory:') as connection:
  connection.row_factory=sqlite3.Row
  parameters=(json.dumps(records),period['start_date'],period['end_date'])
  return [dict(row) for row in connection.execute(sql,parameters)]

def mismatches(rows):
 # Unit input for the selector; no formal evidence or actual AI run is created.
 return mismatched_quality_run_ids({'schemas':[{
  'schema_id':'synthetic','cases':[{
   'case_id':'daily-cumulative',
   'reference':{'expected_rows':expected,'row_order':'ordered'},
   'runs':[{'run_id':'local-result','failure_kind':'none','failure_stage':'none',
            'sql_execution_succeeded':True,'actual_rows':rows}],
  }],
 }]})
`;

test('accepted cumulative reference preserves thirteen records and four dates per group', () => {
  assertPython(String.raw`
${setup}
assert set(fixture)=={'records','period','expected_rows'}
assert len(records)==len({row['record_id'] for row in records})==13
assert (date.fromisoformat(period['end_date'])-date.fromisoformat(period['start_date'])).days==4
assert expected==[
 {'group_key':'A','day':'2026-01-10','daily_count':2,'cumulative_count':2},
 {'group_key':'A','day':'2026-01-11','daily_count':0,'cumulative_count':2},
 {'group_key':'A','day':'2026-01-12','daily_count':3,'cumulative_count':5},
 {'group_key':'A','day':'2026-01-13','daily_count':1,'cumulative_count':6},
 {'group_key':'B','day':'2026-01-10','daily_count':1,'cumulative_count':1},
 {'group_key':'B','day':'2026-01-11','daily_count':4,'cumulative_count':5},
 {'group_key':'B','day':'2026-01-12','daily_count':0,'cumulative_count':5},
 {'group_key':'B','day':'2026-01-13','daily_count':2,'cumulative_count':7},
]
`);
});

test('calendar-by-calendar Python calculation independently reproduces all cumulative rows', () => {
  assertPython(String.raw`
${setup}
start,end=map(date.fromisoformat,(period['start_date'],period['end_date']))
counts=Counter()
for record in records:
 day=datetime.fromisoformat(record['occurred_at']).astimezone(timezone.utc).date()
 if start<=day<end:
  counts[record['group_key'],day]+=1
rows=[]
for group in sorted({group for group,day in counts}):
 day,total=start,0
 while day<end:
  count=counts[group,day]
  total+=count
  rows.append({'group_key':group,'day':day.isoformat(),'daily_count':count,'cumulative_count':total})
  day+=timedelta(days=1)
 assert total==sum(count for (key,day),count in counts.items() if key==group)
assert rows==expected
assert sum(row['daily_count'] for row in rows)==13
`);
});

test('local window SQL matches every daily count and inclusive cumulative count', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
assert rows==expected,(rows,expected)
assert mismatches(rows)==set()
`);
});

const counterexamples = [
  [
    'excluded current day',
    'AND CURRENT ROW',
    'AND 1 PRECEDING',
    "assert [row['cumulative_count'] for row in rows[:4]]==[None,2,2,5]",
  ],
  [
    'mixed groups',
    'PARTITION BY group_key ORDER BY day ROWS',
    'ORDER BY day,group_key ROWS',
    "assert rows[-1]['cumulative_count']==13",
  ],
  [
    'reverse chronological accumulation',
    'ORDER BY day ROWS',
    'ORDER BY day DESC ROWS',
    "assert [row['cumulative_count'] for row in rows[:4]]==[6,4,4,1]",
  ],
  [
    'lost missing days',
    'LEFT JOIN daily_counts AS c',
    'JOIN daily_counts AS c',
    "assert len(rows)==6\nassert ('A','2026-01-11') not in {(row['group_key'],row['day']) for row in rows}\nassert ('B','2026-01-12') not in {(row['group_key'],row['day']) for row in rows}",
  ],
  [
    'distinct dates instead of record counts',
    'COUNT(*) AS daily_count',
    'COUNT(DISTINCT observed_day) AS daily_count',
    "assert rows[3]['cumulative_count']==rows[7]['cumulative_count']==3",
  ],
  [
    'full-period totals instead of daily cumulative values',
    'ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW',
    '',
    "assert [row['cumulative_count'] for row in rows[:4]]==[6,6,6,6]",
  ],
  [
    'daily counts used as cumulative values',
    'SUM(daily_count) OVER (PARTITION BY group_key ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)',
    'daily_count',
    "assert [row['cumulative_count'] for row in rows[:4]]==[2,0,3,1]",
  ],
] as const;

for (const [name, before, after, check] of counterexamples) {
  test(`window reference and post-run selector detect ${name}`, () => {
    assertPython(String.raw`
${setup}
assert reference_sql.count(${JSON.stringify(before)})==1
sql=reference_sql.replace(${JSON.stringify(before)},${JSON.stringify(after)})
assert sql!=reference_sql
rows=query(sql)
${check}
assert rows!=expected
assert mismatches(rows)=={('synthetic','daily-cumulative','local-result')}
`);
  });
}

test('window post-run selector detects offsetting intermediate errors despite unchanged aggregates', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows[1]['cumulative_count']+=1
rows[2]['cumulative_count']-=1
assert [row['cumulative_count'] for row in rows[:4]]==[2,3,4,6]
for group in ('A','B'):
 actual=[row for row in rows if row['group_key']==group]
 reference=[row for row in expected if row['group_key']==group]
 assert sum(row['cumulative_count'] for row in actual)==sum(row['cumulative_count'] for row in reference)
 assert actual[-1]==reference[-1]
assert sum(row['daily_count'] for row in rows)==13
assert sum(row['cumulative_count'] for row in rows)==33
assert mismatches(rows)=={('synthetic','daily-cumulative','local-result')}
`);
});

test('window post-run selector detects changed row order despite unchanged counts', () => {
  assertPython(String.raw`
${setup}
rows=query(reference_sql)
rows.reverse()
assert sum(row['daily_count'] for row in rows)==13
assert sum(row['cumulative_count'] for row in rows)==33
assert mismatches(rows)=={('synthetic','daily-cumulative','local-result')}
`);
});

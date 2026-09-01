import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUN_REPORT = path.join(ROOT, 'spikes/report-generation/run_report.py');

function python(source: string) {
  return spawnSync('python3', ['-c', source], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function loadRunReport(body: string) {
  return python(`
import json
import runpy
import sys
from datetime import date

sys.path.insert(0, ${JSON.stringify(path.dirname(RUN_REPORT))})
module = runpy.run_path(${JSON.stringify(RUN_REPORT)})
spec = {
    "dataset": "example.dataset.events_*",
    "period": {"from": "20210101", "to": "20210131", "label": "2021年1月"},
}
${body}
`);
}

test('warehouse SQL is formatted for display without changing its source text', () => {
  const result = loadRunReport(`
raw = "SELECT traffic_source.medium AS medium, COUNT(DISTINCT user_pseudo_id) AS users FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY medium ORDER BY users DESC"
formatted = module["format_sql_for_display"](raw)
print(json.dumps({"raw": raw, "formatted": formatted}))
`);
  assert.equal(result.status, 0, result.stderr);
  const sql = JSON.parse(result.stdout);
  assert.equal(
    sql.raw,
    "SELECT traffic_source.medium AS medium, COUNT(DISTINCT user_pseudo_id) AS users FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY medium ORDER BY users DESC",
  );
  assert.match(sql.formatted, /\nFROM /);
  assert.match(sql.formatted, /\nWHERE /);
  assert.match(sql.formatted, /\nGROUP BY /);
  assert.match(sql.formatted, /\nORDER BY /);
  assert.match(sql.formatted, /^SELECT\n\s+traffic_source\.medium AS medium,\n\s+COUNT/);
  assert.doesNotMatch(sql.formatted, /\t/);
  assert.equal(sql.formatted.split('\n')[1]?.match(/^ */)?.[0].length, 4);
  assert.ok(sql.formatted.split('\n').length >= 6);
});

test('every top-level SELECT expression is placed on its own display line', () => {
  const result = loadRunReport(`
raw = "WITH daily AS (SELECT event_date AS day, COUNT(DISTINCT user_pseudo_id) AS sessions FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY day) SELECT day, sessions, AVG(sessions) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS sessions_7d_avg FROM daily ORDER BY day"
print(module["format_sql_for_display"](raw))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SELECT\n\s+event_date AS day,\n\s+COUNT/);
  assert.match(result.stdout, /SELECT\n\s+day,\n\s+sessions,\n\s+AVG/);
  assert.match(result.stdout, /\nFROM daily\nORDER BY day/);
});

test('complex display SQL keeps CTE and UNION SELECT clauses on readable lines', () => {
  const result = loadRunReport(`
raw = "WITH first AS (SELECT source, target, value FROM \`example.dataset.events\` WHERE stage = 1), edges AS (SELECT source, target, value FROM first UNION ALL SELECT target AS source, 'done' AS target, value FROM first) SELECT source, target, value FROM edges ORDER BY value DESC"
print(module["format_sql_for_display"](raw))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /first AS \(\n\s+SELECT\n\s+source/);
  assert.match(result.stdout, /UNION ALL\n\s*SELECT\n\s+target AS source/);
  assert.match(result.stdout, /\)\nSELECT\n\s+source,/i);
  assert.doesNotMatch(result.stdout, /\n\s*\n\s*\n/);
});

test('display SQL indents every non-empty line by a multiple of four spaces', () => {
  const result = loadRunReport(`
raw = "WITH first AS (SELECT source, target, value FROM \`example.dataset.events\` WHERE stage = 1), edges AS (SELECT source, target, value FROM first UNION ALL SELECT target AS source, 'done' AS target, value FROM first) SELECT source, target, value FROM edges ORDER BY value DESC"
formatted = module["format_sql_for_display"](raw)
violations = [{
    "line": index + 1,
    "spaces": len(line) - len(line.lstrip(" ")),
    "text": line.strip(),
} for index, line in enumerate(formatted.splitlines())
  if line.strip() and (len(line) - len(line.lstrip(" "))) % 4 != 0]
print(json.dumps(violations, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test('display SQL normalizes sqlparse aligned output to four-space levels', () => {
  const result = loadRunReport(`
import sys
import types

aligned = """SELECT COUNT(DISTINCT ecommerce.transaction_id) AS purchases,
       SUM(ecommerce.purchase_revenue) AS revenue
  FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\u0060
 WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'
   AND event_name = 'purchase'"""
sqlparse = types.ModuleType("sqlparse")
sqlparse.format = lambda *_args, **_kwargs: aligned
sys.modules["sqlparse"] = sqlparse

raw = "SELECT COUNT(DISTINCT ecommerce.transaction_id) AS purchases, SUM(ecommerce.purchase_revenue) AS revenue FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\u0060 WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' AND event_name = 'purchase'"
formatted = module["format_sql_for_display"](raw)
violations = [{
    "line": index + 1,
    "spaces": len(line) - len(line.lstrip(" ")),
    "text": line.strip(),
} for index, line in enumerate(formatted.splitlines())
  if line.strip() and (len(line) - len(line.lstrip(" "))) % 4 != 0]
print(json.dumps(violations, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test('display SQL keeps CTE and UNION structure after aligned indentation is removed', () => {
  const result = loadRunReport(`
import sys
import types

aligned = """WITH first AS (
        SELECT
            a,
            b
          FROM source
         WHERE x = 1
           AND y = 2
       ),
       second AS (
        SELECT
            a,
            b
          FROM first
     UNION ALL
     SELECT
         a,
         b
          FROM fallback
       )
SELECT
    a,
    b
  FROM second
 ORDER BY a"""
sqlparse = types.ModuleType("sqlparse")
sqlparse.format = lambda *_args, **_kwargs: aligned
sys.modules["sqlparse"] = sqlparse
print(module["format_sql_for_display"]("SELECT 1"))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `WITH first AS (
    SELECT
        a,
        b
    FROM source
    WHERE x = 1
        AND y = 2
),
second AS (
    SELECT
        a,
        b
    FROM first
    UNION ALL
    SELECT
        a,
        b
    FROM fallback
)
SELECT
    a,
    b
FROM second
ORDER BY a`,
  );
});

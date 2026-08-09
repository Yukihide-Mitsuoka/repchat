import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUN_REPORT = path.join(ROOT, 'spikes/report-generation/run_report.py');
const REPORT_SPEC = path.join(ROOT, 'spikes/report-generation/report.json');

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
from datetime import date

module = runpy.run_path(${JSON.stringify(RUN_REPORT)})
spec = json.loads(open(${JSON.stringify(REPORT_SPEC)}, encoding="utf-8").read())
${body}
`);
}

test('an exact maintained Japanese question keeps reference verification', () => {
  const result = loadRunReport(`
sections = module["select_sections"](spec, "2021年1月のセッション数を出して")
print(json.dumps({
    "count": len(sections),
    "id": sections[0]["id"],
    "text": sections[0]["text"],
    "has_gold": "gold_sql" in sections[0],
    "verification": sections[0]["verification"],
}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    count: 1,
    id: 'R1',
    text: '2021年1月のセッション数を出して',
    has_gold: true,
    verification: 'reference',
  });
});

test('a new Japanese question becomes one execution-only section', () => {
  const question = '2021年1月の購入ユーザー数をデバイス別に出して';
  const result = loadRunReport(`
sections = module["select_sections"](spec, ${JSON.stringify(question)})
print(json.dumps(sections, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const sections = JSON.parse(result.stdout);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, 'Q1');
  assert.equal(sections[0].text, question);
  assert.equal(sections[0].verification, 'execution');
  assert.equal('gold_sql' in sections[0], false);
});

test('showcase mode selects KPI, funnel, trend, and navigation-flow analyses', () => {
  const result = loadRunReport(`
sections = module["select_sections"](spec, None, showcase=True)
print(json.dumps([{
    "id": section["id"],
    "component": section["component"],
    "verification": section["verification"],
} for section in sections]))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { id: 'R4', component: 'kpi_pair', verification: 'reference' },
    { id: 'R11', component: 'big_value', verification: 'reference' },
    { id: 'R12', component: 'big_value', verification: 'reference' },
    { id: 'R9', component: 'funnel', verification: 'reference' },
    { id: 'R16', component: 'trend', verification: 'reference' },
    { id: 'R17', component: 'sankey', verification: 'reference' },
  ]);
});

test('the navigation-flow reference SQL creates bounded staged Sankey edges', () => {
  const result = loadRunReport(`
section = next(section for section in spec["sections"] if section["id"] == "R17")
print(section["gold_sql"])
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /ROW_NUMBER\(\) OVER \(PARTITION BY session_id ORDER BY event_timestamp/,
  );
  assert.match(
    result.stdout,
    /LAG\(page_path\) OVER \(PARTITION BY session_id ORDER BY event_timestamp/,
  );
  assert.match(result.stdout, /previous_page_path IS NULL OR page_path != previous_page_path/);
  assert.match(result.stdout, /step <= 3/);
  assert.match(
    result.stdout,
    /ORDER BY sessions DESC, entry_page, second_page, third_page LIMIT 12/,
  );
  assert.match(result.stdout, /LIMIT 12/);
  assert.match(result.stdout, /'1\. 入口: '/);
  assert.match(result.stdout, /'2\. '/);
  assert.match(result.stdout, /'3\. '/);
  assert.doesNotMatch(result.stdout, /SELECT\s+(?:DISTINCT\s+)?\*/i);
});

test('the navigation-flow generation request fixes normalization and edge semantics', () => {
  const result = loadRunReport(`
section = next(section for section in spec["sections"] if section["id"] == "R17")
print(module["generation_request"](section, spec["period"]))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /URLからホスト・クエリ・フラグメントを除いたパス/);
  assert.match(result.stdout, /連続する同一page_pathは1回の滞在へ統合/);
  assert.match(result.stdout, /2ページ目が存在するセッションだけ/);
  assert.match(result.stdout, /上位12経路を確定してから/);
  assert.match(result.stdout, /同数なら入口・2ページ目・3ページ目昇順/);
  assert.match(result.stdout, /離脱ノードは作らない/);
  assert.match(result.stdout, /`1\. 入口: `、`2\. `、`3\. `/);
});

test('one-question mode rejects empty and oversized input before cloud access', () => {
  for (const question of ['', ' '.repeat(3), 'あ'.repeat(501), '1月の\nセッション数']) {
    const result = loadRunReport(`
try:
    module["select_sections"](spec, ${JSON.stringify(question)})
except ValueError as error:
    print(str(error))
else:
    raise AssertionError("question was accepted")
`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /question/);
  }
});

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
section = next(section for section in spec["sections"] if section["id"] == "R17")
print(module["format_sql_for_display"](section["gold_sql"]))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pageviews AS \(\n\s+SELECT\n\s+CONCAT/);
  assert.match(result.stdout, /UNION ALL\n\s*SELECT\n\s+CONCAT/);
  assert.match(result.stdout, /\)\nSELECT\n\s+source,/i);
  assert.doesNotMatch(result.stdout, /\n\s*\n\s*\n/);
});

test('display SQL indents every non-empty line by a multiple of four spaces', () => {
  const result = loadRunReport(`
section = next(section for section in spec["sections"] if section["id"] == "R17")
formatted = module["format_sql_for_display"](section["gold_sql"])
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

test('generated SQL must be read-only and bounded to the demo dataset', () => {
  const result = loadRunReport(`
queries = [
    "SELECT COUNT(*) FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`",
    "SELECT 1",
    "SELECT * FROM \`another-project.analytics.events_*\`",
    "SELECT * FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`; SELECT 1",
    "DELETE FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE TRUE",
    "SELECT * FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`",
    "SELECT DISTINCT * FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`",
    "SELECT 'bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*'",
]
print(json.dumps([module["validate_sql"](query) for query in queries]))
`);
  assert.equal(result.status, 0, result.stderr);
  const validations = JSON.parse(result.stdout);
  assert.equal(validations[0][1], null);
  for (const validation of validations.slice(1)) {
    assert.match(validation[1], /^rejected:/);
  }
});

test('result shape selects a BigValue, line chart, or table', () => {
  const result = loadRunReport(`
cases = [
    module["component_for_result"]([(118380,)], ["sessions"]),
    module["component_for_result"](
        [(date(2021, 1, 1), 100), (date(2021, 1, 2), 120)],
        ["day", "sessions"],
    ),
    module["component_for_result"]([("organic", 100), ("cpc", 50)], ["medium", "sessions"]),
]
print(json.dumps(cases))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['big_value', 'line', 'table']);
});

test('the Evidence page shows the Japanese question and generated warehouse SQL', () => {
  const result = loadRunReport(`
page = module["evidence_page"](spec, [{
    "id": "Q1",
    "title": "日本語問い合わせの結果",
    "question": "2021年1月の購入ユーザー数をデバイス別に出して",
    "component": "table",
    "sql": "SELECT device.category, COUNT(DISTINCT user_pseudo_id) AS users FROM \`example.dataset.events_*\` GROUP BY 1",
    "columns": ["category", "users"],
    "ok": True,
    "detail": "executed; reference value not registered",
    "undefined_terms": [],
    "reason": "ユーザー数の定義をデバイスカテゴリ別に集計しました。",
    "verification": "execution",
}])
print(page)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /日本語の問い合わせ/);
  assert.match(result.stdout, /購入ユーザー数をデバイス別/);
  assert.match(result.stdout, /Vertex AIが生成したBigQuery SQL/);
  assert.match(result.stdout, /COUNT\(DISTINCT user_pseudo_id\)/);
  assert.match(result.stdout, /<CodeBlock source=\{/);
  assert.match(result.stdout, /language="sql"/);
  assert.match(result.stdout, /copyToClipboard=\{true\}/);
  assert.match(result.stdout, /実行済み・参照値未照合/);
  assert.match(result.stdout, /select category, users from ga4\.q1/);
  assert.doesNotMatch(result.stdout, /select \*/i);
});

test('showcase keeps each question, visualization, SQL, and aggregate data in one tab set', () => {
  const result = loadRunReport(`
base = {
    "question": "日本語の問い合わせ",
    "sql": "SELECT 1 AS value FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`",
    "columns": ["value"],
    "ok": True,
    "detail": "matched",
    "undefined_terms": [],
    "reason": "定義に従って集計しました。",
    "verification": "reference",
}
results = [
    {**base, "id": "R4", "title": "購入件数と売上", "component": "kpi_pair",
     "columns": ["purchases", "revenue"]},
    {**base, "id": "R11", "title": "リピートユーザー率", "component": "big_value",
     "columns": ["repeat_user_pct"]},
    {**base, "id": "R12", "title": "平均エンゲージメント時間", "component": "big_value",
     "columns": ["avg_engagement_time_seconds"]},
    {**base, "id": "R9", "title": "購入までのファネル", "component": "funnel",
     "columns": ["view_item", "add_to_cart", "purchase"]},
    {**base, "id": "R16", "title": "セッションの7日移動平均", "component": "trend",
     "columns": ["day", "sessions", "sessions_7d_avg"]},
    {**base, "id": "R17", "title": "入口から3ページ目までの回遊", "component": "sankey",
     "columns": ["source", "target", "sessions"]},
]
print(module["evidence_page"](spec, results))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/<BigValue /g) ?? []).length, 4);
  assert.equal((result.stdout.match(/<FunnelChart /g) ?? []).length, 1);
  assert.equal((result.stdout.match(/<LineChart /g) ?? []).length, 1);
  assert.equal((result.stdout.match(/<SankeyDiagram /g) ?? []).length, 1);
  assert.equal((result.stdout.match(/<Tabs id=/g) ?? []).length, 6);
  assert.equal((result.stdout.match(/label="分析結果"/g) ?? []).length, 6);
  assert.equal((result.stdout.match(/label="生成プロセス・SQL"/g) ?? []).length, 6);
  assert.equal((result.stdout.match(/label="集計データ"/g) ?? []).length, 6);
  assert.equal((result.stdout.match(/<DataTable data=\{/g) ?? []).length, 6);
  assert.match(
    result.stdout,
    /## 1\. 購入件数と売上[\s\S]*?<Tab label="集計データ">[\s\S]*?```sql r4/,
  );
  assert.match(result.stdout, /```sql r4[\s\S]*?<DataTable data=\{r4\}\/\>/);
  assert.match(
    result.stdout,
    /## 4\. 購入までのファネル[\s\S]*?<Tab label="集計データ">[\s\S]*?```sql r9[\s\S]*?```sql r9_chart/,
  );
  assert.ok(
    result.stdout.indexOf('```sql r4') > result.stdout.indexOf('## 1. 購入件数と売上'),
    'the first aggregate query must not appear above its analysis',
  );
  assert.match(result.stdout, /series=metric/);
  assert.match(result.stdout, /7日移動平均/);
  assert.match(result.stdout, /nameCol=stage valueCol=sessions/);
  assert.match(result.stdout, /sourceCol=source targetCol=target valueCol=sessions/);
  assert.match(result.stdout, /title="入口から3ページ目までの主要回遊"/);
  assert.match(result.stdout, /value=repeat_user_pct title="リピートユーザー率（%）" fmt=num2/);
  assert.match(
    result.stdout,
    /value=avg_engagement_time_seconds title="平均エンゲージメント時間（秒）" fmt=num1/,
  );
  assert.match(result.stdout, /value=revenue title="購入金額（USD）" fmt=usd0/);
  assert.match(result.stdout, /自動生成ダッシュボード/);
});

test('an undefined metric is shown as a refusal without an Evidence query', () => {
  const result = loadRunReport(`
page = module["evidence_page"](spec, [{
    "id": "Q1",
    "title": "日本語問い合わせの結果",
    "question": "2021年1月の直帰率を出して",
    "component": "table",
    "sql": None,
    "columns": None,
    "ok": True,
    "detail": "refused",
    "undefined_terms": ["直帰率"],
    "reason": "直帰率は指標定義にありません。",
    "verification": "refused",
}])
print(page)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /未定義の指標/);
  assert.match(result.stdout, /直帰率は指標定義にありません/);
  assert.doesNotMatch(result.stdout, /from ga4\.q1/);
});

test('writing a refusal removes stale SQL and creates no warehouse source', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repchat-report-'));
  try {
    const result = loadRunReport(`
from pathlib import Path
out_dir = Path(${JSON.stringify(outputDir)})
source_dir = out_dir / "sources" / "ga4"
source_dir.mkdir(parents=True)
(source_dir / "r1.sql").write_text("SELECT 1", encoding="utf-8")
module["write_outputs"](out_dir, spec, [{
    "id": "Q1",
    "title": "日本語問い合わせの結果",
    "question": "2021年1月の直帰率を出して",
    "component": "table",
    "sql": None,
    "columns": None,
    "ok": True,
    "detail": "refused",
    "undefined_terms": ["直帰率"],
    "reason": "直帰率は指標定義にありません。",
    "verification": "refused",
}], "example-project")
print(json.dumps(sorted(str(path.relative_to(out_dir)) for path in out_dir.rglob("*") if path.is_file())))
`);
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout);
    assert.deepEqual(files, ['pages/monthly_report.md', 'sources/ga4/connection.yaml']);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('writing an answered section preserves the executable SQL source verbatim', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repchat-report-'));
  try {
    const result = loadRunReport(`
from pathlib import Path
out_dir = Path(${JSON.stringify(outputDir)})
raw_sql = "SELECT COUNT(DISTINCT user_pseudo_id) AS users FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
module["write_outputs"](out_dir, spec, [{
    "id": "Q1",
    "title": "ユーザー数",
    "question": "2021年1月のユーザー数を出して",
    "component": "big_value",
    "sql": raw_sql,
    "columns": ["users"],
    "ok": True,
    "detail": "executed",
    "undefined_terms": [],
    "reason": "ユーザー数を集計しました。",
    "verification": "execution",
}], "example-project")
print(json.dumps({
    "raw": raw_sql,
    "source": (out_dir / "sources" / "ga4" / "q1.sql").read_text(encoding="utf-8"),
    "page": (out_dir / "pages" / "monthly_report.md").read_text(encoding="utf-8"),
}))
`);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.source, `${output.raw}\n`);
    assert.match(output.page, /\\nFROM /);
    assert.match(output.page, /<CodeBlock source=\{/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

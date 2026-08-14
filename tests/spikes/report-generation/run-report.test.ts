import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

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

test('fixed report routing and executable runner are removed', () => {
  const result = loadRunReport(`
removed=["select_sections","compare","component_for_result","SHOWCASE_IDS"]
print(json.dumps({"removed":all(name not in module for name in removed)}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { removed: true });
  const command = spawnSync('python3', [RUN_REPORT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(command.status, 2);
  assert.match(command.stderr, /固定レポートrunnerは削除されました.*demo-live/);
});

test('live SQL generation defaults to Gemini 3.6 Flash without unsupported temperature', () => {
  const result = loadRunReport(`
import sys
import types

google = types.ModuleType("google")
genai = types.ModuleType("google.genai")
class Config:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
genai.types = types.SimpleNamespace(GenerateContentConfig=Config)
google.genai = genai
sys.modules["google"] = google
sys.modules["google.genai"] = genai
captured = {}
class Models:
    def generate_content(self, **kwargs):
        captured.update(kwargs)
        calls = captured.get("calls", 0)
        captured["calls"] = calls + 1
        usage = (
            types.SimpleNamespace(
                prompt_token_count=10,
                candidates_token_count=5,
                thoughts_token_count=7,
            )
            if calls == 0
            else types.SimpleNamespace(prompt_token_count=10, candidates_token_count=5)
        )
        return types.SimpleNamespace(
            text='{"sql":"SELECT 1 AS value","reason":"確認","undefined_terms":[]}',
            usage_metadata=usage,
        )
answer, usage = module["generate_request"](
    types.SimpleNamespace(models=Models()), module["DEFAULT_MODEL"], "質問", "規則"
)
_, legacy_usage = module["generate_request"](
    types.SimpleNamespace(models=Models()), module["DEFAULT_MODEL"], "質問", "規則"
)
print(json.dumps({
    "model": captured["model"],
    "pricing": module["PRICING"][captured["model"]],
    "legacy_pricing": module["PRICING"]["gemini-3.5-flash"],
    "has_temperature": hasattr(captured["config"], "temperature"),
    "answer": answer,
    "usage": usage,
    "legacy_usage": legacy_usage,
    "calls": captured["calls"],
}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    model: 'gemini-3.6-flash',
    pricing: [1.5, 7.5],
    legacy_pricing: [1.5, 9],
    has_temperature: false,
    answer: { sql: 'SELECT 1 AS value', reason: '確認', undefined_terms: [] },
    usage: { input_tokens: 10, output_tokens: 12 },
    legacy_usage: { input_tokens: 10, output_tokens: 5 },
    calls: 2,
  });
});

test('SQL repair keeps the confirmed analysis contract and warehouse diagnostic', () => {
  const result = loadRunReport(`
section = {
    "title": "主要ページ間回遊フロー",
    "text": "2021年1月の主要ページ間回遊を集計する",
    "compare": "execution",
    "component": "sankey",
    "shape": {"rows": "遷移ごとに1行", "columns": ["遷移元", "遷移先", "件数"]},
    "source_columns": ["source", "target", "metric_value"],
    "generation_requirements": ["ORDER BY metric_value DESC LIMIT 100を明示する"],
}
period = {"from": "20210101", "to": "20210131"}
request = module["repair_request"](
    module["generation_request"](section, period),
    "SELECT broken AS source FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\`",
    "Correlated subqueries that reference other tables are not supported",
)
rules = module["prompt_rules"]("")
print(json.dumps({"request": request, "rules": rules}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.request, /分析内容、対象期間、出力列の数・順序・別名.*変更せず/);
  assert.match(output.request, /Correlated subqueries that reference other tables/);
  assert.match(output.request, /source、target、metric_value/);
  assert.match(output.request, /ORDER BY metric_value DESC LIMIT 100/);
  assert.match(output.rules, /後続CTEやJOINから外側のテーブルを参照する相関サブクエリを作らない/);
});

test('only BigQuery compiler BadRequest diagnostics are repairable', () => {
  const result = loadRunReport(`
predicate = module["repairable_dry_run_error"]
print(json.dumps({
    "compiler": predicate("bq dry-run error: BadRequest: Correlated subqueries are not supported"),
    "credentials": predicate("bq dry-run error: RefreshError: credentials expired"),
    "transport": predicate("bq dry-run error: ServiceUnavailable: backend unavailable"),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    compiler: true,
    credentials: false,
    transport: false,
  });
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

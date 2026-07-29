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

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

test('BigQuery helpers preserve dry-run and guarded execution contracts', () => {
  const result = loadRunReport(`
import sys
import types

google = types.ModuleType("google")
cloud = types.ModuleType("google.cloud")
bigquery = types.ModuleType("google.cloud.bigquery")
class QueryJobConfig:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
bigquery.QueryJobConfig = QueryJobConfig
cloud.bigquery = bigquery
google.cloud = cloud
sys.modules["google"] = google
sys.modules["google.cloud"] = cloud
sys.modules["google.cloud.bigquery"] = bigquery

class Field:
    def __init__(self, name, field_type):
        self.name = name
        self.field_type = field_type
class Row:
    def values(self): return ["organic", 12]
class Rows:
    schema = [Field("category", "STRING"), Field("metric_value", "INT64")]
    def __iter__(self): return iter([Row()])
class Job:
    schema = [Field("category", "STRING"), Field("metric_value", "INT64")]
    statement_type = "SELECT"
    referenced_tables = [types.SimpleNamespace(
        project="bigquery-public-data",
        dataset_id="ga4_obfuscated_sample_ecommerce",
    )]
    def result(self, **kwargs):
        captured["result_kwargs"] = kwargs
        return Rows()
class Client:
    def query(self, sql, job_config):
        captured.setdefault("configs", []).append(job_config.__dict__)
        return Job()

captured = {}
table = chr(96) + "bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*" + chr(96)
query = "SELECT COUNT(1) AS metric_value FROM " + table
schema, schema_error = module["inspect_bq_schema"](Client(), query)
execution, execution_error = module["exec_bq"](Client(), query, max_results=25)
print(json.dumps({
    "schema": schema,
    "schema_error": schema_error,
    "execution": execution,
    "execution_error": execution_error,
    "configs": captured["configs"],
    "result_kwargs": captured["result_kwargs"],
    "max_bytes": module["MAX_BYTES_BILLED"],
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema: [
      ['category', 'STRING'],
      ['metric_value', 'INT64'],
    ],
    schema_error: null,
    execution: [[['organic', 12]], ['category', 'metric_value']],
    execution_error: null,
    configs: [
      {
        dry_run: true,
        maximum_bytes_billed: 20 * 1024 ** 3,
        use_query_cache: false,
      },
      { maximum_bytes_billed: 20 * 1024 ** 3, use_query_cache: true },
    ],
    result_kwargs: { timeout: 180, max_results: 25 },
    max_bytes: 20 * 1024 ** 3,
  });
});

test('canonical execution policy enforces exact tables and query limits', () => {
  const result = loadRunReport(`
import sys
import types
from analysis_contract_context import AnalysisExecutionPolicy
from analysis_schema_policy import AnalysisFieldPolicy

google = types.ModuleType("google")
cloud = types.ModuleType("google.cloud")
bigquery = types.ModuleType("google.cloud.bigquery")
class QueryJobConfig:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
bigquery.QueryJobConfig = QueryJobConfig
cloud.bigquery = bigquery
google.cloud = cloud
sys.modules["google"] = google
sys.modules["google.cloud"] = cloud
sys.modules["google.cloud.bigquery"] = bigquery

policy=AnalysisExecutionPolicy(
    query_tables=frozenset({"alpha.dataset.allowed"}),
    job_tables=frozenset({"alpha.dataset.allowed"}),
    maximum_bytes_billed=123,
    maximum_result_rows=7,
    schema_fields=(AnalysisFieldPolicy("alpha.dataset.allowed",("metric_value",),"INT64","NULLABLE",False,False),),
)
class Field:
    name="metric_value"
    field_type="INT64"
class Row:
    def values(self):return [1]
class Rows:
    schema=[Field()]
    def __iter__(self):return iter([Row()])
class Job:
    statement_type="SELECT"
    schema=[Field()]
    def __init__(self,table_id):
        self.referenced_tables=[types.SimpleNamespace(project="alpha",dataset_id="dataset",table_id=table_id)]
    def result(self,**_kwargs):return Rows()
class Client:
    def __init__(self,table_id):self.table_id=table_id;self.configs=[]
    def query(self,_sql,job_config):self.configs.append(job_config.__dict__);return Job(self.table_id)

tick=chr(96)
allowed="SELECT COUNT(1) AS metric_value FROM "+tick+"alpha.dataset.allowed"+tick
unlisted="SELECT COUNT(1) AS metric_value FROM "+tick+"alpha.dataset.unlisted"+tick
allowed_validation=module["validate_sql"](allowed,policy=policy)
unlisted_validation=module["validate_sql"](unlisted,policy=policy)
client=Client("allowed")
schema,schema_error=module["inspect_bq_schema"](client,allowed,policy=policy)
execution,execution_error=module["exec_bq"](client,allowed,max_results=8,policy=policy)
bad_schema,bad_error=module["inspect_bq_schema"](Client("unlisted"),allowed,policy=policy)
print(json.dumps({
    "allowed_validation":allowed_validation,
    "unlisted_error":unlisted_validation[1],
    "schema":schema,
    "schema_error":schema_error,
    "execution":execution,
    "execution_error":execution_error,
    "configs":client.configs,
    "bad_schema":bad_schema,
    "bad_error":bad_error,
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    allowed_validation: ['SELECT COUNT(1) AS metric_value FROM `alpha.dataset.allowed`', null],
    unlisted_error: 'rejected: table is outside the analysis contract',
    schema: [['metric_value', 'INT64']],
    schema_error: null,
    execution: [[[1]], ['metric_value']],
    execution_error: null,
    configs: [
      {
        dry_run: true,
        maximum_bytes_billed: 123,
        use_query_cache: false,
      },
      { maximum_bytes_billed: 123, use_query_cache: true },
    ],
    bad_schema: null,
    bad_error: 'bq dry-run rejected: table is outside the analysis contract',
  });
});

test('dry-run job statistics enforce SELECT and the allowed dataset', () => {
  const result = loadRunReport(`
import sys
import types

google = types.ModuleType("google")
cloud = types.ModuleType("google.cloud")
bigquery = types.ModuleType("google.cloud.bigquery")
class QueryJobConfig:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
bigquery.QueryJobConfig = QueryJobConfig
cloud.bigquery = bigquery
google.cloud = cloud
sys.modules["google"] = google
sys.modules["google.cloud"] = cloud
sys.modules["google.cloud.bigquery"] = bigquery

class Field:
    name = "metric_value"
    field_type = "INT64"
class Job:
    schema = [Field()]
    def __init__(self, statement_type, referenced_tables):
        self.statement_type = statement_type
        self.referenced_tables = referenced_tables
class Client:
    def __init__(self, job): self.job = job
    def query(self, _sql, job_config): return self.job

allowed = types.SimpleNamespace(
    project="bigquery-public-data",
    dataset_id="ga4_obfuscated_sample_ecommerce",
)
foreign = types.SimpleNamespace(project="another-project", dataset_id="analytics")
table = chr(96) + "bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*" + chr(96)
query = "SELECT COUNT(1) AS metric_value FROM " + table
cases = [
    Job("DELETE", [allowed]),
    Job("SELECT", [foreign]),
    Job("SELECT", []),
]
print(json.dumps([module["inspect_bq_schema"](Client(job), query) for job in cases]))
`);
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout);
  assert.match(cases[0][1], /statement type DELETE.*SELECT/);
  assert.match(cases[1][1], /foreign table ref another-project\.analytics/);
  assert.match(cases[2][1], /referenced tables.*not returned/);
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

test('clarification answers are appended as explicit conditions without changing the section contract', () => {
  const result = loadRunReport(`
import sys
import types
captured = {}
google = types.ModuleType("google")
genai = types.ModuleType("google.genai")
class Config:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
genai.types = types.SimpleNamespace(GenerateContentConfig=Config)
google.genai = genai
sys.modules["google"] = google
sys.modules["google.genai"] = genai
class Models:
    def generate_content(self, **kwargs):
        captured.update(kwargs)
        return types.SimpleNamespace(
            text='{"sql":"SELECT 1 AS value","reason":"確認","undefined_terms":[],"clarification_question":""}',
            usage_metadata=types.SimpleNamespace(prompt_token_count=1, candidates_token_count=1),
        )
section={"text":"登録ページのセッション数","compare":"execution","component":"table"}
module["generate"](types.SimpleNamespace(models=Models()), module["DEFAULT_MODEL"], section, {"from":"20210101","to":"20210131"}, "rules", clarification_answer="対象URLは /signup です")
print(json.dumps({"request":captured["contents"],"has_answer":"対象URLは /signup です" in captured["contents"],"no_guess":"回答にない条件は推測しない" in captured["contents"]}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.has_answer, true);
  assert.equal(output.no_guess, true);
  assert.equal(typeof output.request, 'string');
});

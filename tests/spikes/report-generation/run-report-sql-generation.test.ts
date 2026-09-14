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
    answer: {
      sql: 'SELECT 1 AS value',
      reason: '確認',
      undefined_terms: [],
      clarification_question: '',
    },
    usage: { input_tokens: 10, output_tokens: 12 },
    legacy_usage: { input_tokens: 10, output_tokens: 5 },
    calls: 2,
  });
});

test('SQL structured responses are bounded and expose stable finish diagnostics without retry', () => {
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
responses = [
    types.SimpleNamespace(
        text='{"sql":"SELECT',
        candidates=[types.SimpleNamespace(finish_reason="MAX_TOKENS")],
    ),
    types.SimpleNamespace(
        text='{"sql":',
        candidates=[types.SimpleNamespace(finish_reason="STOP")],
    ),
    types.SimpleNamespace(
        text='blocked body must not be exposed',
        candidates=[types.SimpleNamespace(finish_reason="SAFETY")],
    ),
]
calls = 0
limits = []
class Models:
    def generate_content(self, **kwargs):
        global calls
        limits.append(kwargs["config"].max_output_tokens)
        response = responses[calls]
        calls += 1
        return response
client = types.SimpleNamespace(models=Models())
errors = []
for _ in responses:
    try:
        module["generate_request"](client, "test-model", "質問", "規則")
    except ValueError as error:
        errors.append(str(error))
print(json.dumps({"calls":calls,"limits":limits,"errors":errors}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 3,
    limits: [8192, 8192, 8192],
    errors: [
      'SQL生成が出力上限までに完了しませんでした。今回のVertex AI呼出しは自動再実行していません。',
      'SQL生成JSONを解釈できませんでした。今回のVertex AI呼出しは自動再実行していません。',
      'SQL生成を完了できませんでした（終了理由: SAFETY）。今回のVertex AI呼出しは自動再実行していません。',
    ],
  });
});

test('SQL repair keeps the confirmed analysis contract and warehouse diagnostic', () => {
  const result = loadRunReport(`
section = {
    "title": "group comparison",
    "text": "compare the measured values by group",
    "shape": {"rows": "one row per group", "columns": ["group", "value"]},
    "source_columns": ["group_key", "metric_value"],
}
request = module["repair_request"](
    module["generation_request"](section),
    "SELECT broken AS group_key FROM source_table",
    "Correlated subqueries that reference other tables are not supported",
)
print(json.dumps({"request": request}, ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.request, /分析内容、対象期間、出力列の数・順序・別名.*変更せず/);
  assert.match(output.request, /Correlated subqueries that reference other tables/);
  assert.match(output.request, /group_key/);
  assert.match(output.request, /metric_value/);
  assert.doesNotMatch(output.request, /GA4|Bitcoin|NET\.PARSE_URL/);
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

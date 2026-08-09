import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'spikes/report-generation/meeting_report.py');

function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("meeting_report",${JSON.stringify(MODULE)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
bundle={
 "plan_revision":"plan-aaaaaaaaaaaa",
 "build_revision":"build-bbbbbbbbbbbb",
 "organization_context_revision":"demo-org-ec-v1",
 "organization_context":{"revision":"demo-org-ec-v1","goal":"購入成果を改善する","target":None},
 "analysis_specification":{"revision":"plan-aaaaaaaaaaaa","objective":"購入成果の課題を判断する","comparison":"月内推移","period":{"label":"2021年1月"}},
 "metric_definitions":{"購入件数":"取引IDの異なり数","購入金額":"purchase revenueの合計"},
 "panels":[
  {"id":"R4","title":"購入件数と売上","period":"2021年1月","sql_sha256":"1111111111111111","result_revision":"result-222222222222","columns":["購入件数","購入金額"],"rows":[[895,123456.0]],"verification":"matched"},
  {"id":"R16","title":"日別推移","period":"2021年1月","sql_sha256":"3333333333333333","result_revision":"result-444444444444","columns":["日付","セッション数","7日移動平均"],"rows":[["2021-01-31",118380,117000.5]],"verification":"matched"},
 ],
}
${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('normalizes a draft into immutable evidence-linked meeting commentary', () => {
  const result = python(`
raw={
 "executive_summary":"購入成果には追加診断が必要です。",
 "observations":[{"text":"購入金額は123,456.00円です。","panel_ids":["R4"]}],
 "interpretations":[{"text":"日次推移には変動があります。","uncertainty":"施策履歴が無いため原因は不明です。","panel_ids":["R16"]}],
 "hypotheses":[{"text":"導線に改善余地がある可能性があります。","validation":"流入別に追加検証します。","panel_ids":["R4","R16"]}],
 "actions":[{"text":"購入導線を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に比較します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
first=m.normalize_report(raw,bundle);second=m.normalize_report(raw,bundle)
print(json.dumps({
 "status":first["status"],"stable":first["report_revision"]==second["report_revision"],
 "revision":first["report_revision"],"refs":first["observations"][0]["evidence_refs"],
 "impact":first["actions"][0]["expected_impact"],"build":first["build_revision"],
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'draft_requires_human_approval',
    stable: true,
    revision: JSON.parse(result.stdout).revision,
    refs: [
      {
        panel_id: 'R4',
        sql_sha256: '1111111111111111',
        result_revision: 'result-222222222222',
      },
    ],
    impact: '阻害箇所を特定できます。',
    build: 'build-bbbbbbbbbbbb',
  });
  assert.match(JSON.parse(result.stdout).revision, /^report-[0-9a-f]{12}$/);
});

test('accepts evidence-linked numbers in the executive summary and rejects unsupported ones', () => {
  const result = python(`
base={
 "executive_summary":{"text":"2021年1月の購入件数は895件でした。","panel_ids":["R4"]},
 "observations":[{"text":"購入件数は895件です。","panel_ids":["R4"]}],
 "interpretations":[{"text":"追加診断が必要です。","uncertainty":"施策履歴がありません。","panel_ids":["R4"]}],
 "hypotheses":[{"text":"導線に課題がある可能性があります。","validation":"流入別に検証します。","panel_ids":["R4"]}],
 "actions":[{"text":"導線を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に比較します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
accepted=m.normalize_report(base,bundle)
errors=[]
for summary in [
 {"text":"購入件数は999件でした。","panel_ids":["R4"]},
 {"text":"購入件数は895件でした。","panel_ids":["R99"]},
]:
 try:m.normalize_report({**base,"executive_summary":summary},bundle)
 except m.ReportError as error:errors.append(str(error))
print(json.dumps({"text":accepted["executive_summary"]["text"],"refs":accepted["executive_summary"]["evidence_refs"],"errors":errors},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    text: '2021年1月の購入件数は895件でした。',
    refs: [
      {
        panel_id: 'R4',
        sql_sha256: '1111111111111111',
        result_revision: 'result-222222222222',
      },
    ],
    errors: [
      '会議報告に根拠パネルへ存在しない数値があります: 999',
      '会議報告の根拠パネルが未登録または空です。',
    ],
  });
});

test('rejects unsupported numbers, unknown evidence, and revision mismatches', () => {
  const result = python(`
base={
 "executive_summary":"要約です。",
 "observations":[{"text":"購入件数は895件です。","panel_ids":["R4"]}],
 "interpretations":[{"text":"解釈です。","uncertainty":"不確実です。","panel_ids":["R4"]}],
 "hypotheses":[{"text":"仮説です。","validation":"検証します。","panel_ids":["R4"]}],
 "actions":[{"text":"確認します。","owner":"担当者","urgency":"次回会議まで","expected_impact":"判断材料を増やします。","next_step":"分解します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値がありません。"],
}
cases=[]
bad_number={**base,"observations":[{"text":"購入件数は999件です。","panel_ids":["R4"]}]}
unknown={**base,"observations":[{"text":"観測です。","panel_ids":["R99"]}]}
bad_bundle={**bundle,"organization_context_revision":"other-v1"}
oversized={**bundle,"metric_definitions":{"x":"a"*50000}}
long_summary={**base,"executive_summary":{"text":"あ"*161,"panel_ids":["R4"]}}
too_many_observations={**base,"observations":base["observations"]*4}
for raw,current in [(bad_number,bundle),(unknown,bundle),(base,bad_bundle),({**base,"limitations":None},bundle),({**base,"limitations":["30件未満です。"]},bundle),(base,oversized),(long_summary,bundle),(too_many_observations,bundle)]:
 try:m.normalize_report(raw,current)
 except m.ReportError as error:cases.append(str(error))
print(json.dumps(cases,ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '会議報告に根拠パネルへ存在しない数値があります: 999',
    '会議報告の根拠パネルが未登録または空です。',
    '組織コンテキストrevisionが根拠bundleと一致しません。',
    '会議報告のlimitationsが配列ではありません。',
    '会議報告のlimitationsには根拠リンクのない数値を書けません。',
    '会議報告の根拠bundleが48 KiBを超えています。',
    '会議報告の要約は160文字以内にしてください。',
    '会議報告のobservationsは3件以内にしてください。',
  ]);
});

test('request carries declared context and the schema requires accountable actions', () => {
  const result = python(`
request=m.report_request(bundle)
required=m.REPORT_SCHEMA["properties"]["actions"]["items"]["required"]
print(json.dumps({
 "context":"購入成果を改善する" in request,
 "specification":"月内推移" in request,
 "metrics":"取引IDの異なり数" in request,
 "evidence":"result-222222222222" in request,
 "impact":"expected_impact" in required,
 "no_warehouse":"BigQuery" not in request,
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    context: true,
    specification: true,
    metrics: true,
    evidence: true,
    impact: true,
    no_warehouse: true,
  });
});

test('bounds report output and translates incomplete JSON into stable report errors', () => {
  const result = python(`
import sys,types
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
genai.types=types.SimpleNamespace(GenerateContentConfig=lambda **kwargs:kwargs)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
usage=types.SimpleNamespace(prompt_token_count=100,candidates_token_count=4096)
responses=[
 types.SimpleNamespace(text='{"executive_summary":{"text":"途中',candidates=[types.SimpleNamespace(finish_reason="MAX_TOKENS")],usage_metadata=usage),
 types.SimpleNamespace(text='{"executive_summary":{"text":"壊れた',candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=usage),
]
class Models:
 def generate_content(self,**_kwargs):return responses.pop(0)
client=types.SimpleNamespace(models=Models())
errors=[]
for _ in range(2):
 try:m.generate(client,"model",bundle)
 except m.ReportError as error:errors.append(str(error))
properties=m.REPORT_SCHEMA["properties"]
print(json.dumps({
 "errors":errors,
 "max_items":{name:properties[name].get("maxItems") for name in ["observations","interpretations","hypotheses","actions","limitations"]},
 "summary_length":properties["executive_summary"]["properties"]["text"].get("maxLength"),
 "claim_length":properties["observations"]["items"]["properties"]["text"].get("maxLength"),
 "brief":"観測は最大3件" in m.report_request(bundle) and "推奨アクションは最大2件" in m.report_request(bundle),
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    errors: [
      '会議報告が出力上限までに完了しませんでした。今回のVertex AI呼出しは課金対象で、自動再実行していません。',
      '会議報告のJSONが不完全です。今回のVertex AI呼出しは課金対象で、自動再実行していません。',
    ],
    max_items: {
      observations: 3,
      interpretations: 2,
      hypotheses: 2,
      actions: 2,
      limitations: 3,
    },
    summary_length: 160,
    claim_length: 120,
    brief: true,
  });
});

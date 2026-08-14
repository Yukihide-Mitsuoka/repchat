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
 "executive_summary":{"text":"購入成果には追加診断が必要です。","panel_ids":["R4"]},
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

test('accepts rounded direct metrics and recorded funnel conversion rates only from cited panels', () => {
  const result = python(`
panels=[
 {"id":"R11","title":"リピートユーザー率","period":"2021年1月","sql_sha256":"5555555555555555","result_revision":"result-666666666666","columns":["リピートユーザー率"],"rows":[[14.559999]],"verification":"matched"},
 {"id":"R12","title":"平均エンゲージメント時間","period":"2021年1月","sql_sha256":"7777777777777777","result_revision":"result-888888888888","columns":["平均エンゲージメント時間"],"rows":[[49.509999]],"verification":"matched"},
 {"id":"R9","title":"購入までのファネル","period":"2021年1月","sql_sha256":"9999999999999999","result_revision":"result-aaaaaaaaaaaa","columns":["商品を見たセッション数","カートに入れたセッション数","購入したセッション数"],"rows":[[23105,4537,1115]],"visualization":"funnel","verification":"matched","derived_metrics":m.funnel_conversion_metrics(["商品を見たセッション数","カートに入れたセッション数","購入したセッション数"],[[23105,4537,1115]])},
]
current={**bundle,"panels":panels}
raw={
 "executive_summary":{"text":"リピートユーザー率は14.56%、平均エンゲージメント時間は49.51秒です。","panel_ids":["R11","R12"]},
 "observations":[{"text":"商品閲覧からカート追加への転換率は19.6%です。","panel_ids":["R9"]}],
 "interpretations":[{"text":"ファネルに減少があります。","uncertainty":"施策履歴がありません。","panel_ids":["R9"]}],
 "hypotheses":[{"text":"商品詳細に改善余地がある可能性があります。","validation":"導線別に検証します。","panel_ids":["R9"]}],
 "actions":[{"text":"商品詳細を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"導線別に比較します。","success_metric":"カート追加率","panel_ids":["R9"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
accepted=m.normalize_report(raw,current)
bad={**raw,"observations":[{"text":"商品閲覧からカート追加への転換率は18.4%です。","panel_ids":["R9"]}]}
wrong_panel={**raw,"observations":[{"text":"商品閲覧からカート追加への転換率は19.6%です。","panel_ids":["R11"]}]}
tampered_panels=[{**panel,"derived_metrics":[{**panel["derived_metrics"][0],"value":18.4}]} if panel["id"]=="R9" else panel for panel in panels]
errors=[]
for candidate,evidence in [(bad,current),(wrong_panel,current),(raw,{**current,"panels":tampered_panels})]:
 try:m.normalize_report(candidate,evidence)
 except m.ReportError as error:errors.append(str(error))
print(json.dumps({"summary":accepted["executive_summary"]["text"],"observation":accepted["observations"][0]["text"],"errors":errors},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    summary: 'リピートユーザー率は14.56%、平均エンゲージメント時間は49.51秒です。',
    observation: '商品閲覧からカート追加への転換率は19.6%です。',
    errors: [
      '会議報告に根拠パネルへ存在しない数値があります: 18.4',
      '会議報告に根拠パネルへ存在しない数値があります: 19.6',
      '根拠パネルR9の派生指標が不正です。',
    ],
  });
});

test('rejects unsupported numbers, unknown evidence, and revision mismatches', () => {
  const result = python(`
base={
 "executive_summary":{"text":"要約です。","panel_ids":["R4"]},
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
for raw,current in [({**base,"executive_summary":"要約です。"},bundle),(bad_number,bundle),(unknown,bundle),(base,bad_bundle),({**base,"limitations":None},bundle),({**base,"limitations":["30件未満です。"]},bundle),(base,oversized),(long_summary,bundle),(too_many_observations,bundle)]:
 try:m.normalize_report(raw,current)
 except m.ReportError as error:cases.append(str(error))
print(json.dumps(cases,ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '会議報告の根拠パネルが未登録または空です。',
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
genai.types=types.SimpleNamespace(
 GenerateContentConfig=lambda **kwargs:kwargs,
 ThinkingConfig=lambda **kwargs:kwargs,
 ThinkingLevel=types.SimpleNamespace(LOW="LOW"),
)
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

test('reserves report output budget and accounts for billed thinking tokens', () => {
  const result = python(`
import sys,types
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class Config:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(
 GenerateContentConfig=Config,
 ThinkingConfig=Config,
 ThinkingLevel=types.SimpleNamespace(LOW="LOW"),
)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
raw={
 "executive_summary":{"text":"追加診断が必要です。","panel_ids":["R4"]},
 "observations":[{"text":"購入成果を確認しました。","panel_ids":["R4"]}],
 "interpretations":[{"text":"追加分析が必要です。","uncertainty":"施策履歴がありません。","panel_ids":["R4"]}],
 "hypotheses":[{"text":"導線に課題がある可能性があります。","validation":"流入別に確認します。","panel_ids":["R4"]}],
 "actions":[{"text":"購入導線を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に比較します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
usage=types.SimpleNamespace(prompt_token_count=100,candidates_token_count=600,thoughts_token_count=300)
response=types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=usage)
captured={}
class Models:
 def generate_content(self,**kwargs):
  captured["config"]=kwargs["config"]
  return response
report,tokens=m.generate(types.SimpleNamespace(models=Models()),"model",bundle)
config=captured["config"]
thinking=getattr(config,"thinking_config",None)
print(json.dumps({
 "max_output_tokens":config.max_output_tokens,
 "thinking_level":getattr(thinking,"thinking_level",None),
 "has_temperature":hasattr(config,"temperature"),
 "input_tokens":tokens["input_tokens"],
 "output_tokens":tokens["output_tokens"],
 "status":report["status"],
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    max_output_tokens: 8192,
    thinking_level: 'LOW',
    has_temperature: false,
    input_tokens: 100,
    output_tokens: 900,
    status: 'draft_requires_human_approval',
  });
});

test('one paid response with unsupported claims fails without retrying or rewriting', () => {
  const result = python(`
import sys,types
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class Config:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(
 GenerateContentConfig=Config,
 ThinkingConfig=Config,
 ThinkingLevel=types.SimpleNamespace(LOW="LOW"),
)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
raw={
 "executive_summary":{"text":"購入件数は895件で、追加診断が必要です。","panel_ids":["R4"]},
 "observations":[
  {"text":"購入件数は895件です。","panel_ids":["R4"]},
  {"text":"根拠外の22件を確認しました。","panel_ids":["R4"]},
 ],
 "interpretations":[{"text":"セッションは3000件から4000件です。","uncertainty":"施策履歴がありません。","panel_ids":["R16"]}],
 "hypotheses":[{"text":"導線に改善余地がある可能性があります。","validation":"流入別に確認します。","panel_ids":["R4"]}],
 "actions":[{"text":"6施策を実行します。","owner":"担当者","urgency":"次回会議まで","expected_impact":"判断材料を増やします。","next_step":"導線別に確認します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["直近3か月の目標値が未登録です。"],
}
usage=types.SimpleNamespace(prompt_token_count=100,candidates_token_count=600,thoughts_token_count=0)
response=types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=usage)
captured={"calls":0}
class Models:
 def generate_content(self,**kwargs):
  captured["calls"]+=1;captured["config"]=kwargs["config"];return response
strict_error=""
try:m.normalize_report(raw,bundle)
except m.ReportError as error:strict_error=str(error)
generated_error=""
try:m.generate(types.SimpleNamespace(models=Models()),"model",bundle)
except m.ReportError as error:generated_error=str(error)
print(json.dumps({
 "calls":captured["calls"],
 "strict_error":strict_error,
 "generated_error":generated_error,
 "fallback":hasattr(m,"_fallback_raw_report"),
 "limitation_pattern":captured["config"].response_schema["properties"]["limitations"]["items"]["pattern"],
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.calls, 1);
  assert.equal(output.strict_error, '会議報告に根拠パネルへ存在しない数値があります: 22');
  assert.equal(output.generated_error, output.strict_error);
  assert.equal(output.fallback, false);
  assert.equal(output.limitation_pattern, '^[^0-9０-９]*$');
});

test('invalid generated meeting commentary fails instead of using fixed fallback prose', () => {
  const result = python(`
invalid={
 "executive_summary":{"text":"根拠外の22件を確認しました。","panel_ids":["R4"]},
 "observations":[{"text":"根拠外の22件を確認しました。","panel_ids":["R4"]}],
 "interpretations":[],"hypotheses":[],"actions":[],"limitations":[]
}
try:
 m.normalize_report(invalid,bundle)
except m.ReportError as error:
 print(json.dumps({"error":str(error),"fallback":hasattr(m,"_fallback_raw_report"),"normalizer":hasattr(m,"normalize_generated_report")},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: '会議報告に根拠パネルへ存在しない数値があります: 22',
    fallback: false,
    normalizer: false,
  });
});

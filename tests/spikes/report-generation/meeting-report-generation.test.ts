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
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: [path.dirname(MODULE), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
    },
  );
}

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

test('bounds an overlong generated summary without retrying the paid response', () => {
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
 "executive_summary":{"text":"購入成果を確認しました。"+"追加診断が必要です。"*20,"panel_ids":["R4"]},
 "observations":[{"text":"購入件数は895件です。","panel_ids":["R4"]}],
 "interpretations":[{"text":"変動があります。","uncertainty":"施策履歴がありません。","panel_ids":["R4"]}],
 "hypotheses":[{"text":"導線に改善余地がある可能性があります。","validation":"流入別に確認します。","panel_ids":["R4"]}],
 "actions":[{"text":"導線を確認します。","owner":"担当者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に確認します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
usage=types.SimpleNamespace(prompt_token_count=100,candidates_token_count=600,thoughts_token_count=0)
response=types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=usage)
captured={"calls":0}
class Models:
 def generate_content(self,**kwargs):
  captured["calls"]+=1
  return response
report,_=m.generate(types.SimpleNamespace(models=Models()),"model",bundle)
print(json.dumps({"calls":captured["calls"],"length":len(report["executive_summary"]["text"]),"warnings":report.get("generation_warnings",[])},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 1,
    length: 152,
    warnings: ['AIが生成した会議報告の要約を160文字以内に整形しました。'],
  });
});

test('rejects an overlong generated summary when no complete sentence fits', () => {
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
 "executive_summary":{"text":"あ"*161,"panel_ids":["R4"]},
 "observations":[{"text":"購入件数は895件です。","panel_ids":["R4"]}],
 "interpretations":[{"text":"変動があります。","uncertainty":"施策履歴がありません。","panel_ids":["R4"]}],
 "hypotheses":[{"text":"導線に改善余地がある可能性があります。","validation":"流入別に確認します。","panel_ids":["R4"]}],
 "actions":[{"text":"導線を確認します。","owner":"担当者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に確認します。","success_metric":"購入件数","panel_ids":["R4"]}],
 "limitations":["目標値と施策履歴が未登録です。"],
}
usage=types.SimpleNamespace(prompt_token_count=100,candidates_token_count=600,thoughts_token_count=0)
response=types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=usage)
class Models:
 def generate_content(self,**kwargs):return response
try:
 m.generate(types.SimpleNamespace(models=Models()),"model",bundle)
except Exception as error:
 print(json.dumps({"message":str(error)},ensure_ascii=False))
else:
 print(json.dumps({"message":"accepted"},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).message, '会議報告の要約は160文字以内にしてください。');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER = path.join(ROOT, 'spikes/report-generation/analysis_planner.py');
const PYTHON_ENV = { ...process.env, PYTHONPATH: path.dirname(PLANNER) };

test('analysis consultation creates new executable specifications from context and history', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
context="定義済み指標: セッション数、購入件数。利用可能な軸: medium、device category。"
history=[
 {"role":"user","content":"どんな分析をしたらいい？"},
 {"role":"assistant","content":"全体規模を確認する分析を提案しました。"},
]
raw={
 "assistant_message":"別の切り口なら流入元を比較できます。",
 "recommendations":[{
  "title":"流入チャネル別の集客規模",
  "objective":"集客量が偏っている流入元を見つける",
  "dimensions":["medium"],
  "measures":["セッション数"],
  "comparison":"2021年1月の流入チャネル間比較",
  "chart":"bar",
  "execution_prompt":"2021年1月のセッション数を流入チャネル（medium）別に出して",
  "reason":"集客の偏りを判断できるため"
 }],
 "follow_up_question":"成果と集客のどちらを優先しますか？",
}
normalized=p.normalize_consultation(raw)
request=p.consultation_request("他にない？",history,context,"ga4")
errors=[]
for invalid in [
 {**raw,"recommendations":[raw["recommendations"][0],raw["recommendations"][0]]},
 {**raw,"recommendations":[{**raw["recommendations"][0],"execution_prompt":"SELECT * FROM events"}]},
 {**raw,"recommendations":[{**raw["recommendations"][0],"reason":""}]},
 {**raw,"recommendations":[{**raw["recommendations"][0],"dimensions":[]}]},
]:
 try:p.normalize_consultation(invalid)
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({
 "titles":[item["title"] for item in normalized["recommendations"]],
 "generated_prompt":normalized["recommendations"][0]["execution_prompt"],
 "dimensions":normalized["recommendations"][0]["dimensions"],
 "measures":normalized["recommendations"][0]["measures"],
 "revision":normalized["recommendations"][0]["revision"],
 "history_in_request":all(item["content"] in request for item in history),
 "current_in_request":"他にない？" in request,
 "context_in_request":"medium" in request,
 "errors":errors,
},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.revision, /^insight-[0-9a-f]{12}$/);
  delete output.revision;
  assert.deepEqual(output, {
    titles: ['流入チャネル別の集客規模'],
    generated_prompt: '2021年1月のセッション数を流入チャネル（medium）別に出して',
    dimensions: ['medium'],
    measures: ['セッション数'],
    history_in_request: true,
    current_in_request: true,
    context_in_request: true,
    errors: [
      '分析相談に重複した候補があります。',
      '分析相談の実行依頼にはSQLを書けません。',
      '分析相談の候補理由が空です。',
      'AIが生成したbar仕様を描画できません。必要なのは区分軸1件・指標1件ですが、AI出力は区分軸0件・指標1件でした。',
    ],
  });
});

test('consultation keeps structured dimensions when prose uses a synonym', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
recommendation={
 "title":"URL別の購入成果","objective":"改善対象を判断する","dimensions":["ページ"],"measures":["購入件数"],
 "comparison":"URL間比較","chart":"bar","execution_prompt":"2021年1月のURL別の購入成果を比較する",
 "reason":"閲覧単位の差を確認するため"
}
confirmed=p.confirm_analysis_specification(recommendation)
print(json.dumps({"dimensions":confirmed["dimensions"],"measures":confirmed["measures"],"prompt":confirmed["execution_prompt"]},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dimensions: ['ページ'],
    measures: ['購入件数'],
    prompt: '2021年1月のURL別の購入成果を比較する',
  });
});

test('planner constrains each response schema to unanswered clarification fields', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json,sys,types
sys.path.insert(0,${JSON.stringify(path.dirname(PLANNER))})
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
period={"from":"20210101","to":"20210131","label":"2021年1月"}
def panel(index):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":"目的に必要","execution_prompt":f"2021年1月の指標{index}を1行で出す","dimensions":[],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
base={
 "objective_summary":"購入成果の阻害箇所を特定して優先施策を決める",
 "audience":"月次マーケティング会議",
 "comparison":"月内の日次推移とファネル段階",
 "hypotheses":["商品閲覧からカート追加への減少が大きい"],
 "panels":[panel(index) for index in range(1,7)],
}
responses=[
 {**base,"clarifications":[{"field":"channel","question":"流入は","recommended_answer":"organic"}]},
 {**base,"clarifications":[{"field":"audience","question":"主な読者は","recommended_answer":"責任者"}]},
 {**base,"clarifications":[]},
]
schemas=[];calls=0
class Models:
 def generate_content(self,**kwargs):
  global calls
  response=responses[calls];calls+=1
  clarifications=kwargs["config"].response_schema["properties"]["clarifications"]
  schemas.append({
   "enum":clarifications["items"]["properties"]["field"].get("enum"),
   "min_items":clarifications.get("minItems"),
   "max_items":clarifications.get("maxItems"),
   "has_temperature":hasattr(kwargs["config"],"temperature"),
  })
  return types.SimpleNamespace(
   text=json.dumps(response,ensure_ascii=False),
   usage_metadata=types.SimpleNamespace(prompt_token_count=1,candidates_token_count=1),
  )
client=types.SimpleNamespace(models=Models());errors=[]
answer_sets=[
 {},
 {"audience":"月次マーケティング会議"},
 {"audience":"月次マーケティング会議","comparison":"前月","business_goal":"購入成果改善"},
]
for answers in answer_sets:
 try:p.propose_dashboard(client,"test-model","目的",period,"指標定義",answers)
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({"calls":calls,"schemas":schemas,"errors":errors},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 3,
    schemas: [
      {
        enum: ['audience', 'comparison', 'business_goal'],
        min_items: 1,
        max_items: 3,
        has_temperature: false,
      },
      {
        enum: ['comparison', 'business_goal'],
        min_items: null,
        max_items: 2,
        has_temperature: false,
      },
      {
        enum: null,
        min_items: null,
        max_items: null,
        has_temperature: false,
      },
    ],
    errors: [
      '確認事項のfieldが許可範囲外です: "channel"',
      '確認事項のfieldは回答済みです: "audience"',
    ],
  });
});

test('planner usage includes thought tokens and supports metadata without them', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json,sys,types
sys.path.insert(0,${JSON.stringify(path.dirname(PLANNER))})
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
raw={
 "objective_summary":"購入成果の阻害箇所を特定する",
 "audience":"月次マーケティング会議",
 "comparison":"月内の日次推移",
 "hypotheses":["購入導線に減少箇所がある"],
 "clarifications":[],
 "panels":[{"title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":"目的に必要","execution_prompt":f"2021年1月の指標{index}を1行で出す","dimensions":[],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1} for index in range(1,7)],
}
usage=[
 types.SimpleNamespace(prompt_token_count=10,candidates_token_count=5,thoughts_token_count=7),
 types.SimpleNamespace(prompt_token_count=10,candidates_token_count=5),
]
calls=0
class Models:
 def generate_content(self,**_kwargs):
  global calls
  metadata=usage[calls];calls+=1
  return types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),usage_metadata=metadata)
client=types.SimpleNamespace(models=Models())
period={"from":"20210101","to":"20210131","label":"2021年1月"}
answers={"audience":"月次マーケティング会議"}
first=p.propose_dashboard(client,"test-model","目的",period,"指標定義",answers)[1]
without_thoughts=p.propose_dashboard(client,"test-model","目的",period,"指標定義",answers)[1]
print(json.dumps({"calls":calls,"first":first,"without_thoughts":without_thoughts},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 2,
    first: { input_tokens: 10, output_tokens: 12 },
    without_thoughts: { input_tokens: 10, output_tokens: 5 },
  });
});

test('planner structured responses are bounded and expose stable finish diagnostics without retry', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json,sys,types
sys.path.insert(0,${JSON.stringify(path.dirname(PLANNER))})
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
responses=[]
for finish,text in [("MAX_TOKENS",'{"panels":'),("STOP",'{"panels":'),("SAFETY",'blocked body must not be exposed')]:
 responses.append(types.SimpleNamespace(text=text,candidates=[types.SimpleNamespace(finish_reason=finish)]))
for finish,text in [("MAX_TOKENS",'{"recommendations":'),("STOP",'{"recommendations":'),("SAFETY",'blocked body must not be exposed')]:
 responses.append(types.SimpleNamespace(text=text,candidates=[types.SimpleNamespace(finish_reason=finish)]))
calls=0;limits=[]
class Models:
 def generate_content(self,**kwargs):
  global calls
  limits.append(kwargs["config"].max_output_tokens)
  response=responses[calls];calls+=1;return response
client=types.SimpleNamespace(models=Models())
period={"from":"20210101","to":"20210131","label":"2021年1月"}
errors=[]
for _ in range(3):
 try:p.propose_dashboard(client,"test-model","目的",period,"指標定義",{})
 except p.PlannerError as error:errors.append(str(error))
for _ in range(3):
 try:p.propose_consultation(client,"test-model","質問",[],"文脈","ga4")
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({"calls":calls,"limits":limits,"errors":errors},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 6,
    limits: [32768, 32768, 32768, 8192, 8192, 8192],
    errors: [
      'Vertex AIの分析計画が出力上限までに完了しませんでした。現在案は保持し、自動再実行していません。',
      'Vertex AIの分析計画JSONを解釈できませんでした。現在案は保持し、自動再実行していません。',
      'Vertex AIが分析計画の生成を完了できませんでした（終了理由: SAFETY）。現在案は保持し、自動再実行していません。',
      'Vertex AIの分析相談が出力上限までに完了しませんでした。現在案は保持し、自動再実行していません。',
      'Vertex AIの分析相談JSONを解釈できませんでした。現在案は保持し、自動再実行していません。',
      'Vertex AIが分析相談の生成を完了できませんでした（終了理由: SAFETY）。現在案は保持し、自動再実行していません。',
    ],
  });
});

test('confirmed dynamic plan requires a non-empty answer for every displayed clarification', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
period={"from":"20210101","to":"20210131","label":"2021年1月"}
plan={
 "objective":"購入成果を改善する",
 "objective_summary":"購入成果の課題を判断する",
 "audience":"月次会議",
 "comparison":"月内推移",
 "period":period,
 "hypotheses":["導線に課題がある"],
 "clarifications":[{"field":"business_goal","question":"優先する目標は","recommended_answer":"購入件数の改善"}],
 "answers":{},
 "panels":[{"title":"購入規模","kpi":"購入件数","chart":"scorecard","decision":"成果規模を判断する","reason":"基準値に必要","execution_prompt":"2021年1月の購入件数を1行で出す","dimensions":[],"measures":["購入件数"],"layout_row":1,"layout_weight":1}],
}
missing=""
try:p.confirm_dashboard_plan(plan)
except p.PlannerError as error:missing=str(error)
accepted=p.confirm_dashboard_plan({**plan,"answers":{"business_goal":"購入件数の改善"}})
print(json.dumps({"missing":missing,"status":accepted["status"],"answers":accepted["answers"]},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    missing: '確認事項business_goalの回答が空です。',
    status: 'confirmed',
    answers: { business_goal: '購入件数の改善' },
  });
});

test('confirming a selected subset preserves AI layout without inventing replacement rows', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
period={"from":"20210101","to":"20210131","label":"2021年1月"}
def panel(index,row):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":"目的に必要","execution_prompt":f"2021年1月の指標{index}を1行で出す","dimensions":[],"measures":[f"指標{index}"],"layout_row":row,"layout_weight":index}
raw={"objective_summary":"成果を判断する","audience":"責任者","comparison":"月内比較","hypotheses":["差がある"],"clarifications":[],"panels":[panel(1,1),panel(2,2),panel(3,3)]}
plan=p.normalize_dashboard_plan(raw,"ダッシュボードを作って",period,{"audience":"責任者"})
plan["panels"]=[plan["panels"][0],plan["panels"][2]]
confirmed=p.confirm_dashboard_plan(plan)
print(json.dumps([[item["layout_row"],item["layout_weight"]] for item in confirmed["panels"]]))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [1, 1],
    [3, 3],
  ]);
});

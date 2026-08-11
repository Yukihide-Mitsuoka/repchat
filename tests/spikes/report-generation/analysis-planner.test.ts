import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER = path.join(ROOT, 'spikes/report-generation/analysis_planner.py');

test('analysis planner validates and freezes AI-authored panel specifications', () => {
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
def panel(index,chart="bar"):
 return {"title":f"分析{index}","kpi":f"指標{index}","chart":chart,"decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の定義済み指標{index}を区分別に出して"}
base={
 "objective_summary":"購入成果の阻害箇所を特定して優先施策を決める",
 "audience":"月次マーケティング会議",
 "comparison":"月内の日次推移とファネル段階",
 "hypotheses":["商品閲覧からカート追加への減少が大きい"],
 "clarifications":[{"field":"audience","question":"主な読者は誰ですか","recommended_answer":"マーケティング責任者"}],
 "panels":[panel(index) for index in range(1,7)],
}
class Models:
 def generate_content(self,**_kwargs):return types.SimpleNamespace(text=json.dumps(base,ensure_ascii=False),usage_metadata=types.SimpleNamespace(prompt_token_count=1,candidates_token_count=1))
client=types.SimpleNamespace(models=Models())
first,_usage=p.propose_dashboard(client,"test-model","2021年1月の購入成果を改善するダッシュボードを作って",period,"指標定義",{})
answered={**base,"clarifications":[],"audience":"マーケティング責任者"}
second=p.normalize_dashboard_plan(answered,first["objective"],period,{"audience":"マーケティング責任者"})
confirmed=p.confirm_dashboard_plan(second)
errors=[]
for changed in [
 {**base,"panels":[]},
 {**base,"panels":[*base["panels"][:5],base["panels"][0]]},
 {**base,"panels":[*base["panels"][:5],{**panel(6),"execution_prompt":"SELECT * FROM events"}]},
]:
 try:p.normalize_dashboard_plan(changed,first["objective"],period,{})
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({
 "first_status":first["status"],"question_count":len(first["clarifications"]),
 "revision_stable":first["revision"]==p.normalize_dashboard_plan(base,first["objective"],period,{})["revision"],
 "confirmed_status":confirmed["status"],"revision_changed":confirmed["revision"]!=first["revision"],
 "context":confirmed["organization_context_revision"],"panel_ids":[item["id"] for item in confirmed["panels"]],
 "frozen_prompt":confirmed["panels"][0]["execution_prompt"],
 "errors":errors,
},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    first_status: 'proposed',
    question_count: 1,
    revision_stable: true,
    confirmed_status: 'confirmed',
    revision_changed: true,
    context: 'demo-org-ec-v1',
    panel_ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    frozen_prompt: '2021年1月の定義済み指標1を区分別に出して',
    errors: [
      '分析計画のパネルは1〜20件にしてください。',
      '分析計画に重複した実行仕様があります。',
      '分析計画の実行仕様にはSQLを書けません。',
    ],
  });
});

test('planner prompt requests new specifications without exposing fixed analyses', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
request=p.dashboard_planning_request("目的",{"label":"2021年1月"},"指標定義",{})
panels=p._dashboard_response_schema({})["properties"]["panels"]
print(json.dumps({"context":p.ORGANIZATION_CONTEXT["revision"] in request,"metrics":"指標定義" in request,"new_specs":"分析仕様そのものを新規" in request,"fixed_ids":any(panel_id in request for panel_id in p.PANEL_CATALOG),"count":[panels["minItems"],panels["maxItems"]],"questions":"確認を1〜3件" in request},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    context: true,
    metrics: true,
    new_specs: true,
    fixed_ids: false,
    count: [6, 6],
    questions: true,
  });
});

test('dashboard panel counts are administrator policy rather than analysis hardcodes', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
initial=p._dashboard_response_schema({})["properties"]["panels"]
revision=p._dashboard_response_schema({},revising=True)["properties"]["panels"]
print(json.dumps({"initial":p.INITIAL_PANEL_COUNT,"maximum":p.MAX_PANEL_COUNT,"initial_schema":[initial["minItems"],initial["maxItems"]],"revision_schema":[revision["minItems"],revision["maxItems"]]},ensure_ascii=False))`,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANALYSIS_INITIAL_PANEL_COUNT: '5',
        ANALYSIS_MAX_PANEL_COUNT: '15',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    initial: 5,
    maximum: 15,
    initial_schema: [5, 5],
    revision_schema: [1, 15],
  });
  for (const [initial, maximum, error] of [
    ['0', '20', 'ANALYSIS_INITIAL_PANEL_COUNT must be a positive integer'],
    ['6', '5', 'ANALYSIS_INITIAL_PANEL_COUNT must not exceed ANALYSIS_MAX_PANEL_COUNT'],
  ] as const) {
    const invalid = spawnSync('python3', ['-c', `exec(open(${JSON.stringify(PLANNER)}).read())`], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANALYSIS_INITIAL_PANEL_COUNT: initial,
        ANALYSIS_MAX_PANEL_COUNT: maximum,
      },
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, new RegExp(error));
  }
});

test('dashboard revisions preserve current specifications and accept add/change/delete instructions', () => {
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
def panel(index):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分別に出して"}
raw={"objective_summary":"購入課題を判断する","audience":"責任者","comparison":"月内比較","hypotheses":["差がある"],"clarifications":[],"panels":[panel(index) for index in range(1,7)]}
plan=p.normalize_dashboard_plan(raw,"2021年1月の購入課題を分析するダッシュボードを作って",period,{"audience":"責任者"})
request=p.dashboard_planning_request(plan["objective"],period,"指標定義",plan["answers"],current_plan=plan,instruction="流入別パネルを追加し、分析2を変更して分析3を削除して")
errors=[]
for current,instruction in [(plan,None),(None,"追加して")]:
 try:p.dashboard_planning_request(plan["objective"],period,"指標定義",plan["answers"],current_plan=current,instruction=instruction)
 except p.PlannerError as error:errors.append(str(error))
class Models:
 def generate_content(self,**_kwargs):return types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),usage_metadata=types.SimpleNamespace(prompt_token_count=1,candidates_token_count=1))
try:p.propose_dashboard(types.SimpleNamespace(models=Models()),"test-model",plan["objective"],period,"指標定義",plan["answers"],current_plan=plan,instruction="流入別パネルを追加して")
except p.PlannerError as error:errors.append(str(error))
mixed,_usage=p.propose_dashboard(types.SimpleNamespace(models=Models()),"test-model",plan["objective"],period,"指標定義",plan["answers"],current_plan=plan,instruction="流入別を追加して分析3を削除して")
print(json.dumps({"current_specs":all(value in request for value in ["現在の分析仕様","分析1","2021年1月の指標1を区分別に出して"]),"instruction":"流入別パネルを追加" in request,"operations":all(value in request for value in ["追加・変更・削除相談","明示されていない既存パネルは維持","1〜20件"]),"fixed_ids":any(panel_id in request for panel_id in p.PANEL_CATALOG),"mixed_allowed":len(mixed["panels"])==6,"errors":errors},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    current_specs: true,
    instruction: true,
    operations: true,
    fixed_ids: false,
    mixed_allowed: true,
    errors: [
      '現在案と変更依頼は一緒に指定してください。',
      '現在案と変更依頼は一緒に指定してください。',
      '追加依頼に対して分析パネルが追加されませんでした。',
    ],
  });
});

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
  "title":"流入チャネル別の購入効率",
  "objective":"集客量だけでなく購入成果につながる流入元を見つける",
  "metric":"セッション数と購入件数",
  "dimension":"medium",
  "comparison":"2021年1月の流入チャネル間比較",
  "chart":"bar",
  "execution_prompt":"2021年1月のセッション数と購入件数を流入チャネル（medium）別に出して",
  "reason":"集客の偏りと成果の両方を判断できるため"
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
]:
 try:p.normalize_consultation(invalid)
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({
 "titles":[item["title"] for item in normalized["recommendations"]],
 "generated_prompt":normalized["recommendations"][0]["execution_prompt"],
 "history_in_request":all(item["content"] in request for item in history),
 "current_in_request":"他にない？" in request,
 "context_in_request":"medium" in request,
 "errors":errors,
},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    titles: ['流入チャネル別の購入効率'],
    generated_prompt: '2021年1月のセッション数と購入件数を流入チャネル（medium）別に出して',
    history_in_request: true,
    current_in_request: true,
    context_in_request: true,
    errors: [
      '分析相談に重複した候補があります。',
      '分析相談の実行依頼にはSQLを書けません。',
      '分析相談の候補理由が空です。',
    ],
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
base={
 "objective_summary":"購入成果の阻害箇所を特定して優先施策を決める",
 "audience":"月次マーケティング会議",
 "comparison":"月内の日次推移とファネル段階",
 "hypotheses":["商品閲覧からカート追加への減少が大きい"],
 "panels":[{"id":panel_id,"reason":"目的に必要"} for panel_id in ["R4","R9","R16","R17"]],
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
 try:p.propose(client,"test-model","目的",period,"指標定義",answers)
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({"calls":calls,"schemas":schemas,"errors":errors},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
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
        max_items: 0,
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
 "panels":[{"id":panel_id,"reason":"目的に必要"} for panel_id in ["R4","R9","R16","R17"]],
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
first=p.propose(client,"test-model","目的",period,"指標定義",answers)[1]
legacy=p.propose(client,"test-model","目的",period,"指標定義",answers)[1]
print(json.dumps({"calls":calls,"first":first,"legacy":legacy},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 2,
    first: { input_tokens: 10, output_tokens: 12 },
    legacy: { input_tokens: 10, output_tokens: 5 },
  });
});

test('confirmed plan requires a non-empty answer for every displayed clarification', () => {
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
 "panels":[{"id":panel_id,"reason":"必要"} for panel_id in ["R4","R9","R16","R17"]],
}
missing=""
try:p.confirm_plan(plan)
except p.PlannerError as error:missing=str(error)
accepted=p.confirm_plan({**plan,"answers":{"business_goal":"購入件数の改善"}})
print(json.dumps({"missing":missing,"status":accepted["status"],"answers":accepted["answers"]},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    missing: '確認事項business_goalの回答が空です。',
    status: 'confirmed',
    answers: { business_goal: '購入件数の改善' },
  });
});

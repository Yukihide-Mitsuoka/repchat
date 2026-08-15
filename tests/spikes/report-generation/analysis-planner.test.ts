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
 return {"title":f"分析{index}","kpi":f"指標{index}","chart":chart,"decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の定義済み指標{index}を区分別に出して","dimensions":["区分"],"measures":[f"定義済み指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
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
 {**base,"panels":[panel(index) for index in range(1,22)]},
 {**base,"panels":[*base["panels"][:5],base["panels"][0]]},
 {**base,"panels":[*base["panels"][:5],{**panel(6),"execution_prompt":"SELECT * FROM events"}]},
]:
 try:p.normalize_dashboard_plan(changed,first["objective"],period,{})
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({
 "first_status":first["status"],"question_count":len(first["clarifications"]),
 "revision_stable":first["revision"]==p.normalize_dashboard_plan(base,first["objective"],period,{})["revision"],
 "confirmed_status":confirmed["status"],"revision_changed":confirmed["revision"]!=first["revision"],
 "context":confirmed["organization_context_revision"].startswith("context-") and confirmed["organization_context"]["objective"]==first["objective"],"panel_ids":[item["id"] for item in confirmed["panels"]],
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
    context: true,
    panel_ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    frozen_prompt: '2021年1月の定義済み指標1を区分別に出して',
    errors: [
      '分析計画のパネルは1〜20件にしてください。',
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
print(json.dumps({"fixed_context":"demo-org-ec-v1" in request,"metrics":"指標定義" in request,"new_specs":"分析仕様そのものを新規" in request,"fixed_ids":any(panel_id in request for panel_id in ["R4","R11","R12","R9","R16","R17"]),"count":[panels["minItems"],panels["maxItems"]],"questions":"確認を1〜3件" in request,"sankey_limit":f"最大{p.MAX_SANKEY_PAGES}ページ" in request and f"上位{p.MAX_SANKEY_PATHS}経路" in request},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    fixed_context: false,
    metrics: true,
    new_specs: true,
    fixed_ids: false,
    count: [6, 6],
    questions: true,
    sankey_limit: true,
  });
});

test('program constraints allow every renderer without exposing a chart catalog in prompts', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
shapes={
 "kpi_group":([], ["指標A","指標B"]),
 "grouped_bar":(["区分"], ["指標A","指標B"]),
 "stacked_bar":(["区分"], ["指標A","指標B"]),
 "multi_line":(["日付"], ["指標A","指標B"]),
 "scatter":(["項目"], ["指標A","指標B"]),
 "bubble":(["項目"], ["指標A","指標B","指標C"]),
 "funnel":(["段階"], ["指標A"]),
 "heatmap":(["区分A","区分B"], ["指標A"]),
}
accepted=[]
for chart,(dimensions,measures) in shapes.items():
 prompt="2021年1月の"+"・".join(dimensions+measures)+"を比較する"
 item={"title":chart,"objective":"判断する","dimensions":dimensions,"measures":measures,"comparison":"比較","chart":chart,"execution_prompt":prompt,"reason":"判断に必要"}
 accepted.append(p.confirm_analysis_specification(item)["chart"])
request=p.dashboard_planning_request("目的",{"label":"2021年1月"},"指標定義",{})
dashboard_variants=p.DYNAMIC_PLAN_SCHEMA["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]
schema_charts=[variant["properties"]["chart"]["enum"][0] for variant in dashboard_variants]
consultation=p.consultation_request("目的",[],"指標定義","ga4")
consultation_variants=p._consultation_schema()["properties"]["recommendations"]["items"]["properties"]["visualization"]["anyOf"]
consultation_charts=[variant["properties"]["chart"]["enum"][0] for variant in consultation_variants]
seeded_orders=[]
for index in range(8):
 variants=p._dashboard_response_schema({},seed=f"依頼{index}")["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]
 seeded_orders.append([variant["properties"]["chart"]["enum"][0] for variant in variants])
bar=next(variant for variant in dashboard_variants if variant["properties"]["chart"]["enum"]==["bar"])
bar_shape={name:[bar["properties"][name]["minItems"],bar["properties"][name]["maxItems"]] for name in ["dimensions","measures"]}
catalog_markers=[f"- {chart}:" for chart in p.DASHBOARD_CHARTS]
layout_heuristics=["同時に読む組み合わせ","重要度","表示密度","chart typeだけから幅"]
print(json.dumps({"accepted":accepted,"charts":list(p.DASHBOARD_CHARTS),"schema_charts":schema_charts,"consultation_charts":consultation_charts,"bar_shape":bar_shape,"seeded_complete":all(set(order)==set(p.DASHBOARD_CHARTS) for order in seeded_orders),"seeded_variety":len({tuple(order) for order in seeded_orders})>1,"seeded_stable":seeded_orders[0]==[variant["properties"]["chart"]["enum"][0] for variant in p._dashboard_response_schema({},seed="依頼0")["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]],"dashboard_prompt_has_catalog":any(marker in request for marker in catalog_markers),"consultation_prompt_has_catalog":any(marker in consultation for marker in catalog_markers),"has_prompt_capability_constant":hasattr(p,"CHART_CAPABILITY_PROMPT"),"no_intent_pattern":"比較、構成比、時系列、偏り、フロー" not in request,"no_layout_heuristics":all(value not in request for value in layout_heuristics)},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.accepted, [
    'kpi_group',
    'grouped_bar',
    'stacked_bar',
    'multi_line',
    'scatter',
    'bubble',
    'funnel',
    'heatmap',
  ]);
  assert.equal(output.charts.length, 18);
  assert.deepEqual(output.schema_charts, output.charts);
  assert.deepEqual(output.consultation_charts, output.charts);
  assert.deepEqual(output.bar_shape, {
    dimensions: [1, 1],
    measures: [1, 1],
  });
  assert.equal(output.seeded_complete, true);
  assert.equal(output.seeded_variety, true);
  assert.equal(output.seeded_stable, true);
  assert.equal(output.dashboard_prompt_has_catalog, false);
  assert.equal(output.consultation_prompt_has_catalog, false);
  assert.equal(output.has_prompt_capability_constant, false);
  assert.equal(output.no_intent_pattern, true);
  assert.equal(output.no_layout_heuristics, true);
});

test('dashboard plans reject chart shapes that cannot be rendered before build', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
period={"from":"20210101","to":"20210131","label":"2021年1月"}
def raw(dimensions,measures):return {
 "objective_summary":"成果を確認する","audience":"責任者","comparison":"月内比較",
 "hypotheses":["成果に差がある"],"clarifications":[],"panels":[{
  "title":"購入成果","kpi":"購入成果","chart":"scorecard","decision":"規模を判断する",
  "reason":"成果確認に必要","execution_prompt":"2021年1月の購入金額と購入件数を集計する",
  "dimensions":dimensions,"measures":measures,"layout_row":1,"layout_weight":1,
 }]}
answers={"audience":"責任者","comparison":"月内比較","business_goal":"成果改善"}
errors=[]
for dimensions,measures in [(["デバイス"],["購入金額"]),([], ["購入金額","購入件数"])]:
 try:p.normalize_dashboard_plan(raw(dimensions,measures),"ダッシュボードを作って",period,answers)
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'scorecardは区分軸なし・指標1件にしてください。 現在案は保持しています。',
    'scorecardは区分軸なし・指標1件にしてください。 現在案は保持しています。',
  ]);
});

test('invalid Sankey output explains expected counts and returns an AI-authored correction', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
raw={
 "objective_summary":"サイト回遊を改善する","audience":"責任者","comparison":"経路間比較",
 "hypotheses":["主要経路に偏りがある"],"clarifications":[],"panels":[{
  "title":"3ページ回遊","kpi":"セッション数","chart":"sankey","decision":"導線を改善する",
  "reason":"流量を比較するため",
  "execution_prompt":"2021年1月の1ページ目・2ページ目・3ページ目ごとのセッション数を集計する",
  "dimensions":["1ページ目","2ページ目","3ページ目"],"measures":["セッション数"],"layout_row":1,"layout_weight":1
 }]}
answers={"audience":"責任者","comparison":"経路間比較","business_goal":"回遊改善"}
try:p.normalize_dashboard_plan(raw,"3ページのサイト回遊も作成して",{"from":"20210101","to":"20210131","label":"2021年1月"},answers)
except p.PlannerError as error:
 print(json.dumps({"message":str(error),"suggestion":error.suggested_instruction},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.message, /必要なのは区分軸2件・指標1件/);
  assert.match(output.message, /AI出力は区分軸3件・指標1件/);
  assert.match(output.message, /現在案は保持/);
  assert.match(output.suggestion, /2021年1月/);
  assert.match(output.suggestion, /上位10件/);
  assert.match(output.suggestion, /遷移元・遷移先の隣接edge/);
  assert.match(output.suggestion, /区分軸2件とセッション数1指標/);
});

test('add-only dashboard revisions preserve accepted panels and append a requested Sankey', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
vertex_usage=types.ModuleType("vertex_usage");vertex_usage.token_counts=lambda _usage:{"input_tokens":1,"output_tokens":1};sys.modules["vertex_usage"]=vertex_usage
period={"from":"20210101","to":"20210131","label":"2021年1月"}
def panel(index):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分{index}別に集計する","dimensions":[f"区分{index}"],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
header={"objective_summary":"成果を判断する","audience":"責任者","comparison":"区分比較","hypotheses":["差がある"],"clarifications":[]}
answers={"audience":"責任者","comparison":"区分比較","business_goal":"成果改善"}
current=p.normalize_dashboard_plan({**header,"panels":[panel(i) for i in range(1,7)]},"ダッシュボードを作って",period,answers)
sankey={"title":"サイト内3ページ回遊","kpi":"セッション数","chart":"sankey","decision":"主要な3ページ回遊を判断する","reason":"ページ間の流量を確認するため","execution_prompt":"2021年1月の遷移元ページから遷移先ページまで3ページのセッション数を多い順に集計する","dimensions":["遷移元ページ","遷移先ページ"],"measures":["セッション数"],"layout_row":4,"layout_weight":1}
addition={**header,"panels":[panel(i) for i in range(1,7)]+[sankey]}
observed_schema={}
class Models:
 def generate_content(self,**kwargs):
  observed_schema.update(kwargs["config"].response_schema["properties"]["clarifications"])
  return types.SimpleNamespace(text=json.dumps(addition,ensure_ascii=False),usage_metadata=object())
plan,_usage=p.propose_dashboard(types.SimpleNamespace(models=Models()),"test-model",current["objective"],period,"指標定義",answers,current_plan=current,instruction="サイト回遊3ページのサンキーダイアグラムも描いて")
panel_schema=p._dashboard_response_schema(answers,revising=True)["properties"]["panels"]
print(json.dumps({"count":len(plan["panels"]),"titles":[item["title"] for item in plan["panels"]],"last_chart":plan["panels"][-1]["chart"],"clarification_zero_bound":observed_schema.get("maxItems")==0,"panel_bounds":[panel_schema.get("minItems"),panel_schema.get("maxItems")]},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    count: 7,
    titles: ['分析1', '分析2', '分析3', '分析4', '分析5', '分析6', 'サイト内3ページ回遊'],
    last_chart: 'sankey',
    clarification_zero_bound: false,
    panel_bounds: [null, null],
  });
});

test('Sankey permits one page attribute in source and target roles without weakening other charts', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
period={"from":"20210101","to":"20210131","label":"2021年1月"}
def raw(chart):return {
 "objective_summary":"サイト内行動を判断する","audience":"責任者","comparison":"回遊比較",
 "hypotheses":["回遊経路に偏りがある"],"clarifications":[],"panels":[{
  "title":"3ページ回遊","kpi":"セッション数","chart":chart,"decision":"主要経路を判断する",
  "reason":"回遊を確認するため","execution_prompt":"2021年1月のページからページへの3段階のセッション数を集計する",
  "dimensions":["ページ","ページ"],"measures":["セッション数"],"layout_row":1,"layout_weight":1,
 }]}
answers={"audience":"責任者","comparison":"回遊比較","business_goal":"エンゲージメント改善"}
accepted=p.normalize_dashboard_plan(raw("sankey"),"2021年1月のサイト内行動を分析する",period,answers)
try:p.normalize_dashboard_plan(raw("heatmap"),"2021年1月のサイト内行動を分析する",period,answers)
except p.PlannerError as error:other_error=str(error)
print(json.dumps({"dimensions":accepted["panels"][0]["dimensions"],"other_error":other_error},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dimensions: ['ページ', 'ページ'],
    other_error: '分析計画の区分軸に重複があります。',
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
print(json.dumps({"initial":p.INITIAL_PANEL_COUNT,"maximum":p.MAX_PANEL_COUNT,"initial_schema":[initial["minItems"],initial["maxItems"]],"revision_schema":[revision.get("minItems"),revision.get("maxItems")]},ensure_ascii=False))`,
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
    revision_schema: [null, null],
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

test('planner has no fixed organization context or keyword-based revision mode', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
request=p.dashboard_planning_request("目的",{"label":"2021年1月"},"指標定義",{},current_plan={"objective_summary":"目的","audience":"責任者","comparison":"月内","hypotheses":[],"panels":[]},instruction="既存仕様を維持し、流入別も必要です")
print(json.dumps({"fixed_context":hasattr(p,"ORGANIZATION_CONTEXT") or "demo-org-ec-v1" in request,"revision_heuristic":hasattr(p,"_is_add_only_instruction"),"returns_complete":"変更後の分析仕様をpanelsへすべて返す" in request},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    fixed_context: false,
    revision_heuristic: false,
    returns_complete: true,
  });
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
def panel(index):return {"title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分別に出して","dimensions":["区分"],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
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
print(json.dumps({"current_specs":all(value in request for value in ["現在の分析仕様","分析1","2021年1月の指標1を区分別に出して"]),"instruction":"流入別パネルを追加" in request,"operations":all(value in request for value in ["追加・変更・削除相談","変更後の分析仕様をpanelsへすべて返す","1〜20件"]),"fixed_ids":any(panel_id in request for panel_id in ["R4","R11","R12","R9","R16","R17"]),"mixed_allowed":len(mixed["panels"])==6,"errors":errors},ensure_ascii=False))`,
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
    { cwd: ROOT, encoding: 'utf8' },
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
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: 2,
    first: { input_tokens: 10, output_tokens: 12 },
    without_thoughts: { input_tokens: 10, output_tokens: 5 },
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
    { cwd: ROOT, encoding: 'utf8' },
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
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [1, 1],
    [3, 3],
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER = path.join(ROOT, 'spikes/report-generation/analysis_planner.py');
const PYTHON_ENV = { ...process.env, PYTHONPATH: path.dirname(PLANNER) };

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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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

test('planner prompt validates comparisons against the source contract', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
request=p.dashboard_planning_request("目的",{"label":"2021年1月"},"指標定義",{})
print(json.dumps({"comparison_rule":"比較や派生指標が意思決定に有用なら候補として提案してよい" in request,"source_contract":"データソースから確認できる" in request,"clarifications":"clarificationsで確認する" in request},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    comparison_rule: true,
    source_contract: true,
    clarifications: true,
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
 "percent_stacked_bar":(["区分"], ["指標A","指標B"]),
 "multi_line":(["日付"], ["指標A","指標B"]),
 "percent_stacked_area":(["日付"], ["指標A","指標B"]),
 "scatter":(["項目"], ["指標A","指標B"]),
 "bubble":(["項目"], ["指標A","指標B","指標C"]),
 "funnel":(["段階"], ["指標A"]),
 "funnel_horizontal":(["段階"], ["指標A"]),
 "heatmap":(["区分A","区分B"], ["指標A"]),
 "sankey_vertical":(["遷移元","遷移先"], ["指標A"]),
 "flow_sankey":(["遷移元","遷移先"], ["指標A"]),
 "flow_sankey_vertical":(["遷移元","遷移先"], ["指標A"]),
}
accepted=[]
for chart,(dimensions,measures) in shapes.items():
 prompt="2021年1月の"+"・".join(dimensions+measures)+"を比較する"
 item={"title":chart,"objective":"判断する","dimensions":dimensions,"measures":measures,"comparison":"比較","chart":chart,"execution_prompt":prompt,"reason":"判断に必要"}
 accepted.append(p.confirm_analysis_specification(item)["chart"])
request=p.dashboard_planning_request("目的",{"label":"2021年1月"},"指標定義",{})
dashboard_variants=p.DYNAMIC_PLAN_SCHEMA["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]
schema_charts=[chart for variant in dashboard_variants for chart in variant["properties"]["chart"]["enum"]]
consultation=p.consultation_request("目的",[],"指標定義","ga4")
consultation_variants=p._consultation_schema()["properties"]["recommendations"]["items"]["properties"]["visualization"]["anyOf"]
consultation_charts=[chart for variant in consultation_variants for chart in variant["properties"]["chart"]["enum"]]
seeded_orders=[]
for index in range(8):
 variants=p._dashboard_response_schema({},seed=f"依頼{index}")["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]
 seeded_orders.append([chart for variant in variants for chart in variant["properties"]["chart"]["enum"]])
bar=next(variant for variant in dashboard_variants if "bar" in variant["properties"]["chart"]["enum"])
bar_shape={name:[bar["properties"][name]["minItems"],bar["properties"][name]["maxItems"]] for name in ["dimensions","measures"]}
catalog_markers=[f"- {chart}:" for chart in p.DASHBOARD_CHARTS]
layout_heuristics=["同時に読む組み合わせ","重要度","表示密度","chart typeだけから幅"]
stable_variants=p._dashboard_response_schema({},seed="依頼0")["properties"]["panels"]["items"]["properties"]["visualization"]["anyOf"]
stable_order=[chart for variant in stable_variants for chart in variant["properties"]["chart"]["enum"]]
print(json.dumps({"accepted":accepted,"charts":list(p.DASHBOARD_CHARTS),"schema_charts":schema_charts,"consultation_charts":consultation_charts,"bar_shape":bar_shape,"seeded_complete":all(set(order)==set(p.DASHBOARD_CHARTS) for order in seeded_orders),"seeded_variety":len({tuple(order) for order in seeded_orders})>1,"seeded_stable":seeded_orders[0]==stable_order,"dashboard_prompt_has_catalog":any(marker in request for marker in catalog_markers),"consultation_prompt_has_catalog":any(marker in consultation for marker in catalog_markers),"has_prompt_capability_constant":hasattr(p,"CHART_CAPABILITY_PROMPT"),"no_intent_pattern":"比較、構成比、時系列、偏り、フロー" not in request,"no_layout_heuristics":all(value not in request for value in layout_heuristics)},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.accepted, [
    'kpi_group',
    'grouped_bar',
    'stacked_bar',
    'percent_stacked_bar',
    'multi_line',
    'percent_stacked_area',
    'scatter',
    'bubble',
    'funnel',
    'funnel_horizontal',
    'heatmap',
    'sankey_vertical',
    'flow_sankey',
    'flow_sankey_vertical',
  ]);
  assert.equal(output.charts.length, 42);
  assert.deepEqual(new Set(output.schema_charts), new Set(output.charts));
  assert.deepEqual(new Set(output.consultation_charts), new Set(output.charts));
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'scorecardは区分軸なし・指標1件にしてください。 現在案は保持しています。',
    'scorecardは区分軸なし・指標1件にしてください。 現在案は保持しています。',
  ]);
});

test('structured dimensions remain authoritative when execution prose uses natural language', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
raw={
 "objective_summary":"ページごとの購入成果を判断する","audience":"責任者","comparison":"ページ間比較",
 "hypotheses":["閲覧ページによって購入成果に差がある"],"clarifications":[],"panels":[{
  "title":"閲覧ページ別の購入成果","kpi":"購入件数","chart":"bar","decision":"改善対象ページを判断する",
  "reason":"閲覧ページごとの差を確認するため",
  "execution_prompt":"2021年1月のURLごとの購入成果を比較する",
  "dimensions":["ページ"],"measures":["購入件数"],"layout_row":1,"layout_weight":1
 }]}
answers={"audience":"責任者","comparison":"ページ間比較","business_goal":"購入成果改善"}
plan=p.normalize_dashboard_plan(raw,"2021年1月のページ別購入成果を分析する",{"from":"20210101","to":"20210131","label":"2021年1月"},answers)
panel=plan["panels"][0]
print(json.dumps({"dimensions":panel["dimensions"],"measures":panel["measures"],"prompt":panel["execution_prompt"]},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dimensions: ['ページ'],
    measures: ['購入件数'],
    prompt: '2021年1月のURLごとの購入成果を比較する',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER_DIR = path.join(ROOT, 'spikes/report-generation');

function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(PLANNER_DIR)})\nimport analysis_planner as p\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('renderer capabilities are represented by one chart and shape contract', () => {
  const result = python(`
schema=p._visualization_response_schema(p.SUPPORTED_DASHBOARD_CHARTS,seed="依頼A")
print(json.dumps({
 "charts":schema["properties"]["chart"]["enum"],
 "contracts":p.CHART_SHAPE_CONTRACTS,
 "row_limits":p.DASHBOARD_ROW_LIMITS,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(
    new Set(output.charts),
    new Set(output.row_limits ? Object.keys(output.row_limits) : []),
  );
  assert.deepEqual(output.contracts.scorecard, [0, 0, 1, 1]);
  assert.deepEqual(output.contracts.grouped_bar, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.area, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.stacked_area, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.percent_stacked_bar, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.percent_stacked_area, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.histogram, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.donut, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.calendar_heatmap, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.scatter, [1, 2, 2, 2]);
  assert.deepEqual(output.contracts.bubble, [1, 2, 3, 3]);
  assert.deepEqual(output.contracts.funnel_horizontal, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.heatmap, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.pivot_table, [2, 2, 1, 4]);
  assert.deepEqual(output.contracts.comparison_table, [1, 4, 3, 3]);
  assert.deepEqual(output.contracts.sparkline_table, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.sankey, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.sankey_vertical, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.flow_sankey, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.flow_sankey_vertical, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.annotated_line, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.sparkline, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.mixed_bar_line, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.delta, [0, 0, 2, 2]);
  assert.deepEqual(output.contracts.box_plot, [1, 1, 5, 5]);
  assert.deepEqual(output.contracts.box_plot_horizontal, [1, 1, 5, 5]);
  assert.deepEqual(output.contracts.treemap, [1, 4, 1, 1]);
  assert.deepEqual(output.contracts.pie, [1, 1, 1, 1]);
  assert.deepEqual(output.contracts.area_map, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.us_map, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.point_map, [2, 2, 3, 3]);
  assert.deepEqual(output.contracts.bubble_map, [2, 2, 4, 4]);
  assert.deepEqual(output.contracts.base_map, [3, 3, 4, 4]);
  assert.deepEqual(output.contracts.reference_line, [1, 1, 2, 2]);
  assert.deepEqual(output.contracts.reference_area, [1, 1, 3, 3]);
});

test('chart order is deterministic per request and unrelated to declaration order', () => {
  const result = python(`
charts=p.SUPPORTED_DASHBOARD_CHARTS
first=p._neutral_chart_order(charts,"依頼A")
second=p._neutral_chart_order(tuple(reversed(charts)),"依頼A")
other=p._neutral_chart_order(charts,"依頼B")
print(json.dumps({"same":first==second,"different":first!=other,"complete":set(first)==set(charts)}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    same: true,
    different: true,
    complete: true,
  });
});

test('comparison table accepts one governed source measure and rejects unrelated measures before build', () => {
  const result = python(`
period={"from":"20210101","to":"20210131","label":"2021年1月"}
metrics=("購入件数","購入金額","エンゲージメント時間")
def raw(measures):
 return {
  "objective_summary":"デバイス別の成果を比較する","audience":"責任者","comparison":"月内比較",
  "hypotheses":["デバイス別に差がある"],"clarifications":[],
  "panels":[{
   "title":"デバイスカテゴリ別 成果・エンゲージメント比較","kpi":"購入成果",
   "chart":"comparison_table","decision":"優先デバイスを判断する","reason":"差を確認するため",
   "execution_prompt":"2021年1月のデバイス別購入件数を月前半と月後半で比較する",
   "dimensions":["デバイス"],"measures":measures,"layout_row":1,"layout_weight":100
  }]
 }
observed={}
for label,measures in {
 "single":["購入件数"],
 "unrelated":["購入件数","購入金額","エンゲージメント時間"],
}.items():
 try:
  p.normalize_dashboard_plan(raw(measures),"購入成果を改善する",period,{"audience":"責任者"},allowed_metrics=metrics)
 except p.PlannerError as error:
  observed[label]=str(error)
 else:
  observed[label]="accepted"
print(json.dumps(observed,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.single, 'accepted');
  assert.match(output.unrelated, /comparison_tableは定義済み指標1件/);
});

test('defined metrics are validated after generation without expanding every chart schema', () => {
  const result = python(`
import sys,types
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
vertex_usage=types.ModuleType("vertex_usage")
vertex_usage.token_counts=lambda _usage:{"input_tokens":1,"output_tokens":1}
sys.modules["vertex_usage"]=vertex_usage
metrics='''指標定義:
- 指標「セッション数」 = COUNT(*)
- 指標「ユーザー数」 = COUNT(DISTINCT user_pseudo_id)
- 指標「閲覧数」 = COUNTIF(event_name = "page_view")
- 指標「商品閲覧数」 = COUNTIF(event_name = "view_item")
- 指標「カート追加数」 = COUNTIF(event_name = "add_to_cart")
- 指標「購入件数」 = COUNTIF(event_name = "purchase")
- 指標「購入金額」 = SUM(ecommerce.purchase_revenue)
- 軸「日付」 = event_date'''
names=p._defined_metric_names(metrics)
raw={
 "objective_summary":"目的を確認する","audience":"責任者","comparison":"月内比較",
 "hypotheses":["指標を比較する"],
 "clarifications":[{"field":"audience","question":"主な読者は誰ですか","recommended_answer":"責任者"}],
 "panels":[{
  "title":"未定義指標","kpi":"目標達成度","chart":"scorecard",
  "decision":"目標達成度を判断する","reason":"判断に必要",
  "execution_prompt":"2021年1月の目標達成度を集計する",
  "dimensions":[],"measures":["目標達成度"],"layout_row":1,"layout_weight":100
 }]
}
valid={**raw,"panels":[{
 "title":"定義済み指標","kpi":"セッション数","chart":"scorecard",
 "decision":"セッション数を判断する","reason":"判断に必要",
 "execution_prompt":"2021年1月のセッション数を集計する",
 "dimensions":[],"measures":["セッション数"],"layout_row":1,"layout_weight":100
}]}
captured={}
class Models:
 def __init__(self):self.responses=[raw,valid]
 def generate_content(self,**kwargs):
  captured["schema"]=kwargs["config"].response_schema
  return types.SimpleNamespace(text=json.dumps(self.responses.pop(0),ensure_ascii=False),usage_metadata=object())
client=types.SimpleNamespace(models=Models())
error=""
suggestion=""
try:
 p.propose_dashboard(client,"test-model","2021年1月のダッシュボードを作る",{"from":"20210101","to":"20210131","label":"2021年1月"},metrics,{})
except Exception as caught:
 error=f"{type(caught).__name__}: {caught}"
 suggestion=getattr(caught,"suggested_instruction","")
accepted,_usage=p.propose_dashboard(client,"test-model","2021年1月のダッシュボードを作る",{"from":"20210101","to":"20210131","label":"2021年1月"},metrics,{})
schema=captured["schema"]
visualization=schema["properties"]["panels"]["items"]["properties"]["visualization"]
measure_enum=visualization["properties"]["measures"]["items"].get("enum")
schema_json=json.dumps(schema,ensure_ascii=False,separators=(",",":"))
description=schema["properties"]["panels"]["description"]
description_metrics=description.removeprefix("measuresは次の定義済み指標名だけを使う: ").split("、")
print(json.dumps({"schema_bytes":len(schema_json.encode()),"names":names,"description_metrics":description_metrics,"measure_enum":measure_enum,"error":error,"suggestion":suggestion,"accepted":accepted["panels"][0]["measures"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.schema_bytes < 8000, output.schema_bytes);
  assert.deepEqual(new Set(output.description_metrics), new Set(output.names));
  assert.equal(output.description_metrics.length, output.names.length);
  assert.equal(output.measure_enum, null);
  assert.match(output.error, /指標定義にない指標.*目標達成度/);
  assert.match(output.suggestion, /セッション数/);
  assert.match(output.suggestion, /購入金額/);
  assert.match(output.suggestion, /だけを使って再提案/);
  assert.deepEqual(output.accepted, ['セッション数']);
});

test('answered clarification schema avoids the provider-invalid zero item bound', () => {
  const result = python(`
schema=p._response_schema({"audience":"A","comparison":"B","business_goal":"C"})
clarifications=schema["properties"]["clarifications"]
print(json.dumps({"has_max":"maxItems" in clarifications,"has_min":"minItems" in clarifications}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { has_max: false, has_min: false });
});

test('dashboard response schema keeps every chart without nested anyOf complexity', () => {
  const result = python(`
question="2021年1月のECサイトで購入成果を改善するダッシュボードを作って"
schema=p._dashboard_response_schema({},seed=question)
visualization=schema["properties"]["panels"]["items"]["properties"]["visualization"]
encoded=json.dumps(schema,ensure_ascii=False,separators=(",",":"))
print(json.dumps({
 "has_any_of":"anyOf" in visualization,
 "charts":visualization["properties"]["chart"]["enum"],
 "supported":p.SUPPORTED_DASHBOARD_CHARTS,
 "description":visualization["description"],
 "schema_bytes":len(encoded.encode()),
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.has_any_of, false);
  assert.deepEqual(new Set(output.charts), new Set(output.supported));
  assert.match(output.description, /scorecard=dimensions 0、measures 1/);
  assert.match(output.description, /grouped_bar=dimensions 1、measures 2〜4/);
  assert.ok(output.schema_bytes < 5000, output.schema_bytes);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER = path.join(ROOT, 'spikes/report-generation/analysis_planner.py');
const PYTHON_ENV = { ...process.env, PYTHONPATH: path.dirname(PLANNER) };

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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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
        ...PYTHON_ENV,
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
        ...PYTHON_ENV,
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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
    { cwd: ROOT, encoding: 'utf8', env: PYTHON_ENV },
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

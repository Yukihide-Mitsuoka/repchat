import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { LIVE, ROOT, python } from './live-demo-test-helpers.ts';

test('dashboard UI separates consultation from confirmed paid build', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "copy":all(value in html for value in ["AIと分析計画を相談","仕様を確定するまでBigQueryは実行しません","この仕様を確定してbuild"]),
 "review":all(value in html for value in ['id="plan-review"','id="plan-clarifications"','id="plan-panels"','id="plan-revision"']),
 "flow":all(value in html for value in ['/api/plan','answers:currentAnswers','analysis_plan:pendingPlan','selected.size<1']),
 "iterative":all(value in html for value in ['id="plan-revision-instruction"','analysis_plan:pendingPlanBase','revision_instruction:pendingPlanInstruction','追加・変更・削除']),
 "memory":all(value in html for value in ["organization_context_revision","ローカルデモfixture・本番メモリー未接続"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    copy: true,
    review: true,
    flow: true,
    iterative: true,
    memory: true,
  });
});

test('dashboard UI reflects configurable panel-count policy', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})
import live_demo as m
print(json.dumps({"initial":m.planner.INITIAL_PANEL_COUNT,"maximum":m.planner.MAX_PANEL_COUNT,"copy":"初回は原則5件" in m.HTML and "最大15件" in m.HTML,"guard":"selected.size>15" in m.HTML,"placeholders":"__INITIAL_PANEL_COUNT__" in m.HTML or "__MAX_PANEL_COUNT__" in m.HTML},ensure_ascii=False))`,
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
    copy: true,
    guard: true,
    placeholders: false,
  });
});

test('an AI-authored dashboard supports twenty panels without hardcoded topics', () => {
  const result = python(`
def panel(index):return {"id":f"P{index}","title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の定義済み指標{index}を1行で出して","dimensions":[],"measures":[f"定義済み指標{index}"],"layout_row":(index+3)//4,"layout_weight":((index-1)%4)+1}
question="2021年1月の購入課題を分析するダッシュボードを作って"
plan={"period":m.period_for_question(question),"panels":[panel(index) for index in range(1,21)]}
period,sections=m.dashboard_sections_for_plan(question,plan)
layout=m.dashboard_layout_rows_for_plan(plan["panels"])
print(json.dumps({"limit":m.MAX_PLAN_BODY_BYTES,"sections":len(sections),"rows":len(layout),"all_weighted":all(len(row["panel_ids"])==4 and sum(row["shares"])==100 for row in layout)},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    limit: 98304,
    sections: 20,
    rows: 5,
    all_weighted: true,
  });
});

test('analysis workspace uses one conversation and an artifact tree', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "shell":all(value in html for value in ['class="app-shell"','id="workspace-sidebar"','id="workspace-main"','id="panel-inspector"']),
 "adjustable":all(value in html for value in ['id="sidebar-toggle"','aria-label="ナビゲーションを折りたたむ"','id="navigation-resizer"','aria-label="ナビゲーションの幅を変更"','id="inspector-toggle"','aria-label="詳細パネルを折りたたむ"','id="inspector-resizer"','aria-label="詳細パネルの幅を変更"']),
 "views":all(value in html for value in ['id="artifact-dashboard-view"','id="build-studio-view"','id="meeting-report-view"','id="graph-workspace"']),
 "navigation":all(value in html for value in ['id="view-dashboard"','id="view-build"','id="view-report"','id="view-graph"']),
 "conversation":all(value in html for value in ['id="analysis-composer"','id="composer-input"','data-composer-action="consult"','data-composer-action="dashboard"','data-composer-action="insight"','data-composer-action="report"']),
 "artifact_tree":all(value in html for value in ['aria-label="分析成果物"','購入成果改善ダッシュボード','未保存のインサイト','aria-label="分析スレッド"','購入成果を改善する','現在の対話']),
 "inspector":all(value in html for value in ['id="inspector-empty"','id="inspector-content"','id="inspector-tab-reason"','id="inspector-tab-sql"','id="inspector-tab-data"','id="inspector-tab-provenance"']),
 "artifact_preview":all(value in html for value in ['id="artifact-preview"','id="artifact-preview-host"','単一グラフのインサイト']),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    shell: true,
    adjustable: true,
    views: true,
    navigation: true,
    conversation: true,
    artifact_tree: true,
    inspector: true,
    artifact_preview: true,
  });
});

test('broad analysis requests use paid, stateful AI consultation before paid execution', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.match(rendered.stdout, /id="analysis-consultation"/);
  assert.match(rendered.stdout, /id="consultation-thread"/);
  assert.match(rendered.stdout, /id="consultation-recommendations"/);
  assert.match(rendered.stdout, /相談ではVertex AIを使用し、BigQueryは実行しません/);
  assert.ok(!script.includes('function isConsultationPrompt(question)'));
  assert.ok(script.includes('function beginAnalysisConsultation(question,profile)'));
  assert.ok(script.includes('async function runAnalysisConsultation()'));
  assert.ok(script.includes('consultationHistory'));
  assert.ok(script.includes('consultationHistory.slice(-8)'));
  assert.ok(script.includes('stream("/api/consult"'));
  assert.ok(script.includes('function selectAnalysisRecommendation(recommendation)'));
  assert.ok(script.includes('if(action==="consult"){beginAnalysisConsultation'));
  assert.ok(script.includes('selectWorkspace("consult");setComposerAction("consult",false)'));
  assert.ok(script.includes('setComposerAction("insight",false)'));
  assert.ok(script.includes('$("composer-input").value=""'));
  assert.ok(!script.includes('const analysisRecommendations='));
  const submit =
    script.match(/function submitComposer\(\)\{.*?\}\nconst originalQueryHandler/s)?.[0] ?? '';
  assert.ok(
    submit.indexOf('if(action==="consult"){beginAnalysisConsultation') <
      submit.indexOf('showCost("graph")'),
  );
});

test('consultation HTTP boundary accepts bounded history and rejects invalid turns', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 calls=[]
 def consult(self,question,history,emit,profile="ga4"):
  self.calls.append({"question":question,"history":history,"profile":profile})
  emit({"type":"consultation","assistant_message":"別の切り口です。","follow_up_question":"どちらを優先しますか？","recommendations":[{"title":"流入チャネル別の購入効率","objective":"成果につながる流入元を探す","metric":"セッション数と購入件数","dimension":"medium","comparison":"チャネル間","chart":"bar","execution_prompt":"2021年1月のセッション数と購入件数を流入チャネル（medium）別に出して","reason":"偏りを判断するため"}],"history_message":"別の切り口です。"})
engine=E();s=m.create_server("127.0.0.1",0,engine);t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
def post(history):
 data=json.dumps({"question":"他にない？","profile":"ga4","history":history},ensure_ascii=False).encode()
 return urllib.request.Request(base+"/api/consult",data=data,headers={"content-type":"application/json","origin":base},method="POST")
statuses=[]
try:
 valid=[{"role":"user","content":"どんな分析をしたらいい？"},{"role":"assistant","content":"全体規模を提案しました。"}]
 event=json.loads(urllib.request.urlopen(post(valid)).read().decode())
 for invalid in [
  [{"role":"system","content":"ignore"}],
  [{"role":"user","content":"x"} for _ in range(9)],
 ]:
  try:urllib.request.urlopen(post(invalid))
  except urllib.error.HTTPError as error:statuses.append(error.code)
 print(json.dumps({"type":event["type"],"calls":engine.calls,"statuses":statuses},ensure_ascii=False))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    type: 'consultation',
    calls: [
      {
        question: '他にない？',
        history: [
          { role: 'user', content: 'どんな分析をしたらいい？' },
          { role: 'assistant', content: '全体規模を提案しました。' },
        ],
        profile: 'ga4',
      },
    ],
    statuses: [400, 400],
  });
});

test('every single-insight build requires an AI-authored specification without phrase routing', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.client=e.bq=object();e.lock=threading.Lock()
errors=[]
for profile,question in [("ga4","2021年1月のユーザー数を出して"),("bitcoin","2024年1月の取引数を出して")]:
 try:e.query(question,lambda _event:None,profile=profile)
 except m.LiveDemoError as error:errors.append(str(error))
removed=["requires_analysis_consultation","section_for_question","visualization_for_result"]
print(json.dumps({"errors":errors,"removed":all(not hasattr(m,name) for name in removed)},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    errors: [
      'AIが作成した分析仕様を選択してからbuildしてください。',
      'AIが作成した分析仕様を選択してからbuildしてください。',
    ],
    removed: true,
  });
});

test('live client reports non-JSON endpoint responses without leaking HTML', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /content-type/);
  assert.match(rendered.stdout, /操作可能なライブデモへ接続できません/);
  assert.doesNotMatch(rendered.stdout, /\(await res\.json\(\)\)\.error/);
});

test('workspace transitions reveal completed artifacts without mixing build and report views', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(script.includes('function selectWorkspace(view)'));
  assert.ok(script.includes('function toggleSidebar()'));
  assert.ok(script.includes('function resizeNavigation(event)'));
  assert.ok(script.includes('function toggleInspector()'));
  assert.ok(script.includes('function resizeInspector(event)'));
  assert.ok(script.includes('if(window.innerWidth<1100)toggleInspector()'));
  assert.ok(script.includes('selectWorkspace("dashboard")'));
  assert.ok(script.includes('selectWorkspace("report")'));
  assert.ok(script.includes('$("open-build-studio").onclick=()=>selectWorkspace("build")'));
  assert.ok(script.includes('openPanelInspector(panel.id)'));
  assert.ok(script.includes('selectInspectorTab("sql")'));
});

test('artifact pane can expand to three quarters while preserving the main workspace', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const context = vm.createContext({});
  vm.runInContext(
    `${script.match(/const INSPECTOR_MIN_WIDTH=.*?function inspectorMaximumWidth\(viewportWidth,navigationWidth\)\{.*?\}/s)?.[0]}
result={closed:inspectorMaximumWidth(1440,0),open:inspectorMaximumWidth(1440,221),narrow:inspectorMaximumWidth(900,0)}`,
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    closed: 1079,
    open: 858,
    narrow: 539,
  });
  assert.ok(script.includes('setInspectorWidth(currentInspectorWidth())'));
  assert.ok(script.includes('inspectorResizer.setAttribute("aria-valuemax"'));
  assert.doesNotMatch(script, /Math\.min\(560,window\.innerWidth-event\.clientX\)/);
  assert.match(
    rendered.stdout,
    /\.workspace-inspector \.table-scroll th,\.workspace-inspector \.table-scroll td\{padding:6px 8px;font-size:12px;line-height:1\.35/,
  );
});

test('collapsed workspace panes keep the explicit five-column desktop grid', () => {
  const result = python(`
html=m.HTML
desktop=html.split('.app-shell{--nav-width:220px',1)[1].split('@media',1)[0]
grid='grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr) var(--inspector-grip) var(--inspector-column)'
print(json.dumps({
 "sidebar":grid in desktop.split('.app-shell.sidebar-collapsed{',1)[1].split('}',1)[0],
 "inspector":grid in desktop.split('.app-shell.inspector-collapsed{',1)[1].split('}',1)[0],
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { sidebar: true, inspector: true });
});

test('dashboard and single-graph progress both expose active and completed states', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "dashboard_steps":all(value in html for value in ['id="dashboard-step-plan"','id="dashboard-step-review"','id="dashboard-step-build"']),
 "dashboard_styles":all(value in html for value in [".plan-item.active",".plan-item.done"]),
 "dashboard_transitions":all(value in html for value in ['dashboardStage("plan")','dashboardStage("review")','dashboardStage("build")','dashboardStage("complete")']),
 "graph_transitions":all(value in html for value in ["function stage(name)",".stages .active",".stages .done"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dashboard_steps: true,
    dashboard_styles: true,
    dashboard_transitions: true,
    graph_transitions: true,
  });
});

test('single and dashboard SQL areas provide an accessible clipboard action', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "single":all(value in html for value in ['class="sql-shell"','id="sql-copy"','aria-label="SQLをコピー"']),
 "dashboard":all(value in html for value in ['id="inspector-sql-copy"','configureCopyButton($("inspector-sql-copy"),$("inspector-sql"))']),
 "clipboard":all(value in html for value in ["navigator.clipboard.writeText(target.textContent)","SQLをコピーしました","SQLのコピーに失敗しました"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    single: true,
    dashboard: true,
    clipboard: true,
  });
});

test('chart values use bounded Japanese number formatting without changing raw tables', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const start = script.indexOf('function chartValue(');
  const end = script.indexOf('function renderSql(');
  assert.ok(start >= 0 && end > start, 'chartValue must be defined before renderSql');
  const values = vm.runInNewContext(
    `${script.slice(start, end)};[
      chartValue(118380.0,"sessions",true),
      chartValue(895.0,"purchases"),
      chartValue(57350.1256,"revenue"),
      chartValue(14.5659,"repeat_user_rate"),
      chartValue(49.509999,"average_engagement"),
      chartValue("organic","medium"),
    ]`,
  );
  assert.deepEqual([...values], ['118,380', '895', '57,350.13', '14.57', '49.51', 'organic']);
  assert.ok(script.includes('textContent:chartValue(r.rows[0][0],r.columns[0],true)'));
  assert.ok(script.includes('value.textContent=chartValue(r.rows[0][index],column,true)'));
  assert.ok(script.includes('textContent=chartValue(value,columns[1])'));
  assert.ok(
    script.includes('replaceChildren(table(result.columns,result.rows))'),
    'the audit table must retain raw query values',
  );
});

test('dashboard UI accepts recommended clarification answers without forced re-proposal', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "accepted_copy":all(value in html for value in ["推奨回答を採用済み（編集可）","変更依頼を添えてAIへ再提案できます"]),
 "captures_defaults":"currentAnswers[item.field]=input.value.trim()" in html,
 "syncs_edits":"input.oninput=syncClarificationAnswers" in html,
 "build_collects":'collectAnswers();pendingPlan=selectedPlan();showCost("dashboard-build")' in html,
 "preserves_specs":'plan.panels=plan.panels.filter(panel=>selected.has(panel.id));' in html and "map(panel=>({id:panel.id,reason:panel.reason}))" not in html,
 "not_length_blocked":"plan.clarifications.length>0" not in html,
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    accepted_copy: true,
    captures_defaults: true,
    syncs_edits: true,
    build_collects: true,
    preserves_specs: true,
    not_length_blocked: true,
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { python } from './live-demo-test-helpers.ts';

test('meeting report owns persistent processing and error state across workspace navigation', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(rendered.stdout.includes('id="report-status"'));
  assert.ok(rendered.stdout.includes('id="report-message"'));
  assert.ok(rendered.stdout.includes('id="report-warning"'));
  assert.ok(script.includes('let reportWorkspaceState="報告案なし"'));
  assert.ok(script.includes('view==="report"?reportWorkspaceState:copy[view][2]'));
  assert.ok(script.includes('setReportState("エラー",e.message,"notice error")'));
  assert.ok(script.includes('setReportState("要承認"'));
  assert.ok(
    script.includes('setReportState("報告案なし","新しいbuild完了後に会議報告案を生成できます。")'),
  );
  const reportRequest = script.slice(script.lastIndexOf('async function runMeetingReport()'));
  assert.doesNotMatch(reportRequest, /\$\("dashboard-message"\)/);
});

test('meeting report click gives immediate feedback and surfaces missing revision or dialog failure', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const start = script.indexOf('function requestMeetingReport(');
  const end = script.indexOf('configureCopyButton($("sql-copy")');
  assert.ok(start >= 0 && end > start, 'meeting report request handler must be explicit');
  const source = script.slice(start, end);
  assert.ok(source.includes('費用確認待ち'));
  assert.ok(source.includes('会議報告案を生成できるbuild結果がありません。'));
  assert.ok(source.includes('費用確認ダイアログを開けませんでした。'));
  assert.ok(script.includes('$("report-submit").onclick=requestMeetingReport'));

  function invoke(revision: string | null, showCost: () => void) {
    const elements = {
      'report-message': { className: '', textContent: '' },
      'report-status': { textContent: '' },
    };
    vm.runInNewContext(
      `let latestBuildRevision=${JSON.stringify(revision)};
       const $=id=>elements[id];
       const setReportState=(status,message,className="notice")=>{
         elements["report-status"].textContent=status;
         elements["report-message"].className=className;
         elements["report-message"].textContent=message;
       };
       const selectWorkspace=()=>{};
       ${source}
       requestMeetingReport();`,
      { elements, showCost },
    );
    return elements;
  }

  const missing = invoke(null, () => assert.fail('must not open the cost dialog'));
  assert.equal(missing['report-status'].textContent, 'エラー');
  assert.equal(
    missing['report-message'].textContent,
    '会議報告案を生成できるbuild結果がありません。',
  );

  let requestedMode = '';
  const waiting = invoke('build-1', (mode?: string) => {
    requestedMode = mode ?? '';
  });
  assert.equal(requestedMode, 'report');
  assert.equal(waiting['report-status'].textContent, '費用確認待ち');

  const failed = invoke('build-1', () => {
    throw new Error('dialog unavailable');
  });
  assert.equal(failed['report-status'].textContent, 'エラー');
  assert.equal(failed['report-message'].textContent, '費用確認ダイアログを開けませんでした。');
});

test('confirmed dashboard freezes provenance and meeting report reuses it without BigQuery', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.metric_definitions=json.loads((m.HERE/"metrics.json").read_text())
e.client=e.bq=object();e.lock=threading.Lock();e.latest_dashboard=None
panels=[
 {"title":"購入規模","kpi":"購入成果","chart":"table","decision":"購入成果の規模を判断する","reason":"全体規模が必要","execution_prompt":"2021年1月の購入件数と購入金額を集計する","dimensions":[],"measures":["購入件数","購入金額"],"layout_row":1,"layout_weight":1},
 {"title":"購入ファネル","kpi":"購入導線","chart":"table","decision":"購入までの減少箇所を判断する","reason":"導線診断が必要","execution_prompt":"2021年1月の閲覧とカートと購入を集計する","dimensions":[],"measures":["閲覧","カート","購入"],"layout_row":1,"layout_weight":1},
 {"title":"日別推移","kpi":"セッション数","chart":"line","decision":"月内変動を判断する","reason":"変動確認が必要","execution_prompt":"2021年1月の日付別セッション数を集計する","dimensions":["日付"],"measures":["セッション数"],"layout_row":2,"layout_weight":1},
 {"title":"主要回遊","kpi":"回遊数","chart":"sankey","decision":"主要な遷移を判断する","reason":"回遊確認が必要","execution_prompt":"2021年1月のsourceからtargetへのsessionsを集計する","dimensions":["source","target"],"measures":["sessions"],"layout_row":2,"layout_weight":1},
]
plan={"objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"購入成果の課題を判断する","audience":"月次会議","comparison":"月内推移","period":m.period_for_question("2021年1月"),"hypotheses":["導線に課題がある"],"clarifications":[],"answers":{"audience":"月次会議"},"panels":panels}
rows={"P1":[[895,123456.0]],"P2":[[100,50,20]],"P3":[["2021-01-31",118380]],"P4":[["1. 入口: /","2. /shop",5]]}
columns={"P1":["購入件数","購入金額"],"P2":["閲覧","カート","購入"],"P3":["日付","セッション数"],"P4":["source","target","sessions"]}
def run_section(section,period,emit,context=None,profile="ga4"):
 emit({"type":"sql","sql":"SELECT value FROM source","sql_sha256":"1"*16,**context})
 emit({"type":"result","columns":columns[section["id"]],"rows":rows[section["id"]],"verification":"matched","verification_label":"照合済み","visualization":"funnel" if section["id"]=="P2" else section["component"],**context})
 return .1
e._run_section=run_section;events=[];e.dashboard(plan["objective"],events.append,plan);bundle=e.latest_dashboard
raw={"executive_summary":{"text":"追加診断が必要です。","panel_ids":["P1"]},"observations":[{"text":"購入件数は895件です。","panel_ids":["P1"]}],"interpretations":[{"text":"変動があります。","uncertainty":"施策履歴がありません。","panel_ids":["P3"]}],"hypotheses":[{"text":"導線に課題がある可能性があります。","validation":"流入別に検証します。","panel_ids":["P2"]}],"actions":[{"text":"導線を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に比較します。","success_metric":"購入件数","panel_ids":["P1"]}],"limitations":["目標値と施策履歴が未登録です。"]}
calls=[]
m.meeting.generate=lambda _client,_model,current:(calls.append(current["build_revision"]) or (m.meeting.normalize_report(raw,current),{"input_tokens":10,"output_tokens":5}))
report_events=[];e.meeting_report(bundle["build_revision"],report_events.append)
error=""
try:e.meeting_report("build-000000000000",lambda _event:None)
except m.LiveDemoError as caught:error=str(caught)
funnel=next(panel for panel in bundle["panels"] if panel["id"]=="P2")
print(json.dumps({"dashboard_complete":events[-1]["build_revision"],"build":bundle["build_revision"],"plan":bundle["analysis_specification"]["revision"],"organization":bundle["organization_context"]["objective_summary"],"metric":"購入件数" in bundle["metric_definitions"]["metrics"],"result_revision":bundle["panels"][0]["result_revision"],"sql":bundle["panels"][0]["sql_sha256"],"funnel_rate":funnel["derived_metrics"][0]["value"],"report_types":[event["type"] for event in report_events],"report_revision":report_events[-1]["report"]["report_revision"],"citation":report_events[-1]["report"]["observations"][0]["evidence_refs"][0],"calls":calls,"error":error},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dashboard_complete, output.build);
  assert.match(output.build, /^build-[0-9a-f]{12}$/);
  assert.match(output.plan, /^plan-[0-9a-f]{12}$/);
  assert.equal(output.organization, '購入成果の課題を判断する');
  assert.equal(output.metric, true);
  assert.match(output.result_revision, /^result-[0-9a-f]{12}$/);
  assert.equal(output.sql, '1111111111111111');
  assert.equal(output.funnel_rate, 50);
  assert.deepEqual(output.report_types, ['report_stage', 'meeting_report']);
  assert.match(output.report_revision, /^report-[0-9a-f]{12}$/);
  assert.equal(output.citation.result_revision, output.result_revision);
  assert.deepEqual(output.calls, [output.build]);
  assert.equal(output.error, '指定したbuild revisionの根拠bundleがありません。');
});

test('meeting report UI is explicit about cost, evidence, approval, and prototype limits', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "action":all(value in html for value in ["この結果から会議報告案を生成","/api/report","latestBuildRevision"]),
 "cost":all(value in html for value in ["BigQueryは再実行しません","BigQuery ¥0（保存済み集計bundleだけを参照）","今回の報告案 最大約¥25","根拠bundle 48 KiB・出力8,192 tokens上限・思考tokensを含む"]),
 "evidence":all(value in html for value in ["result_revision","sql_sha256","期待効果"]),
 "summary_citation":'$("report-summary").replaceChildren(citedItem(report.executive_summary))' in html,
 "approval":all(value in html for value in ["AIが作成した未承認案","外部共有前に人間が根拠と表現を確認"]),
 "safe":"innerHTML" not in html,
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    action: true,
    cost: true,
    evidence: true,
    summary_citation: true,
    approval: true,
    safe: true,
  });
});

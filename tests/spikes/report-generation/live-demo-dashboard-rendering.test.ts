import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { python } from './live-demo-test-helpers.ts';

test('stopped dashboard panels explain why SQL and data do not exist', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /SQL生成前に停止したため、SQLはありません。/);
  assert.match(rendered.stdout, /SQLを実行していないため、取得データはありません。/);
  assert.match(rendered.stdout, /panel\.sqlStatus/);
  assert.match(rendered.stdout, /panel\.dataStatus/);
});

test('single-graph progress shows the dynamic stop reason before stage details', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  const progressStart = html.indexOf('aria-labelledby="progress-title"');
  const progressEnd = html.indexOf('</section>', progressStart);
  const progress = html.slice(progressStart, progressEnd);
  assert.ok(progress.indexOf('id="message"') < progress.indexOf('<ol class="stages">'));
  assert.doesNotMatch(progress, /質問を送信すると、ここに処理状況が表示されます。/);
  assert.match(html, /未定義のため停止:/);
  assert.match(html, /指標の計算定義または対象条件（URL・イベント・ページ一覧など）を具体的に指定/);
  assert.match(html, /id="clarification-panel"/);
  assert.match(html, /id="clarification-question"/);
  assert.match(html, /id="clarification-submit"/);
  assert.match(html, /clarification_answer/);
  assert.match(html, /回答にない条件は推測しない/);
});

test('dashboard-specific KPI, funnel, and trend panels render from fixed results', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    style: Record<string, string> = {};
    textContent = '';
    className = '';
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const context = {
    document: {
      createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
      createElement: (tag: string) => new ElementStub(tag),
      createTextNode: (value: string) =>
        Object.assign(new ElementStub('#text'), { textContent: value }),
    },
    $: () => chart,
  };
  const cases = [
    {
      visualization: 'kpi_pair',
      columns: ['購入件数', '売上'],
      rows: [[895, 57350]],
      expectedTag: 'div',
    },
    {
      visualization: 'funnel',
      columns: ['閲覧', 'カート', '購入'],
      rows: [[23105, 4537, 1115]],
      expectedTag: 'div',
    },
    {
      visualization: 'area',
      columns: ['日付', '購入件数'],
      rows: [
        ['2021-01-01', 10],
        ['2021-01-02', 14],
      ],
      expectedTag: 'svg',
    },
    {
      visualization: 'stacked_area',
      columns: ['日付', '新規', 'リピート'],
      rows: [
        ['2021-01-01', 10, 4],
        ['2021-01-02', 12, 7],
      ],
      expectedTag: 'svg',
    },
    {
      visualization: 'histogram',
      columns: ['階級下限', '度数'],
      rows: [
        [0, 3],
        [10, 5],
      ],
      expectedTag: 'svg',
    },
    {
      visualization: 'donut',
      columns: ['デバイス', 'セッション数'],
      rows: [
        ['desktop', 70],
        ['mobile', 30],
      ],
      expectedTag: 'svg',
    },
    {
      visualization: 'calendar_heatmap',
      columns: ['日付', '購入件数'],
      rows: [
        ['2021-01-01', 10],
        ['2021-01-02', 3],
        ['2021-01-03', 12],
      ],
      expectedTag: 'svg',
    },
    {
      visualization: 'trend',
      columns: ['日付', 'セッション', '7日移動平均'],
      rows: [
        ['2021-01-01', 100, 90],
        ['2021-01-02', 120, 95],
      ],
      expectedTag: 'svg',
    },
  ];
  for (const result of cases) {
    assert.doesNotThrow(() =>
      vm.runInNewContext(`${functions}\ngraph(result);`, { ...context, result }),
    );
    assert.equal(chart.children[0]?.tag, result.expectedTag);
  }
  const polylines = chart.children[0]?.children.filter((child) => child.tag === 'polyline') ?? [];
  assert.equal(polylines.length, 2, 'trend should contain daily and moving-average series');
});

test('dashboard result-shape validation fails closed before rendering', () => {
  const result = python(`
errors=[]
for section,rows,columns in [
 ({"title":"購入KPI","planned_visualization":"scorecard"},[("invalid",)],["only_one"]),
 ({"title":"ファネル","planned_visualization":"funnel"},[("1. 閲覧",-1)],["stage","metric_value"]),
 ({"title":"回遊","planned_visualization":"sankey"},[("1. /","2. /shop","many")],["source","target","metric_value"]),
]:
 try:
  m.dashboard_visualization(section,rows,columns)
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '購入KPIの結果形状がAI分析仕様のscorecardと一致しないため描画しません。',
    'ファネルの結果形状がAI分析仕様のfunnelと一致しないため描画しません。',
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
  ]);
});

test('dashboard navigation Sankey rejects repeated pages as consecutive transitions', () => {
  const result = python(`
section={"id":"R17","title":"回遊","planned_visualization":"sankey"}
cases=[
 [("1. /", "1. /", 38913)],
 [("4. /shop", "5. /thanks", 8)],
]
errors=[]
for rows in cases:
 try:
  m.dashboard_visualization(section,rows,["source","target","sessions"])
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
  ]);
});

test('dashboard navigation Sankey requires staged connected aggregated edges', () => {
  const result = python(`
section={"id":"R17","title":"回遊","planned_visualization":"sankey"}
cases=[
 [("1. 入口: /", "3. /cart", 10)],
 [("2. /shop", "4. /done", 5)],
 [("3. /cart", "5. /done", 5)],
]
errors=[]
for rows in cases:
 try:
  m.dashboard_visualization(section,rows,["source","target","sessions"])
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
    '回遊の結果形状がAI分析仕様のsankeyと一致しないため描画しません。',
  ]);
});

test('dashboard navigation Sankey rejects more than ten paths worth of nodes or edges', () => {
  const result = python(`
section={"id":"R17","title":"回遊","planned_visualization":"sankey"}
cases=[
 [(f"1. /start-{index}",f"2. /next-{index}",index+1) for index in range(11)],
 [(f"1. /start-{index}",f"2. /next-{index}",index+1) for index in range(10)]
  +[(f"2. /next-{index}",f"3. /last-{index}",index+1) for index in range(10)]
  +[(f"3. /last-{index}",f"4. /done-{index}",index+1) for index in range(10)]
  +[("1. /extra","2. /extra",1)],
]
accepted=[]
for rows in cases:
 try:
  m.dashboard_visualization(section,rows,["source","target","sessions"])
 except m.LiveDemoError:
  accepted.append(False)
 else:
  accepted.append(True)
print(json.dumps(accepted))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [false, false]);
});

test('live page uses an Evidence-like restrained visual system', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "theme":all(x in html for x in ['data-theme="evidence"','--color-primary:#1f4e79','--color-border:#d9dee7']),
 "structure":all(x in html for x in ['class="app-header"','class="eyebrow"','class="workspace"']),
 "restrained":'box-shadow:0 5px 18px' not in html and 'border-radius:14px' not in html
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    theme: true,
    structure: true,
    restrained: true,
  });
});

test('live dashboard loads the standard chart library and renderer', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /<script src="\/assets\/echarts\.min\.js"><\/script>/);
  assert.match(rendered.stdout, /function renderStandardChart\(/);
  assert.match(rendered.stdout, /instance\.setOption\(standardChartOption\(result\)/);
  assert.match(rendered.stdout, /renderer: 'svg'/);
});

test('area render validation rejects missing values instead of drawing them as zero', () => {
  const result = python(`
from datetime import date
section={"title":"収支推移","planned_visualization":"area"}
try:
 m.dashboard_visualization(section,[(date(2021,1,1),None)],["日付","収支"])
except Exception as error:
 print(json.dumps({"message":str(error)},ensure_ascii=False))
else:
 print(json.dumps({"message":"accepted"},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).message, /結果形状がAI分析仕様のareaと一致しない/);
});

test('an AI-authored table remains a table even when its result could be plotted', () => {
  const result = python(`
section={"title":"流入別の比較表","component":"table","planned_visualization":"table"}
rows=[("organic",120),("cpc",80)]
print(json.dumps({
 "planned":m.dashboard_visualization(section,rows,["medium","sessions"]),
 "automatic":hasattr(m,"visualization_for_result"),
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    planned: 'table',
    automatic: false,
  });
});

test('dashboard rendering rejects a result shape that differs from the AI specification', () => {
  const result = python(`
section={"title":"購入規模","component":"table","planned_visualization":"scorecard"}
try:m.dashboard_visualization(section,[("organic",120)],["medium","sessions"])
except m.LiveDemoError as error:print(str(error))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /結果形状がAI分析仕様のscorecardと一致しない/);
});

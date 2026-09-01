import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { chartRendererSource, LIVE, ROOT, python } from './live-demo-test-helpers.ts';

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

test('series variants normalize percentages, split scatter series, and render each calendar year', () => {
  const source = chartRendererSource();
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      bar: standardChartOption({visualization:'percent_stacked_bar',columns:['device','new','repeat'],rows:[['mobile',3,1]]}),
      area: standardChartOption({visualization:'percent_stacked_area',columns:['date','new','repeat'],rows:[['2021-01-01',3,1]]}),
      scatter: standardChartOption({visualization:'scatter',columns:['page','series','x','y'],rows:[['/','mobile',1,2],['/shop','desktop',3,4]]}),
      calendar: standardChartOption({visualization:'calendar_heatmap',columns:['date','value'],rows:[['2020-12-31',1],['2021-01-01',2]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.bar.series[0].stack, 'percent');
  assert.equal(parsed.bar.xAxis[0].max, 100);
  assert.equal(parsed.area.series[0].stack, 'percent');
  assert.equal(parsed.area.yAxis[0].max, 100);
  assert.deepEqual(
    parsed.scatter.series.map((series: any) => series.name),
    ['mobile', 'desktop'],
  );
  assert.equal(parsed.calendar.calendar.length, 2);
  assert.equal(parsed.calendar.series.length, 2);
});

test('multi-series scatter and bubble use a second dimension in every execution guard', () => {
  const result = python(`
cases={
 "scatter":(["ページ","デバイス"],["閲覧数","滞在時間"],[('A','mobile',1,2)]),
 "bubble":(["チャネル","デバイス"],["閲覧数","滞在時間","ユーザー数"],[('A','desktop',1,2,3)]),
}
accepted={}
for chart,(dimensions,measures,rows) in cases.items():
 section=m.planned_analysis_section({"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析","dimensions":dimensions,"measures":measures})
 schema=[(name,"STRING" if index < 2 else "INT64") for index,name in enumerate(section["source_columns"])]
 m.validate_dashboard_dry_run_schema(section,schema)
 accepted[chart]={"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,rows,section["source_columns"])}
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scatter: { columns: ['category', 'series', 'x_value', 'y_value'], rendered: 'scatter' },
    bubble: {
      columns: ['category', 'series', 'x_value', 'y_value', 'size_value'],
      rendered: 'bubble',
    },
  });
});

test('funnel and Sankey orientation variants keep distinct guarded render contracts', () => {
  const result = python(`
cases={
 "funnel_horizontal":([("1. 閲覧",10)],["stage","metric_value"]),
 "sankey_vertical":([("1. /","2. /shop",10)],["source","target","metric_value"]),
 "flow_sankey":([("広告","商品",10),("商品","購入",3)],["source","target","metric_value"]),
 "flow_sankey_vertical":([("広告","商品",10),("商品","購入",3)],["source","target","metric_value"]),
}
accepted={}
for chart,(rows,columns) in cases.items():
 section={"title":chart,"planned_visualization":chart}
 accepted[chart]=m.dashboard_visualization(section,rows,columns)
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    funnel_horizontal: 'funnel_horizontal',
    sankey_vertical: 'sankey_vertical',
    flow_sankey: 'flow_sankey',
    flow_sankey_vertical: 'flow_sankey_vertical',
  });

  const source = chartRendererSource();
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      funnel: standardChartOption({visualization:'funnel_horizontal',columns:['stage','value'],rows:[['1. view',10]]}),
      staged: standardChartOption({visualization:'sankey_vertical',columns:['source','target','value'],rows:[['1. /','2. /shop',10]]}),
      flow: standardChartOption({visualization:'flow_sankey',columns:['source','target','value'],rows:[['広告','商品',10]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.funnel.series[0].orient, 'horizontal');
  assert.equal(parsed.staged.series[0].orient, 'vertical');
  assert.equal(parsed.flow.series[0].orient, 'horizontal');
  assert.equal(parsed.flow.series[0].data[0].name, '広告');
  const heights = vm.runInNewContext(
    `${source};JSON.stringify(['sankey','sankey_vertical','flow_sankey','flow_sankey_vertical'].map(visualization=>standardChartHeight({visualization,columns:['source','target','value'],rows:[['A','B',1]]})))`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  assert.deepEqual(JSON.parse(heights), [440, 440, 440, 440]);
});

test('general Sankey rejects cycles, duplicate edges, and self links', () => {
  const result = python(`
cases=[
 [("A","B",1),("B","A",1)],
 [("A","B",1),("A","B",2)],
 [("A","A",1)],
]
accepted=[]
for rows in cases:
 try:m.dashboard_visualization({"title":"flow","planned_visualization":"flow_sankey"},rows,["source","target","metric_value"])
 except m.LiveDemoError:accepted.append(False)
 else:accepted.append(True)
print(json.dumps(accepted))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [false, false, false]);
});

test('annotations, sparkline, mixed type, and delta keep guarded data contracts', () => {
  const result = python(`
from datetime import date
cases={
 "annotated_line":({"dimensions":["日付","注釈"],"measures":["購入件数"]},[(date(2021,1,1),"施策開始",10)]),
 "sparkline":({"dimensions":["日付"],"measures":["購入件数"]},[(date(2021,1,1),10)]),
 "mixed_bar_line":({"dimensions":["日付"],"measures":["購入金額","購入件数"]},[(date(2021,1,1),1000,10)]),
 "delta":({"dimensions":[],"measures":["当月購入件数","前月購入件数"]},[(10,8)]),
}
accepted={}
for chart,(shape,rows) in cases.items():
 panel={"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析",**shape}
 section=m.planned_analysis_section(panel)
 types=[]
 for column in section["source_columns"]:
  types.append((column,"DATE" if column=="event_date" else "STRING" if column in {"annotation_label","category"} else "INT64"))
 m.validate_dashboard_dry_run_schema(section,types)
 accepted[chart]={"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,rows,section["source_columns"])}
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    annotated_line: {
      columns: ['event_date', 'annotation_label', 'metric_value'],
      rendered: 'annotated_line',
    },
    sparkline: { columns: ['event_date', 'metric_value'], rendered: 'sparkline' },
    mixed_bar_line: { columns: ['category', 'metric_1', 'metric_2'], rendered: 'mixed_bar_line' },
    delta: { columns: ['current_value', 'comparison_value'], rendered: 'delta' },
  });
});

test('annotations, sparkline, mixed type, and delta render distinct ECharts options', () => {
  const source = chartRendererSource();
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      annotated: standardChartOption({visualization:'annotated_line',columns:['date','annotation','value'],rows:[['2021-01-01','施策開始',10],['2021-01-02','',12]]}),
      sparkline: standardChartOption({visualization:'sparkline',columns:['date','value'],rows:[['2021-01-01',10],['2021-01-02',12]]}),
      mixed: standardChartOption({visualization:'mixed_bar_line',columns:['date','sales','orders'],rows:[['2021-01-01',1000,10]]}),
      delta: standardChartOption({visualization:'delta',columns:['current','previous'],rows:[[10,8]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.annotated.series[0].markPoint.data[0].name, '施策開始');
  assert.equal(parsed.sparkline.xAxis.show, false);
  assert.deepEqual(
    parsed.mixed.series.map((series: any) => series.type),
    ['bar', 'line'],
  );
  assert.equal(parsed.delta.graphic[2].style.text, '+2');
});

test('box plot, treemap, and pie keep guarded data contracts', () => {
  const result = python(`
cases={
 "box_plot":({"dimensions":["デバイス"],"measures":["最小","第1四分位","中央値","第3四分位","最大"]},[("mobile",1,2,3,4,5)]),
 "box_plot_horizontal":({"dimensions":["デバイス"],"measures":["最小","第1四分位","中央値","第3四分位","最大"]},[("mobile",1,2,3,4,5)]),
 "treemap":({"dimensions":["部門","商品"],"measures":["売上"]},[("衣料","帽子",10)]),
 "pie":({"dimensions":["チャネル"],"measures":["売上"]},[("organic",10)]),
}
accepted={}
for chart,(shape,rows) in cases.items():
 panel={"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析",**shape}
 section=m.planned_analysis_section(panel)
 dimension_count=len(shape["dimensions"])
 schema=[(name,"STRING" if index < dimension_count else "INT64") for index,name in enumerate(section["source_columns"])]
 m.validate_dashboard_dry_run_schema(section,schema)
 accepted[chart]={"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,rows,section["source_columns"])}
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    box_plot: {
      columns: ['category', 'min_value', 'q1_value', 'median_value', 'q3_value', 'max_value'],
      rendered: 'box_plot',
    },
    box_plot_horizontal: {
      columns: ['category', 'min_value', 'q1_value', 'median_value', 'q3_value', 'max_value'],
      rendered: 'box_plot_horizontal',
    },
    treemap: { columns: ['level_1', 'level_2', 'metric_value'], rendered: 'treemap' },
    pie: { columns: ['category', 'metric_value'], rendered: 'pie' },
  });
});

test('box plot, treemap, and pie create standard ECharts options', () => {
  const source = chartRendererSource();
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      box: standardChartOption({visualization:'box_plot',columns:['device','min','q1','median','q3','max'],rows:[['mobile',1,2,3,4,5]]}),
      horizontal: standardChartOption({visualization:'box_plot_horizontal',columns:['device','min','q1','median','q3','max'],rows:[['mobile',1,2,3,4,5]]}),
      tree: standardChartOption({visualization:'treemap',columns:['department','product','sales'],rows:[['clothes','hat',10],['clothes','shirt',20]]}),
      pie: standardChartOption({visualization:'pie',columns:['channel','sales'],rows:[['organic',10]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.box.series[0].type, 'boxplot');
  assert.equal(parsed.horizontal.xAxis.type, 'value');
  assert.equal(parsed.tree.series[0].data[0].children.length, 2);
  assert.deepEqual(parsed.pie.series[0].radius, ['0%', '72%']);
});

test('box plot rejects unordered five-number summaries', () => {
  const result = python(`
try:m.dashboard_visualization({"title":"box","planned_visualization":"box_plot"},[("mobile",1,4,3,2,5)],["category","min_value","q1_value","median_value","q3_value","max_value"])
except m.LiveDemoError:print("rejected")
else:print("accepted")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'rejected');
});

test('area and US maps require warehouse-provided GeoJSON shapes', () => {
  const result = python(`
shape='{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'
cases={"area_map":("Tokyo",shape,10),"us_map":("CA",shape,20)}
accepted={}
for chart,row in cases.items():
 panel={"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析","dimensions":["地域","地理境界"],"measures":["値"]}
 section=m.planned_analysis_section(panel)
 m.validate_dashboard_dry_run_schema(section,[("region_id","STRING"),("geometry_geojson","STRING"),("metric_value","INT64")])
 accepted[chart]={"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,[row],section["source_columns"])}
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    area_map: { columns: ['region_id', 'geometry_geojson', 'metric_value'], rendered: 'area_map' },
    us_map: { columns: ['region_id', 'geometry_geojson', 'metric_value'], rendered: 'us_map' },
  });
});

test('area maps reject malformed shapes and invalid US region codes', () => {
  const result = python(`
cases=[("area_map",("Tokyo","not-json",10)),("us_map",("California",'{"type":"Polygon","coordinates":[]}',10))]
accepted=[]
for chart,row in cases:
 try:m.dashboard_visualization({"title":chart,"planned_visualization":chart},[row],["region_id","geometry_geojson","metric_value"])
 except m.LiveDemoError:accepted.append(False)
 else:accepted.append(True)
print(json.dumps(accepted))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [false, false]);
});

test('area map renderer builds and registers a data-provided geographic map', () => {
  const source = chartRendererSource();
  const geometry = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      geo: standardMapGeoJson({visualization:'area_map',columns:['region','geometry','value'],rows:[['Tokyo',${JSON.stringify(geometry)},10]]}),
      option: standardChartOption({visualization:'area_map',columns:['region','geometry','value'],rows:[['Tokyo',${JSON.stringify(geometry)},10]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.geo.features[0].properties.name, 'Tokyo');
  assert.equal(parsed.option.series[0].type, 'map');
  assert.equal(parsed.option.series[0].map, parsed.option.geo.map);
  assert.match(source, /registerMap\(standardMapName\(result\), standardMapGeoJson\(result\)\)/);
});

test('point, bubble, and base maps validate geographic layers end to end', () => {
  const result = python(`
geometry='{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"world"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}]}'
cases={
 "point_map":({"dimensions":["地点","地理境界"],"measures":["緯度","経度","値"]},[("A",geometry,35,139,10)]),
 "bubble_map":({"dimensions":["地点","地理境界"],"measures":["緯度","経度","大きさ","値"]},[("A",geometry,35,139,20,10)]),
 "base_map":({"dimensions":["layer","地点","地理境界"],"measures":["緯度","経度","大きさ","値"]},[("area","world",'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',None,None,None,10),("point","A",None,35,139,None,10)]),
}
accepted={}
for chart,(shape,rows) in cases.items():
 panel={"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析",**shape}
 section=m.planned_analysis_section(panel)
 dimension_count=len(shape["dimensions"])
 schema=[(name,"STRING" if index < dimension_count else "FLOAT64") for index,name in enumerate(section["source_columns"])]
 m.validate_dashboard_dry_run_schema(section,schema)
 accepted[chart]=m.dashboard_visualization(section,rows,section["source_columns"])
print(json.dumps(accepted))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    point_map: 'point_map',
    bubble_map: 'bubble_map',
    base_map: 'base_map',
  });
});

test('point and base map renderers use one registered query-provided geography', () => {
  const source = chartRendererSource();
  const geometry = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'world' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
  });
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      point: standardChartOption({visualization:'point_map',columns:['name','geometry','lat','long','value'],rows:[['A',${JSON.stringify(geometry)},35,139,10]]}),
      bubble: standardChartOption({visualization:'bubble_map',columns:['name','geometry','lat','long','size','value'],rows:[['A',${JSON.stringify(geometry)},35,139,20,10]]}),
      base: standardChartOption({visualization:'base_map',columns:['layer','name','geometry','lat','long','size','value'],rows:[['area','world','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',null,null,null,10],['point','A',null,35,139,null,10]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.point.series[0].type, 'scatter');
  assert.equal(parsed.bubble.series[0].type, 'effectScatter');
  assert.deepEqual(
    parsed.base.series.map((series: any) => series.type),
    ['map', 'scatter'],
  );
});

test('reference line and area keep validated result contracts', () => {
  const result = python(`
from datetime import date
cases={
 "reference_line":({"measures":["実績","目標"]},[(date(2021,1,1),10,12)]),
 "reference_area":({"measures":["実績","下限","上限"]},[(date(2021,1,1),10,8,12)]),
}
accepted={}
for chart,(shape,rows) in cases.items():
 panel={"id":"P","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析","dimensions":["日付"],**shape}
 section=m.planned_analysis_section(panel)
 schema=[(name,"DATE" if index == 0 else "INT64") for index,name in enumerate(section["source_columns"])]
 m.validate_dashboard_dry_run_schema(section,schema)
 accepted[chart]={"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,rows,section["source_columns"])}
print(json.dumps(accepted,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    reference_line: {
      columns: ['category', 'metric_value', 'reference_value'],
      rendered: 'reference_line',
    },
    reference_area: {
      columns: ['category', 'metric_value', 'lower_value', 'upper_value'],
      rendered: 'reference_area',
    },
  });
});

test('advanced table filters, stably sorts, exports, and exposes bounded controls', () => {
  const source = chartRendererSource();
  const state = vm.runInNewContext(
    `${source};JSON.stringify({
      filtered: standardTableRows([['東京',10],['大阪',2],['東京支店',10]],'東京',null,1).map(item=>item.row),
      sorted: standardTableRows([['東京',10],['大阪',2],['東京支店',10]],'',1,1).map(item=>item.row),
      numeric: standardTableNumericColumns([['東京',10],['大阪',2]],2),
      csv: standardTableCsv(['地域','値'],[['A"B',10]]),
    })`,
  ) as string;
  assert.deepEqual(JSON.parse(state), {
    filtered: [
      ['東京', 10],
      ['東京支店', 10],
    ],
    sorted: [
      ['大阪', 2],
      ['東京', 10],
      ['東京支店', 10],
    ],
    numeric: [1],
    csv: '"地域","値"\n"A""B","10"',
  });
  for (const expected of [
    'function renderAdvancedResultTable(',
    "placeholder: '表を検索'",
    "textContent: 'CSV'",
    "textContent: '全画面'",
    'const pageSize = 10',
    "cell.setAttribute('aria-sort'",
  ])
    assert.ok(source.includes(expected), `missing advanced table control: ${expected}`);
});

test('pivot table validates long data and preserves missing combinations', () => {
  const validated = python(`
section=m.planned_analysis_section({"id":"P","title":"地域別年次成果","chart":"pivot_table","decision":"判断","execution_prompt":"分析","dimensions":["地域","年"],"measures":["売上","件数"]})
m.validate_dashboard_dry_run_schema(section,[("row_dimension","STRING"),("pivot_dimension","INT64"),("metric_1","FLOAT64"),("metric_2","INT64")])
try:m.dashboard_visualization(section,[("東",2024,10,1),("東",2024,20,2)],section["source_columns"])
except m.LiveDemoError:duplicate="rejected"
else:duplicate="accepted"
print(json.dumps({"columns":section["source_columns"],"rendered":m.dashboard_visualization(section,[("東",2024,10,1),("西",2025,20,2)],section["source_columns"]),"duplicate":duplicate},ensure_ascii=False))
`);
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout), {
    columns: ['row_dimension', 'pivot_dimension', 'metric_1', 'metric_2'],
    rendered: 'pivot_table',
    duplicate: 'rejected',
  });

  const source = chartRendererSource();
  const transformed = vm.runInNewContext(
    `${source};JSON.stringify(standardPivotTableResult({visualization:'pivot_table',columns:['地域','年','売上'],rows:[['東','2024',10],['西','2025',20]]}))`,
  ) as string;
  assert.deepEqual(JSON.parse(transformed), {
    visualization: 'table',
    columns: ['地域', '2024 / 売上', '2025 / 売上'],
    rows: [
      ['東', 10, null],
      ['西', null, 20],
    ],
  });
});

test('comparison table verifies deltas without assigning good or bad semantics', () => {
  const validated = python(`
section=m.planned_analysis_section({"id":"P","title":"前年差","chart":"comparison_table","decision":"判断","execution_prompt":"分析","dimensions":["地域"],"measures":["現在値","比較値","差分"]})
m.validate_dashboard_dry_run_schema(section,[("dimension_1","STRING"),("current_value","FLOAT64"),("comparison_value","FLOAT64"),("delta_value","FLOAT64")])
accepted=m.dashboard_visualization(section,[("東",120,100,20),("西",80,100,-20)],section["source_columns"])
try:m.dashboard_visualization(section,[("東",120,100,10)],section["source_columns"])
except m.LiveDemoError:invalid="rejected"
else:invalid="accepted"
print(json.dumps({"columns":section["source_columns"],"rendered":accepted,"invalid":invalid},ensure_ascii=False))
`);
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout), {
    columns: ['dimension_1', 'current_value', 'comparison_value', 'delta_value'],
    rendered: 'comparison_table',
    invalid: 'rejected',
  });
  const source = chartRendererSource();
  assert.match(source, /deltaIndex: result\.columns\.length - 1/);
  assert.match(source, /advanced-table-delta/);
  assert.doesNotMatch(source, /delta-positive|delta-negative|good|bad/);
});

test('sparkline table validates long time-series data and groups it for ECharts', () => {
  const validated = python(`
from datetime import date
section=m.planned_analysis_section({"id":"P","title":"カテゴリ推移","chart":"sparkline_table","decision":"判断","execution_prompt":"分析","dimensions":["カテゴリ","日付"],"measures":["値"]})
m.validate_dashboard_dry_run_schema(section,[("category","STRING"),("event_date","DATE"),("metric_value","FLOAT64")])
accepted=m.dashboard_visualization(section,[("A",date(2021,1,1),10),("A",date(2021,1,2),None)],section["source_columns"])
try:m.dashboard_visualization(section,[("A",date(2021,1,1),10),("A",date(2021,1,1),20)],section["source_columns"])
except m.LiveDemoError:duplicate="rejected"
else:duplicate="accepted"
print(json.dumps({"columns":section["source_columns"],"rendered":accepted,"duplicate":duplicate},ensure_ascii=False))
`);
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout), {
    columns: ['category', 'event_date', 'metric_value'],
    rendered: 'sparkline_table',
    duplicate: 'rejected',
  });
  const source = chartRendererSource();
  const grouped = vm.runInNewContext(
    `${source};JSON.stringify(standardSparklineTableResult({visualization:'sparkline_table',columns:['区分','日付','値'],rows:[['A','2021-01-02',20],['A','2021-01-01',10],['B','2021-01-01',null]]}).rows.map(row=>({cells:[...row],series:row.sparklineValues})))`,
  ) as string;
  assert.deepEqual(JSON.parse(grouped), [
    {
      cells: ['A', 20, '2点'],
      series: [
        ['2021-01-01', 10],
        ['2021-01-02', 20],
      ],
    },
    { cells: ['B', null, '1点'], series: [['2021-01-01', null]] },
  ]);
  assert.match(source, /chartLibrary\.init\(host, null, \{ renderer: 'svg' \}\)/);
});

test('reference area rejects inverted bounds and renders a bounded band', () => {
  const result = python(`
from datetime import date
try:m.dashboard_visualization({"title":"range","planned_visualization":"reference_area"},[(date(2021,1,1),10,12,8)],["category","metric_value","lower_value","upper_value"])
except m.LiveDemoError:print("rejected")
else:print("accepted")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'rejected');

  const source = chartRendererSource();
  const options = vm.runInNewContext(
    `${source};JSON.stringify({
      line: standardChartOption({visualization:'reference_line',columns:['date','actual','target'],rows:[['2021-01-01',10,12]]}),
      area: standardChartOption({visualization:'reference_area',columns:['date','actual','low','high'],rows:[['2021-01-01',10,8,12]]}),
    })`,
    {
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(parsed.line.series[1].lineStyle.type, 'dashed');
  assert.equal(parsed.area.series[2].stack, 'reference-range');
  assert.deepEqual(parsed.area.series[2].data, [4]);
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

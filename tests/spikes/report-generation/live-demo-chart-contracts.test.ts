import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { chartRendererSource, python } from './live-demo-test-helpers.ts';

test('every supported AI chart becomes an explicit SQL output contract', () => {
  const result = python(`
charts={
 "scorecard":([], ["値"]),"kpi_group":([], ["値1","値2"]),
 "bar":(["区分"],["値"]),"grouped_bar":(["区分"],["値1","値2"]),
 "stacked_bar":(["区分"],["値1","値2"]),"percent_stacked_bar":(["区分"],["値1","値2"]),
 "line":(["日付"],["値"]),
 "area":(["日付"],["値"]),"stacked_area":(["日付"],["値1","値2"]),
 "percent_stacked_area":(["日付"],["値1","値2"]),
 "histogram":(["階級"],["度数"]),"donut":(["区分"],["値"]),
 "calendar_heatmap":(["日付"],["値"]),
 "multi_line":(["日付"],["値1","値2"]),"scatter":(["項目"],["X","Y"]),
 "bubble":(["項目"],["X","Y","大きさ"]),"funnel":(["段階"],["値"]),
 "funnel_horizontal":(["段階"],["値"]),
 "heatmap":(["縦","横"],["値"]),"table":(["区分"],["値"]),
 "sankey":(["遷移元","遷移先"],["流量"]),
 "sankey_vertical":(["遷移元","遷移先"],["流量"]),
 "flow_sankey":(["遷移元","遷移先"],["流量"]),
 "flow_sankey_vertical":(["遷移元","遷移先"],["流量"]),
}
contracts={}
for index,(chart,(dimensions,measures)) in enumerate(charts.items(),1):
 panel={"id":f"P{index}","title":chart,"chart":chart,"decision":"判断","execution_prompt":"2021年1月を分析","dimensions":dimensions,"measures":measures}
 section=m.planned_analysis_section(panel)
 contracts[chart]={"columns":section["source_columns"],"limit":section["max_result_rows"]}
print(json.dumps({"contracts":contracts,"max_pages":m.planned_analysis_section({"id":"S","title":"回遊","chart":"sankey","decision":"判断","execution_prompt":"2021年1月を分析","dimensions":["ページ","ページ"],"measures":["流量"]})["max_navigation_pages"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(Object.keys(output.contracts).length, 24);
  assert.deepEqual(output.contracts.grouped_bar.columns, ['category', 'metric_1', 'metric_2']);
  assert.deepEqual(output.contracts.bubble.columns, [
    'category',
    'x_value',
    'y_value',
    'size_value',
  ]);
  assert.deepEqual(output.contracts.sankey.columns, ['source', 'target', 'metric_value']);
  assert.equal(output.max_pages, 4);
  assert.ok(Object.values(output.contracts).every((contract: any) => contract.limit > 0));
});

test('all current planner capabilities reach an explicit SQL contract and browser renderer', () => {
  const result = python(`
contracts={}
for index,chart in enumerate(m.planner.SUPPORTED_DASHBOARD_CHARTS,1):
 min_dimensions,_,min_measures,_=m.planner.CHART_SHAPE_CONTRACTS[chart]
 panel={"id":f"P{index}","title":chart,"chart":chart,"decision":"判断","execution_prompt":"分析","dimensions":[f"区分{i}" for i in range(min_dimensions)],"measures":[f"指標{i}" for i in range(min_measures)]}
 section=m.planned_analysis_section(panel)
 contracts[chart]={"component":section["component"],"columns":section["source_columns"],"limit":section["max_result_rows"]}
print(json.dumps(contracts,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const contracts = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(Object.keys(contracts).length, 42);
  assert.ok(Object.values(contracts).every((contract) => contract.columns.length > 0));
  assert.ok(Object.values(contracts).every((contract) => contract.limit > 0));

  const renderer = chartRendererSource();
  const specialized = new Set([
    'scorecard',
    'kpi_group',
    'table',
    'pivot_table',
    'comparison_table',
    'sparkline_table',
  ]);
  for (const chart of Object.keys(contracts)) {
    if (specialized.has(chart)) continue;
    assert.ok(
      renderer.includes(`case '${chart}'`) || renderer.includes(`'${chart}'`),
      `missing browser renderer for ${chart}`,
    );
  }
  for (const name of [
    'renderAdvancedResultTable',
    'renderPivotResultTable',
    'renderComparisonResultTable',
    'renderSparklineResultTable',
  ]) {
    assert.ok(renderer.includes(`function ${name}(`), `missing specialized renderer ${name}`);
  }
});

test('all AI chart contracts have explicit result validation and browser renderers', () => {
  const result = python(`
from datetime import date
cases={
 "scorecard":([(1,)], ["値"]),
 "kpi_group":([(1,2)], ["値1","値2"]),
 "bar":([("A",1)], ["区分","値"]),
 "grouped_bar":([("A",1,2)], ["区分","値1","値2"]),
 "stacked_bar":([("A",1,2)], ["区分","値1","値2"]),
 "percent_stacked_bar":([("A",1,2)], ["区分","値1","値2"]),
 "line":([(date(2021,1,1),1),(date(2021,1,2),None)], ["日付","値"]),
 "area":([(date(2021,1,1),1)], ["日付","値"]),
 "stacked_area":([(date(2021,1,1),1,2)], ["日付","値1","値2"]),
 "percent_stacked_area":([(date(2021,1,1),1,2)], ["日付","値1","値2"]),
 "histogram":([(0,3),(10,5)], ["階級下限","度数"]),
 "donut":([("A",3),("B",2)], ["区分","値"]),
 "calendar_heatmap":([(date(2021,1,1),3)], ["日付","値"]),
 "multi_line":([(date(2021,1,1),1,2)], ["日付","値1","値2"]),
 "scatter":([("A",1,2)], ["項目","X","Y"]),
 "bubble":([("A",1,2,3)], ["項目","X","Y","大きさ"]),
 "funnel":([("1. 閲覧",10)], ["段階","値"]),
 "funnel_horizontal":([("1. 閲覧",10)], ["段階","値"]),
 "heatmap":([("月","午前",10)], ["縦","横","値"]),
 "table":([("A",1)], ["区分","値"]),
 "sankey":([("1. /","2. /shop",10),("2. /shop","3. /cart",5),("3. /cart","4. /thanks",2)], ["遷移元","遷移先","流量"]),
 "sankey_vertical":([("1. /","2. /shop",10)], ["遷移元","遷移先","流量"]),
 "flow_sankey":([("広告","商品",10)], ["遷移元","遷移先","流量"]),
 "flow_sankey_vertical":([("広告","商品",10)], ["遷移元","遷移先","流量"]),
}
rendered={}
for chart,(rows,columns) in cases.items():
 section={"title":chart,"planned_visualization":chart}
 rendered[chart]=m.dashboard_visualization(section,rows,columns)
browser=["kpiGroup","barChart","lineChart","areaChart","histogramChart","donutChart","calendarHeatmapChart","scatterChart","funnelChart","heatmapChart","renderResultTable"]
print(json.dumps({"rendered":rendered,"browser":all(("function "+name) in m.HTML for name in browser),"sankey_limit":"const maxPages=4" in m.HTML,"area_negative_scale":"numericValues=values.flat(),min=stacked?0:Math.min(0,...numericValues)" in m.HTML,"area_no_zero_coercion":"Math.max(0,Number(value)||0)" not in m.HTML},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(Object.keys(output.rendered).length, 24);
  assert.equal(output.rendered.scorecard, 'scalar');
  assert.equal(output.rendered.grouped_bar, 'grouped_bar');
  assert.equal(output.rendered.sankey, 'sankey');
  assert.equal(output.browser, true);
  assert.equal(output.sankey_limit, true);
  assert.equal(output.area_negative_scale, true);
  assert.equal(output.area_no_zero_coercion, true);
});

test('standard chart renderer creates ECharts options for every supported chart', () => {
  const source = chartRendererSource();
  const results = {
    bar: { visualization: 'bar', columns: ['channel', 'sessions'], rows: [['organic', 100]] },
    grouped_bar: {
      visualization: 'grouped_bar',
      columns: ['channel', 'sessions', 'revenue'],
      rows: [['organic', 100, 20]],
    },
    stacked_bar: {
      visualization: 'stacked_bar',
      columns: ['device', 'new_sessions', 'repeat_sessions'],
      rows: [['mobile', 100, 20]],
    },
    line: { visualization: 'line', columns: ['date', 'sessions'], rows: [['2021-01-01', 100]] },
    multi_line: {
      visualization: 'multi_line',
      columns: ['date', 'sessions', 'revenue'],
      rows: [['2021-01-01', 100, 20]],
    },
    area: { visualization: 'area', columns: ['date', 'sessions'], rows: [['2021-01-01', 100]] },
    stacked_area: {
      visualization: 'stacked_area',
      columns: ['date', 'new_sessions', 'repeat_sessions'],
      rows: [['2021-01-01', 100, 20]],
    },
    histogram: {
      visualization: 'histogram',
      columns: ['bin_start', 'frequency'],
      rows: [[0, 10]],
    },
    donut: { visualization: 'donut', columns: ['device', 'sessions'], rows: [['mobile', 10]] },
    calendar_heatmap: {
      visualization: 'calendar_heatmap',
      columns: ['date', 'sessions'],
      rows: [['2021-01-01', 10]],
    },
    scatter: {
      visualization: 'scatter',
      columns: ['page', 'pageviews', 'engagement_time'],
      rows: [['/', 10, 2]],
    },
    bubble: {
      visualization: 'bubble',
      columns: ['channel', 'sessions', 'engagement_time', 'users'],
      rows: [['organic', 10, 2, 4]],
    },
    funnel: { visualization: 'funnel', columns: ['stage', 'sessions'], rows: [['1. view', 10]] },
    heatmap: {
      visualization: 'heatmap',
      columns: ['device', 'channel', 'sessions'],
      rows: [['mobile', 'organic', 10]],
    },
    sankey: {
      visualization: 'sankey',
      columns: ['source', 'target', 'sessions'],
      rows: [['1. /', '2. /shop', 10]],
    },
  };
  const options = vm.runInNewContext(
    `${source};JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,result]) => [name,standardChartOption(result)])))`,
    {
      results,
      chartValue: (value: unknown) => String(value ?? '—'),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(options) as Record<string, any>;
  assert.equal(Object.keys(parsed).length, 15);
  assert.equal(parsed.bar.series[0].type, 'bar');
  assert.equal(parsed.bar.series[0].label.show, false);
  assert.equal(parsed.bar.series[0].emphasis.label.show, true);
  assert.equal(parsed.grouped_bar.xAxis[0].type, 'value');
  assert.equal(parsed.grouped_bar.grid.left, 64);
  assert.equal(parsed.grouped_bar.grid.right, 40, '右側の余白を共通設定で確保する');
  assert.equal(parsed.grouped_bar.grid.bottom, 60);
  assert.equal(parsed.scatter.grid.left, 52);
  assert.equal(parsed.scatter.grid.top, 44, '上側の余白を共通設定で確保する');
  assert.equal(parsed.scatter.grid.bottom, 42);
  assert.equal(parsed.multi_line.yAxis.length, 2);
  assert.equal(parsed.multi_line.yAxis[0].name, 'sessions');
  assert.equal(parsed.donut.series[0].type, 'pie');
  assert.equal(parsed.funnel.series[0].sort, 'none');
  assert.equal(parsed.sankey.series[0].type, 'sankey');
  assert.equal(parsed.heatmap.series[0].label.show, true, '疎なヒートマップはセル値を確認できる');
  assert.equal(
    parsed.heatmap.dataZoom,
    undefined,
    '疎なヒートマップには不要なスクロールを付けない',
  );

  const denseHeatmap = vm.runInNewContext(
    `${source};standardChartOption({visualization:'heatmap',columns:['device','page','sessions'],rows:${JSON.stringify(
      Array.from({ length: 100 }, (_, index) => [
        ['desktop', 'mobile', 'tablet'][index % 3],
        `page-${index + 1}`,
        index + 1,
      ]),
    )}})`,
    {
      metricUnit: () => 'セッション',
      metricAxisTitle: (column: string) => column,
    },
  ) as Record<string, any>;
  assert.equal(
    denseHeatmap.series[0].label.show,
    false,
    '密なヒートマップはセル値を常時表示しない',
  );
  assert.equal(denseHeatmap.series[0].emphasis.label.show, true, '選択したセルは値を確認できる');
  assert.equal(denseHeatmap.dataZoom.length, 2, '多数の区分は縦軸スクロールで確認できる');
  assert.equal(denseHeatmap.yAxis.axisLabel.width, 176, '長い区分ラベルを軸内に収める');
  assert.equal(denseHeatmap.yAxis.axisLabel.interval, 0, 'スクロール中の表示区分を省略しない');

  const grouped = vm.runInNewContext(
    `${source};standardChartOption({visualization:'grouped_bar',columns:['channel','new_sessions','repeat_sessions','purchases'],rows:[['organic',100,20,3]]})`,
    {
      metricUnit: (column: string) => (column.includes('sessions') ? 'セッション' : '件'),
      metricAxisTitle: (column: string) => column,
    },
  ) as Record<string, any>;
  assert.equal(grouped.xAxis.length, 2, '同じ単位の系列は共有軸にまとめる');
  assert.equal(JSON.stringify(grouped.series.map((series: any) => series.xAxisIndex)), '[0,0,1]');
  assert.equal(grouped.series[0].label.show, false, '棒ごとの値ラベルは常時表示しない');
  assert.equal(grouped.series[0].emphasis.label.show, true, '選択中の棒は値を確認できる');
  assert.equal(grouped.grid.top, 68, '上側の単位軸に必要な余白だけを確保する');
  assert.equal(grouped.grid.bottom, 60, '下側の単位軸に必要な余白だけを確保する');
  assert.equal(grouped.yAxis.axisLabel.width, 72, '短い区分軸は余白を詰める');

  const dense = vm.runInNewContext(
    `${source};standardChartOption({visualization:'bar',columns:['date','sessions'],rows:${JSON.stringify(
      Array.from({ length: 10 }, (_, index) => [
        `2021-01-${String(index + 1).padStart(2, '0')}`,
        index + 1,
      ]),
    )}})`,
    {
      metricUnit: () => 'セッション',
      metricAxisTitle: (column: string) => column,
    },
  ) as Record<string, any>;
  assert.equal(dense.xAxis.type, 'category', '密な日付区分は横軸に並べる');
  assert.equal(dense.yAxis[0].type, 'value', '密な日付区分は縦棒の値軸を使う');
  assert.equal(dense.xAxis.axisLabel.rotate, 35, '密な日付ラベルは傾けて読みやすくする');
  assert.equal(dense.grid.bottom, 64, '密な日付ラベルのために下側の余白を確保する');

  const compact = vm.runInNewContext(
    `${source};standardChartOption({visualization:'stacked_bar',columns:['channel','sessions','repeat_sessions'],rows:${JSON.stringify(
      Array.from({ length: 10 }, (_, index) => [`channel-${index + 1}`, index + 1, index]),
    )}})`,
    {
      metricUnit: () => 'セッション',
      metricAxisTitle: (column: string) => column,
    },
  ) as Record<string, any>;
  assert.equal(compact.xAxis.type, 'category', '日付以外の密な短い区分も同じ判定を使う');
  assert.equal(compact.yAxis[0].type, 'value');
});

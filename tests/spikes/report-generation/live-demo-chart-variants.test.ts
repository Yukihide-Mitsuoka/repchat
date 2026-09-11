import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { chartRendererSource, python } from './live-demo-test-helpers.ts';

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

test('monthly mixed charts keep exact values while using readable axes and labels', () => {
  const source = chartRendererSource();
  const output = vm.runInNewContext(
    `${source};(() => {
      const result={
        visualization:'mixed_bar_line',
        columns:['block_timestamp_month','SUM(output_value)','SUM(fee)'],
        rows:Array.from({length:12},(_,index)=>[
          '2024-'+String(index+1).padStart(2,'0')+'-01',
          1406794319936480+index*1000000000000,
          155177557302+index*1000000000,
        ]),
      };
      const option=standardChartOption(result);
      return JSON.stringify({
        seriesNames:option.series.map(series=>series.name),
        axisNames:option.yAxis.map(axis=>axis.name),
        axisMinimums:option.yAxis.map(axis=>axis.min),
        outputAxis:option.yAxis[0].axisLabel.formatter(2813588639872960),
        feeAxis:option.yAxis[1].axisLabel.formatter(310355114604),
        monthLabels:[option.xAxis.axisLabel.formatter('2024-01-01',0),option.xAxis.axisLabel.formatter('2024-12-01',11)],
        yearLabel:option.xAxis.name,
        tooltip:option.tooltip.formatter([
          {axisValueLabel:'2024-01-01',seriesName:option.series[0].name,value:2813588639872960},
          {axisValueLabel:'2024-01-01',seriesName:option.series[1].name,value:310355114604},
        ]),
      });
    })()`,
    {
      chartValue: (value: unknown) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(Number(value)),
      metricUnit: () => '',
      metricAxisTitle: (column: string) => column,
    },
  ) as string;
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.seriesNames, ['output value（合計）', 'fee（合計）']);
  assert.deepEqual(parsed.axisNames, ['', '']);
  assert.deepEqual(parsed.axisMinimums, [0, 0]);
  assert.equal(parsed.outputAxis, '2,814兆');
  assert.equal(parsed.feeAxis, '3,104億');
  assert.deepEqual(parsed.monthLabels, ['1月', '12月']);
  assert.equal(parsed.yearLabel, '2024年');
  assert.match(parsed.tooltip, /2,813,588,639,872,960/);
  assert.match(parsed.tooltip, /310,355,114,604/);
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

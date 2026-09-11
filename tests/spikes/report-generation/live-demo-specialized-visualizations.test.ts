import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { chartRendererSource, python } from './live-demo-test-helpers.ts';

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

test('geographic charts reject missing maps, invalid coordinates, negative values, and inconsistent layers', () => {
  const result = python(`
geometry='{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"world"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}]}'
polygon='{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'
columns={
 "area_map":["region_id","geometry_geojson","metric_value"],
 "us_map":["region_id","geometry_geojson","metric_value"],
 "point_map":["point_name","map_geojson","latitude","longitude","metric_value"],
 "bubble_map":["point_name","map_geojson","latitude","longitude","size_value","metric_value"],
 "base_map":["layer_kind","item_name","geometry_geojson","latitude","longitude","size_value","metric_value"],
}
cases={
 "duplicate_region":("area_map",[("Tokyo",polygon,10),("Tokyo",polygon,20)]),
 "invalid_us_region":("us_map",[("California",polygon,10)]),
 "missing_point_map":("point_map",[("A",None,35,139,10)]),
 "invalid_latitude":("point_map",[("A",geometry,91,139,10)]),
 "invalid_longitude":("point_map",[("A",geometry,35,181,10)]),
 "negative_point_value":("point_map",[("A",geometry,35,139,-1)]),
 "negative_bubble_size":("bubble_map",[("A",geometry,35,139,-1,10)]),
 "invalid_layer_kind":("base_map",[("line","A",geometry,35,139,None,10)]),
 "area_with_coordinates":("base_map",[("area","world",polygon,35,None,None,10)]),
 "point_with_size":("base_map",[("point","A",geometry,35,139,1,10)]),
 "bubble_with_negative_size":("base_map",[("bubble","A",geometry,35,139,-1,10)]),
 "base_without_map":("base_map",[("point","A",None,35,139,None,10)]),
}
rejected={}
for name,(chart,rows) in cases.items():
 try:m.dashboard_visualization({"title":chart,"planned_visualization":chart},rows,columns[chart])
 except m.LiveDemoError:rejected[name]=True
 else:rejected[name]=False
print(json.dumps(rejected,sort_keys=True))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    area_with_coordinates: true,
    base_without_map: true,
    bubble_with_negative_size: true,
    duplicate_region: true,
    invalid_latitude: true,
    invalid_layer_kind: true,
    invalid_longitude: true,
    invalid_us_region: true,
    missing_point_map: true,
    negative_bubble_size: true,
    negative_point_value: true,
    point_with_size: true,
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
section=m.planned_analysis_section({"id":"P","title":"前年差","chart":"comparison_table","decision":"判断","execution_prompt":"2024年と2023年の売上を比較する","dimensions":["地域"],"measures":["売上"]})
m.validate_dashboard_dry_run_schema(section,[("dimension_1","STRING"),("current_value","FLOAT64"),("comparison_value","FLOAT64"),("delta_value","FLOAT64")])
accepted=m.dashboard_visualization(section,[("東",120,100,20),("西",80,100,-20)],section["source_columns"])
try:m.dashboard_visualization(section,[("東",120,100,10)],section["source_columns"])
except m.LiveDemoError:invalid="rejected"
else:invalid="accepted"
print(json.dumps({"columns":section["source_columns"],"labels":section["shape"]["columns"],"requirements":section["generation_requirements"],"rendered":accepted,"invalid":invalid},ensure_ascii=False))
`);
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout), {
    columns: ['dimension_1', 'current_value', 'comparison_value', 'delta_value'],
    labels: ['地域', '売上（現在値）', '売上（比較値）', '売上（差分）'],
    requirements: [
      'current_valueとcomparison_valueはexecution_promptに明示された条件で同じ指標「売上」を比較する',
      'delta_valueはcurrent_value - comparison_valueと一致させる',
      'current_value、comparison_value、delta_valueはNULLを返さない。COUNT/COUNTIF以外の式は最終SELECT式全体をCOALESCEまたはIFNULLで包む',
      '最終SELECTはdelta_valueの降順でORDER BYし、LIMIT 100を明示する',
    ],
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { LIVE, ROOT, python } from './live-demo-test-helpers.ts';
const CHART_RENDERER_FILES = [
  'chart_renderer_core.js',
  'chart_renderer_cartesian.js',
  'chart_renderer_indicators.js',
  'chart_renderer_composition.js',
  'chart_renderer_maps.js',
  'chart_renderer_dispatch.js',
  'chart_renderer_tables.js',
];

function chartRendererSource() {
  return CHART_RENDERER_FILES.map((filename) =>
    readFileSync(path.join(ROOT, 'spikes/report-generation', filename), 'utf8'),
  ).join('');
}

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

test('live query derives the requested month and rejects unavailable periods', () => {
  const result = python(`
values={}
for question in ["2020年12月のセッション数を出して", "2021年1月のセッション数を出して"]:
 values[question]=m.period_for_question(question)
errors=[]
for question in ["2021年x月のセッション数を出して", "2021年2月のセッション数を出して"]:
 try:
  m.period_for_question(question)
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps({"values":values,"errors":errors},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    values: {
      '2020年12月のセッション数を出して': {
        from: '20201201',
        to: '20201231',
        label: '2020年12月',
      },
      '2021年1月のセッション数を出して': {
        from: '20210101',
        to: '20210131',
        label: '2021年1月',
      },
    },
    errors: [
      '対象月を「YYYY年M月」の形式で指定してください。',
      '公開サンプルで利用できる期間は2020年11月〜2021年1月です。',
    ],
  });
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

test('editing an AI-authored insight requires a new consultation before execution', () => {
  const result = python(`
question="2021年1月のユーザー数を出して"
spec={"title":"ユーザー数","objective":"規模を確認する","dimensions":[],"measures":["ユーザー数"],"comparison":"単月","chart":"scorecard","execution_prompt":question,"reason":"基準値を判断する"}
try:
 m.analysis_section_for_specification(question+"、デバイス別に",spec,"ga4")
except m.LiveDemoError as error:
 print(json.dumps({"error":str(error),"fixed_reference":"gold_sql" in m.LiveQueryEngine._run_section.__code__.co_consts},ensure_ascii=False))
else:
 raise AssertionError("changed request was accepted")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: '分析依頼がAIの分析仕様から変更されています。変更内容を再度相談してください。',
    fixed_reference: false,
  });
});

test('live query passes the requested period to SQL generation', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine)
e.model=m.report.DEFAULT_MODEL
e.rules=""
e.client=e.bq=object()
e.lock=threading.Lock()
periods=[]
question="2020年12月のセッション数を流入チャネル（medium）別に、多い順で出して"
spec={"title":"流入別セッション","objective":"流入規模を比較する","dimensions":["medium"],"measures":["セッション数"],"comparison":"流入間","chart":"bar","execution_prompt":question,"reason":"集客差を判断する"}
sql="SELECT traffic_source.medium AS category, COUNT(DISTINCT user_pseudo_id) AS metric_value FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' GROUP BY category ORDER BY metric_value DESC LIMIT 30"
m.report.generate=lambda _client,_model,_section,period,_rules:(periods.append(period) or ({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:(([('category','STRING'),('metric_value','INT64')],None))
m.report.exec_bq=lambda *_args,**_kwargs:(([('organic',10)],['category','metric_value']),None)
events=[]
e.query(question,events.append,analysis_specification=spec)
print(json.dumps({"periods":periods,"types":[event["type"] for event in events]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    periods: [{ from: '20201201', to: '20201231', label: '2020年12月' }],
    types: ['stage', 'stage', 'sql', 'stage', 'result'],
  });
});

test('live query rejects generated SQL for a different month before BigQuery', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine)
e.model=m.report.DEFAULT_MODEL
e.rules=""
e.client=e.bq=object()
e.lock=threading.Lock()
question="2020年12月のセッション数を流入チャネル（medium）別に、多い順で出して"
spec={"title":"流入別セッション","objective":"流入規模を比較する","dimensions":["medium"],"measures":["セッション数"],"comparison":"流入間","chart":"bar","execution_prompt":question,"reason":"集客差を判断する"}
sql="SELECT traffic_source.medium AS medium, COUNT(DISTINCT user_pseudo_id) AS sessions FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY medium"
m.report.generate=lambda *_args:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
executions=[]
m.report.exec_bq=lambda *_args,**_kwargs:(executions.append(True) or (([],[]),None))
error=""
try:
 e.query(question,lambda _event:None,analysis_specification=spec)
except m.LiveDemoError as caught:
 error=str(caught)
print(json.dumps({"error":error,"executions":executions},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: '生成SQLの対象期間が問い合わせの2020年12月と一致しません。',
    executions: [],
  });
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

test('live engine renders safe shapes, refuses undefined metrics, and caps fetched rows', () => {
  const result = python(`
import threading
def engine():
 e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
 e.rules="";e.client=e.bq=object();e.lock=threading.Lock();return e
sql="SELECT COUNT(DISTINCT user_pseudo_id) AS metric_value FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate=lambda *_:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
m.report.inspect_bq_schema=lambda *_args,**_kwargs:(([('metric_value','INT64')],None))
limits=[];m.report.exec_bq=lambda *_args,**kw:(limits.append(kw.get("max_results")) or (([(94790,)],["metric_value"]),None))
question="2021年1月のユーザー数を出して"
scorecard={"title":"ユーザー数","objective":"規模を確認する","dimensions":[],"measures":["ユーザー数"],"comparison":"単月","chart":"scorecard","execution_prompt":question,"reason":"基準値を判断する"}
events=[];engine().query(question,events.append,analysis_specification=scorecard)
m.report.generate=lambda *_:({"sql":"","reason":"未定義","undefined_terms":["直帰率"]},{"input_tokens":1,"output_tokens":1})
refusal_question="2021年1月の直帰率を出して"
refusal_spec={**scorecard,"title":"直帰率","measures":["直帰率"],"execution_prompt":refusal_question}
refusal=[];engine().query(refusal_question,refusal.append,analysis_specification=refusal_spec)
print(json.dumps({"visualization":events[-1]["visualization"],"types":[x["type"] for x in events],"refusal":refusal[-1]["undefined_terms"],"limits":limits,"automatic":hasattr(m,"visualization_for_result"),"safe":"innerHTML" not in m.HTML and "renderSql($(\\"sql\\"),e.sql)" in m.HTML}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    visualization: 'scalar',
    types: ['stage', 'stage', 'sql', 'stage', 'result'],
    refusal: ['直帰率'],
    limits: [101],
    automatic: false,
    safe: true,
  });
});
test('non-GA4 selector does not inject a fixed Bitcoin question into the UI', () => {
  const result = python(`
html=m.HTML
profile=m.bitcoin
period=profile.period_for_question("2024年1月のBitcoin取引を分析したい")
errors=[]
for question in ["2023年12月の受取アドレス別の取引数"]:
 try:
  profile.period_for_question(question)
 except ValueError as error:
  errors.append(str(error))
print(json.dumps({
 "selector":all(value in html for value in ['id="dataset-profile"','value="bitcoin"']) and "Bitcoin受取先の複雑度" not in html,
 "cost":all(value in html for value in ["BigQuery 最大20 GiB","生成SQL 1クエリ","合計最大約¥20"]),
 "schema":all(value in profile.SCHEMA_DDL for value in ["outputs ARRAY<STRUCT<","addresses ARRAY<STRING>",profile.TABLE]),
 "rules":all(value in profile.prompt_rules() for value in ["必要な場合だけUNNEST","SELECT * は使わず"]),
 "no_fixed_analysis":all(not hasattr(profile,name) for name in ["EXAMPLE_QUESTION","REFERENCE_SQL","section"]),
 "period":period,
 "errors":errors,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    selector: true,
    cost: true,
    schema: true,
    rules: true,
    no_fixed_analysis: true,
    period: {
      from: '2024-01-01',
      to: '2024-01-31',
      partition: '2024-01-01',
      label: '2024年1月',
    },
    errors: ['Bitcoinデモで検証する期間は2024年1月〜12月です。'],
  });
});

test('Bitcoin query uses its own schema, partition guard, and dataset boundary', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.rules="";e.bitcoin_rules=m.bitcoin.prompt_rules()
e.client=e.bq=object();e.lock=threading.Lock();generated=[];executed=[]
question="2024年1月のBitcoin取引について、受取アドレス数帯別の取引数を比較して"
spec={"title":"受取アドレス数帯別の取引数","objective":"受取構造を比較する","dimensions":["受取アドレス数帯"],"measures":["取引数"],"comparison":"帯別","chart":"bar","execution_prompt":question,"reason":"分布を判断する"}
sql="""WITH per_transaction AS (
SELECT hash, COUNT(DISTINCT address) AS address_count
FROM \`bigquery-public-data.crypto_bitcoin.transactions\`
CROSS JOIN UNNEST(outputs) AS output
CROSS JOIN UNNEST(output.addresses) AS address
WHERE block_timestamp_month = DATE '2024-01-01'
GROUP BY hash)
SELECT CASE WHEN address_count = 1 THEN '1件' WHEN address_count BETWEEN 2 AND 3 THEN '2〜3件' WHEN address_count BETWEEN 4 AND 9 THEN '4〜9件' ELSE '10件以上' END AS category, COUNT(1) AS metric_value
FROM per_transaction GROUP BY category ORDER BY metric_value DESC LIMIT 30"""
m.report.generate_request=lambda _client,_model,request,rules:(generated.append([request,rules]) or ({"sql":sql,"reason":"二段階で展開","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:(([('category','STRING'),('metric_value','INT64')],None))
def execute(_bq,source,**kwargs):
 executed.append([source,kwargs])
 return (([("1件",10),("2〜3件",4)], ["category","metric_value"]),None)
m.report.exec_bq=execute;events=[]
e.query(question,events.append,profile="bitcoin",analysis_specification=spec)
bad=sql.replace("bigquery-public-data.crypto_bitcoin", "bigquery-public-data.ga4_obfuscated_sample_ecommerce")
_,bad_error=m.report.validate_sql(bad,m.bitcoin.DATASET)
period_error=""
try:m.bitcoin.require_sql_period(sql.replace("2024-01-01","2024-02-01"),m.bitcoin.period_for_question(question))
except ValueError as error:period_error=str(error)
print(json.dumps({
 "types":[event["type"] for event in events],
 "visualization":events[-1]["visualization"],
 "columns":events[-1]["columns"],
 "request_has_partition":"block_timestamp_month = DATE '2024-01-01'" in generated[0][0],
 "rules_are_neutral":"必要な場合だけUNNEST" in generated[0][1],
 "allowed":executed[0][1]["allowed_dataset"],
 "max_results":executed[0][1]["max_results"],
 "bad_error":bad_error,
 "period_error":period_error,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    types: ['stage', 'stage', 'sql', 'stage', 'result'],
    visualization: 'bar',
    columns: ['受取アドレス数帯', '取引数'],
    request_has_partition: true,
    rules_are_neutral: true,
    allowed: 'bigquery-public-data.crypto_bitcoin',
    max_results: 101,
    bad_error:
      'rejected: foreign table ref `bigquery-public-data.ga4_obfuscated_sample_ecommerce.transactions`',
    period_error: '生成SQLの対象期間が問い合わせの2024年1月と一致しません。',
  });
});

test('Bitcoin query quotes the reserved hash column before BigQuery execution', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.rules="";e.bitcoin_rules=m.bitcoin.prompt_rules()
e.client=e.bq=object();e.lock=threading.Lock();executed=[]
question="2024年1月のBitcoin取引について、受取アドレス数帯別の取引数を比較して"
spec={"title":"受取アドレス数帯別の取引数","objective":"受取構造を比較する","dimensions":["受取アドレス数帯"],"measures":["取引数"],"comparison":"帯別","chart":"bar","execution_prompt":question,"reason":"分布を判断する"}
sql="""WITH tx_address_counts AS (
    SELECT
        t.hash,
        COUNT(DISTINCT addr) AS unique_address_count
    FROM \`bigquery-public-data.crypto_bitcoin.transactions\` AS t,
        UNNEST(t.outputs) AS o,
        UNNEST(o.addresses) AS addr
    WHERE t.block_timestamp_month = DATE '2024-01-01'
    GROUP BY t.hash
),
tx_bands AS (
    SELECT
        HASH,
        CASE WHEN unique_address_count = 1 THEN '1件'
             WHEN unique_address_count BETWEEN 2 AND 3 THEN '2〜3件'
             WHEN unique_address_count BETWEEN 4 AND 9 THEN '4〜9件'
             WHEN unique_address_count >= 10 THEN '10件以上'
        END AS address_count_band
    FROM tx_address_counts
    WHERE unique_address_count > 0
)
SELECT address_count_band AS category, COUNT(1) AS metric_value
FROM tx_bands
GROUP BY category
ORDER BY metric_value DESC
LIMIT 30"""
m.report.generate_request=lambda *_args:({"sql":sql,"reason":"二段階で展開","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
m.report.inspect_bq_schema=lambda *_args,**_kwargs:(([('category','STRING'),('metric_value','INT64')],None))
def execute(_bq,source,**_kwargs):
 executed.append(source)
 return (([("1件",10)], ["category","metric_value"]),None)
m.report.exec_bq=execute;events=[]
e.query(question,events.append,profile="bitcoin",analysis_specification=spec)
shown=next(event["sql"] for event in events if event["type"]=="sql")
quoted=chr(96)+"hash"+chr(96)
protected="SELECT t.hash, 'hash', "+quoted+" -- hash\\n/* hash */ FROM source"
protected_once=m.bitcoin.quote_reserved_hash_identifiers(protected)
long_literal="SELECT '"+(chr(92)+"!")*2000+"hash'"
print(json.dumps({
 "executed_quoted":("SELECT\\n        "+quoted+",") in executed[0],
 "display_quoted":quoted in shown,
 "qualified_unchanged":"t.hash" in executed[0],
 "prompt_guard":"予約語" in e.bitcoin_rules and quoted in e.bitcoin_rules,
 "protected_unchanged":protected_once==protected,
 "idempotent":m.bitcoin.quote_reserved_hash_identifiers(executed[0])==executed[0],
 "long_literal_unchanged":m.bitcoin.quote_reserved_hash_identifiers(long_literal)==long_literal,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    executed_quoted: true,
    display_quoted: true,
    qualified_unchanged: true,
    prompt_guard: true,
    protected_unchanged: true,
    idempotent: true,
    long_literal_unchanged: true,
  });
});

test('planning calls Vertex only and preserves AI-authored dashboard panels', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.metrics="metrics";e.client=object();e.lock=threading.Lock()
def panel(index):return {"id":f"P{index}","title":f"分析{index}","kpi":f"指標{index}","chart":"scorecard","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を1行で出して","dimensions":[],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
raw={"status":"proposed","objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"目的","audience":"責任者","comparison":"月内比較","period":m.period_for_question("2021年1月"),"hypotheses":["仮説"],"clarifications":[],"answers":{"audience":"責任者"},"organization_context_revision":"demo-org-ec-v1","panels":[panel(index) for index in range(1,7)],"revision":"plan-test"}
calls=[]
m.planner.propose_dashboard=lambda *_args,**_kwargs:(calls.append("vertex") or (raw,{"input_tokens":10,"output_tokens":5}))
events=[];e.plan(raw["objective"],raw["answers"],events.append)
confirmed=m.planner.confirm_dashboard_plan(raw)
period,sections=m.dashboard_sections_for_plan(raw["objective"],confirmed)
print(json.dumps({"calls":calls,"events":[event["type"] for event in events],"ids":[section["id"] for section in sections],"period":period["label"],"confirmed":confirmed["status"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: ['vertex'],
    events: ['plan_stage', 'plan'],
    ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    period: '2021年1月',
    confirmed: 'confirmed',
  });
});

test('dashboard build has no fixed-catalog fallback without an AI-authored plan', () => {
  const result = python(`
import inspect,threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.rules="";e.client=e.bq=object();e.lock=threading.Lock();e.latest_dashboard=None
m.report.generate=lambda *_args,**_kwargs:({"sql":"","reason":"unused","undefined_terms":["unused"]},{"input_tokens":1,"output_tokens":1})
events=[];error=""
try:e.dashboard("2021年1月のECサイト分析ダッシュボードを作って",events.append)
except m.LiveDemoError as caught:error=str(caught)
removed=all(not hasattr(m,name) for name in ["DASHBOARD_PURPOSES","DASHBOARD_ROW_TEMPLATES","dashboard_sections","dashboard_layout_rows","confirm_dashboard_analysis_plan"])
planner_removed=all(not hasattr(m.planner,name) for name in ["PANEL_CATALOG","planning_request","normalize_plan","propose","confirm_plan"])
layout_source=inspect.getsource(m.dashboard_layout_rows_for_plan)
layout_is_ai_authored=all(value not in layout_source for value in ["panel.get('chart')","full_width_charts","weights ="])
print(json.dumps({"error":error,"events":[event["type"] for event in events],"removed":removed,"planner_removed":planner_removed,"layout_is_ai_authored":layout_is_ai_authored},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: 'AIが作成した分析仕様を確定してからbuildしてください。',
    events: [],
    removed: true,
    planner_removed: true,
    layout_is_ai_authored: true,
  });
});

test('planning sends the selected current plan and revision instruction back to the AI', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.metrics="metrics";e.client=object();e.lock=threading.Lock()
def panel(index):return {"id":f"P{index}","title":f"分析{index}","kpi":f"指標{index}","chart":"bar","decision":f"判断{index}","reason":f"理由{index}","execution_prompt":f"2021年1月の指標{index}を区分別に出して","dimensions":["区分"],"measures":[f"指標{index}"],"layout_row":(index+1)//2,"layout_weight":1}
raw={"status":"proposed","objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"目的","audience":"責任者","comparison":"月内比較","period":m.period_for_question("2021年1月"),"hypotheses":["仮説"],"clarifications":[],"answers":{"audience":"責任者"},"organization_context_revision":"demo-org-ec-v1","panels":[panel(index) for index in range(1,7)],"revision":"plan-test"}
calls=[]
def propose(*_args,**kwargs):
 calls.append({"count":len(kwargs["current_plan"]["panels"]),"instruction":kwargs["instruction"],"status":kwargs["current_plan"]["status"]})
 return raw,{"input_tokens":10,"output_tokens":5}
m.planner.propose_dashboard=propose
events=[];e.plan(raw["objective"],raw["answers"],events.append,analysis_plan=raw,revision_instruction="流入別パネルを追加して")
print(json.dumps({"calls":calls,"events":[event["type"] for event in events]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: [{ count: 6, instruction: '流入別パネルを追加して', status: 'confirmed' }],
    events: ['plan_stage', 'plan'],
  });
});

test('a confirmed dynamic dashboard plan builds its authored specifications', () => {
  const result = python(`
def panel(title,chart,prompt,row,weight):
 dimension=[] if chart=="scorecard" else (["日別"] if chart=="line" else ["medium"] if "medium" in prompt else ["デバイス"])
 return {"title":title,"kpi":"購入件数","chart":chart,"decision":"意思決定","reason":"目的に必要","execution_prompt":prompt,"dimensions":dimension,"measures":["購入件数"],"layout_row":row,"layout_weight":weight}
question="2021年1月の購入課題を分析するダッシュボードを作って"
raw={"objective_summary":"購入課題を判断する","audience":"責任者","comparison":"軸間比較","hypotheses":["差がある"],"clarifications":[],"panels":[
 panel("流入別購入","bar","2021年1月の購入件数をmedium別に出して",1,1),
 panel("日別購入","line","2021年1月の日別購入件数を出して",1,3),
 panel("デバイス別購入","bar","2021年1月の購入件数をデバイス別に出して",2,1),
 panel("購入規模","scorecard","2021年1月の購入件数を出して",2,1),
]}
plan=m.planner.normalize_dashboard_plan(raw,question,m.period_for_question(question),{"audience":"責任者"})
confirmed=m.planner.confirm_dashboard_plan(plan)
period,sections=m.dashboard_sections_for_plan(question,confirmed)
print(json.dumps({"period":period["label"],"ids":[item["id"] for item in sections],"titles":[item["title"] for item in sections],"prompts":[item["text"] for item in sections],"layouts":m.dashboard_layout_rows_for_plan(confirmed["panels"])},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    period: '2021年1月',
    ids: ['P1', 'P2', 'P3', 'P4'],
    titles: ['流入別購入', '日別購入', 'デバイス別購入', '購入規模'],
    prompts: [
      '2021年1月の購入件数をmedium別に出して',
      '2021年1月の日別購入件数を出して',
      '2021年1月の購入件数をデバイス別に出して',
      '2021年1月の購入件数を出して',
    ],
    layouts: [
      { panel_ids: ['P1', 'P2'], shares: [25, 75] },
      { panel_ids: ['P3', 'P4'], shares: [50, 50] },
    ],
  });
});

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

test('dashboard SQL and dry-run schema are checked against the AI chart contract', () => {
  const result = python(`
panel={"id":"P1","title":"イベント別比較","chart":"grouped_bar","decision":"判断","execution_prompt":"2021年1月を比較","dimensions":["イベント"],"measures":["時間","人数"]}
section=m.planned_analysis_section(panel)
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
safe="SELECT event_name AS category, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(DISTINCT user_pseudo_id) AS metric_2 FROM "+table+" GROUP BY category ORDER BY metric_1 DESC LIMIT 20"
m.validate_generated_dashboard_sql(section,safe)
m.validate_dashboard_dry_run_schema(section,[("category","STRING"),("metric_1","INT64"),("metric_2","INT64")])
errors=[]
for sql in [
 "SELECT event_name, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY event_name ORDER BY metric_1 DESC LIMIT 20",
 "SELECT event_name AS category, SUM(engagement_time) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY category ORDER BY metric_1 DESC LIMIT 20",
 "SELECT event_name AS category, COALESCE(SUM(engagement_time),0) AS metric_1, COUNT(*) AS metric_2 FROM "+table+" GROUP BY category",
]:
 try:m.validate_generated_dashboard_sql(section,sql)
 except m.LiveDemoError as error:errors.append(str(error))
try:m.validate_dashboard_dry_run_schema(section,[("category","STRING"),("metric_1","STRING"),("metric_2","INT64")])
except m.LiveDemoError as error:errors.append(str(error))
print(json.dumps({"safe":True,"errors":errors},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.safe, true);
  assert.equal(output.errors.length, 4);
  assert.match(output.errors[0], /別名なし/);
  assert.match(output.errors[1], /NULLを返し得る/);
  assert.match(output.errors[2], /ORDER BYとLIMIT 20以下/);
  assert.match(output.errors[3], /dry run出力/);
});

test('dashboard dry-run mismatch is repaired once and still stops before paid execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.rules="rules";e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"購入規模","chart":"scorecard","decision":"判断","execution_prompt":"2021年1月の購入件数","dimensions":[],"measures":["購入件数"]})
tick=chr(96);sql="SELECT COUNT(*) AS metric_value FROM "+tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate=lambda *_args,**_kwargs:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
repairs=[]
m.report.repair=lambda *_args,**_kwargs:(repairs.append(True) or ({"sql":sql,"reason":"型を修正できない","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","STRING")],None)
executions=[];m.report.exec_bq=lambda *_args,**_kwargs:(executions.append(True) or (([],[]),None))
try:e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},lambda _event:None,{"panel_id":"P1"})
except m.LiveDemoError as error:message=str(error)
print(json.dumps({"message":message,"repairs":len(repairs),"executions":executions},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).message, /1回修正しましたが/);
  assert.equal(JSON.parse(result.stdout).repairs, 1);
  assert.deepEqual(JSON.parse(result.stdout).executions, []);
});

test('dashboard period mismatch is repaired once before BigQuery execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.rules="rules";e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"流入別セッション","chart":"bar","decision":"判断","execution_prompt":"2021年1月の流入別セッション","dimensions":["流入元"],"measures":["セッション数"]})
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
initial="SELECT traffic_source.medium AS category, COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' GROUP BY category ORDER BY metric_value DESC LIMIT 30"
repaired="SELECT traffic_source.medium AS category, COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY category ORDER BY metric_value DESC LIMIT 30"
m.report.generate=lambda *_args,**_kwargs:({"sql":initial,"reason":"初回","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
diagnostics=[]
m.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({"sql":repaired,"reason":"期間を修正","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.inspect_bq_schema=lambda *_args,**_kwargs:([("category","STRING"),("metric_value","INT64")],None)
executed=[]
m.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or (([("organic",12)], ["category","metric_value"]),None))
events=[];e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},events.append,{"operation":"dashboard","panel_id":"P1"})
print(json.dumps({"diagnostics":diagnostics,"executed":executed,"stages":[event.get("stage") for event in events if event["type"]=="stage"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.diagnostics[0], /生成SQLの対象期間/);
  assert.equal(output.executed.length, 1);
  assert.match(output.executed[0], /20210101.*20210131/);
  assert.deepEqual(output.stages, ['generate', 'validate', 'repair', 'execute']);
});

test('a compiler dry-run diagnostic is repaired before paid execution', () => {
  const result = python(`
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.rules="rules";e.client=e.bq=object()
section=m.planned_analysis_section({"id":"P1","title":"購入規模","chart":"scorecard","decision":"判断","execution_prompt":"2021年1月の購入件数","dimensions":[],"measures":["購入件数"]})
tick=chr(96);table=tick+"bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*"+tick
initial="SELECT COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
repaired="WITH base AS (SELECT user_pseudo_id FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131') SELECT COUNT(*) AS metric_value FROM base"
m.report.generate=lambda *_args,**_kwargs:({"sql":initial,"reason":"初回","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
diagnostics=[]
m.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({"sql":repaired,"reason":"CTEへ修正","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
dry_runs=[]
def inspect(_bq,sql,**_kwargs):
 dry_runs.append(sql)
 return (None,"bq dry-run error: BadRequest: Correlated subqueries are not supported") if len(dry_runs)==1 else ([("metric_value","INT64")],None)
m.report.inspect_bq_schema=inspect
executed=[];m.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or (([(12,)], ["metric_value"]),None))
events=[];e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},events.append,{"panel_id":"P1"})
print(json.dumps({"diagnostics":diagnostics,"dry_runs":dry_runs,"executed":executed,"stages":[event.get("stage") for event in events if event["type"]=="stage"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.diagnostics[0], /Correlated subqueries/);
  assert.equal(output.dry_runs.length, 2);
  assert.deepEqual(output.executed, [output.dry_runs[1]]);
  assert.deepEqual(output.stages, ['generate', 'validate', 'repair', 'execute']);
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

test('workspace pane controls stay viewport-anchored and expose their state visually', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /#sidebar-toggle,#inspector-toggle\{position:fixed/);
  assert.match(rendered.stdout, /#sidebar-toggle\{left:8px\}#inspector-toggle\{right:8px\}/);
  assert.match(rendered.stdout, /function paneIcon\(side,expanded\)/);
  assert.match(rendered.stdout, /button\.dataset\.state=expanded\?"open":"closed"/);
  assert.match(rendered.stdout, /replaceChildren\(paneIcon\(side,expanded\)\)/);
  assert.match(rendered.stdout, /成果物パネルを展開/);
});

test('shared composer stays readable, grows upward, and routes through cost gates', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(script.includes('function submitComposer()'));
  assert.ok(script.includes('showCost("dashboard-plan")'));
  assert.ok(script.includes('showCost("graph")'));
  assert.ok(script.includes('showCost("report")'));
  assert.ok(script.includes('$("artifact-preview-host").appendChild($("output"))'));
  assert.ok(script.includes('selectWorkspace("build");setComposerAction("dashboard",false)'));
  assert.match(
    rendered.stdout,
    /width:min\(768px,calc\(100vw - var\(--nav-column\) - var\(--nav-grip\) - var\(--inspector-column\) - var\(--inspector-grip\) - 48px\)\)/,
  );
  assert.match(rendered.stdout, /\.analysis-composer\{[^}]*border-radius:22px/);
  assert.match(rendered.stdout, /#composer-input\{[^}]*max-height:none[^}]*overflow-y:hidden/);
  assert.ok(script.includes('function resizeComposerInput()'));
  assert.ok(script.includes('input.style.height=`${input.scrollHeight}px`'));
  assert.ok(script.includes('$("composer-input").addEventListener("input",resizeComposerInput)'));
  assert.match(
    rendered.stdout,
    /@media\(max-width:960px\)\{\.analysis-composer\{[^}]*width:min\(768px,calc\(100vw - 24px\)\)/,
  );
});

test('completed dashboards enter an accessible reading mode without losing chat', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(rendered.stdout.includes('id="composer-launcher"'));
  assert.ok(rendered.stdout.includes('aria-label="AIへの相談入力を開く"'));
  assert.ok(rendered.stdout.includes('id="composer-collapse"'));
  assert.match(
    rendered.stdout,
    /\.analysis-composer\.composer-collapsed\{[^}]*width:auto[^}]*box-shadow:none/,
  );
  assert.ok(script.includes('function collapseComposer()'));
  assert.ok(
    script.includes(
      'function collapseComposerFromControl(){collapseComposer();$("composer-launcher").focus()}',
    ),
  );
  assert.ok(script.includes('function expandComposer(focusInput=true)'));
  assert.ok(script.includes('function enterDashboardReadingMode()'));
  assert.ok(
    script.includes(
      'if(!$("app-shell").classList.contains("inspector-collapsed"))toggleInspector()',
    ),
  );
  assert.ok(script.includes('$("composer-launcher").onclick=()=>expandComposer()'));
  assert.ok(script.includes('$("composer-collapse").onclick=collapseComposerFromControl'));
  assert.ok(script.includes('selectWorkspace("dashboard");enterDashboardReadingMode()'));
  assert.ok(
    script.includes(
      'if(view!=="dashboard"){$("analysis-composer").classList.remove("dashboard-ready");expandComposer(false)}',
    ),
  );
});

test('dashboard resizes every shared row without free rearrangement', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(script.includes('function groupDashboardPanelRow(ids,initialShares)'));
  assert.ok(
    script.includes('e.layout_rows.forEach(row=>groupDashboardPanelRow(row.panel_ids,row.shares))'),
  );
  assert.ok(script.includes('separator.setAttribute("role","separator")'));
  assert.ok(script.includes('separator.setAttribute("aria-valuemin"'));
  assert.ok(script.includes('separator.setAttribute("aria-valuemax"'));
  assert.ok(script.includes('separator.setAttribute("aria-valuenow"'));
  assert.ok(script.includes('separator.onpointerdown='));
  assert.ok(script.includes('separator.onpointermove='));
  assert.ok(script.includes('separator.onkeydown='));
  assert.match(rendered.stdout, /\.dashboard-layout-row\{[^}]*display:grid/);
  assert.match(rendered.stdout, /\.dashboard-grid\{[^}]*container-type:inline-size/);
  assert.match(rendered.stdout, /\.dashboard-card-resizer\{[^}]*cursor:col-resize/);
  assert.match(
    rendered.stdout,
    /@container \(max-width:900px\)\{\.dashboard-layout-row\{grid-template-columns:minmax\(0,1fr\)!important;gap:14px\}\.dashboard-layout-row>\.dashboard-card\{grid-column:1!important/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row\{grid-column:1;grid-template-columns:minmax\(0,1fr\)!important;gap:14px\}/,
  );
  assert.doesNotMatch(script, /draggable\s*=|ondragstart|Sortable/);
});

test('dashboard cards in the same row share height while content stays top-aligned', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\.dashboard-layout-row\{[^}]*align-items:stretch/);
  assert.match(
    rendered.stdout,
    /\.dashboard-card \.chart\{[^}]*align-items:start[^}]*overflow:visible[^}]*flex:1/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.chart\{[^}]*max-height:460px[^}]*overflow:auto/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.chart\{display:flex;flex:1;min-height:0;overflow:hidden\}/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.echart-root\{flex:1 1 auto;height:100%!important;min-height:300px\}/,
  );
  assert.ok(
    rendered.stdout.indexOf(
      '.dashboard-layout-row>.dashboard-card .chart{max-height:460px;overflow:auto}',
    ) <
      rendered.stdout.indexOf(
        '@container (max-width:900px){.dashboard-layout-row{grid-template-columns:',
      ),
    'the single-column container override must follow the desktop height cap',
  );
  assert.match(rendered.stdout, /\.chart-table-scroll\{[^}]*max-height:360px[^}]*overflow:auto/);
  assert.match(rendered.stdout, /\.chart-table-scroll th,[^}]*overflow-wrap:anywhere/);
});

test('left navigation stays compact and scrolls long titles only on interaction', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /class="sidebar-title"><span>購入成果改善ダッシュボード<\/span>/);
  assert.match(
    rendered.stdout,
    /class="sidebar-chrome"><span class="brand">RepChat<\/span><\/div>/,
  );
  assert.doesNotMatch(rendered.stdout, /<span>Analysis workspace<\/span>/);
  assert.match(rendered.stdout, /\.workspace-sidebar\{[^}]*padding:0 4px 8px/);
  assert.match(
    rendered.stdout,
    /\.workspace-nav button\{[^}]*grid-template-columns:16px minmax\(0,1fr\);column-gap:4px[^}]*padding:6px 4px[^}]*overflow:hidden/,
  );
  assert.match(rendered.stdout, /\.sidebar-label\{margin:12px 5px 4px/);
  assert.match(
    rendered.stdout,
    /\.sidebar-title>span\{[^}]*width:max-content[^}]*white-space:nowrap/,
  );
  assert.match(rendered.stdout, /@keyframes sidebar-title-marquee/);
  assert.match(
    rendered.stdout,
    /\.workspace-nav button:focus-visible\{outline:2px solid #7fa2c2;outline-offset:-2px\}/,
  );
  assert.match(
    rendered.stdout,
    /button:hover \.sidebar-title>span,\.workspace-nav button:focus-visible \.sidebar-title>span\{animation:sidebar-title-marquee/,
  );
});

test('pane splitters keep an accessible hit area without visible layout gaps', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(
    rendered.stdout,
    /--nav-grip:1px;--inspector-column:var\(--inspector-width\);--inspector-grip:1px/,
  );
  assert.match(
    rendered.stdout,
    /\.navigation-resizer,\.inspector-resizer\{[^}]*width:var\(--splitter-hit-area\)[^}]*justify-self:center/,
  );
  assert.match(
    rendered.stdout,
    /\.navigation-resizer::after,\.inspector-resizer::after\{left:50%;transform:translateX\(-50%\)\}/,
  );
  assert.match(rendered.stdout, /\.sidebar-chrome\{[^}]*margin:0 -4px/);
  assert.match(rendered.stdout, /\.sidebar-account\{[^}]*margin-right:-4px;margin-left:-4px/);
});

test('analysis workspace visual hierarchy protects charts and the main surface', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "tokens":all(value in html for value in ["--radius-card:12px","--shadow-card:","--color-background:"]),
 "hierarchy":all(value in html for value in [".dashboard-layout-row>.dashboard-card{grid-column:auto!important;min-height:268px", ".dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}"]),
 "overflow":all(value in html for value in ["body{overflow-x:hidden", ".dashboard-card .chart svg{display:block;min-width:0;width:100%;max-width:100%}"]),
 "responsive":all(value in html for value in ["@media(max-width:1180px)","position:fixed","@media(max-width:960px)","@media(max-width:760px)"]),
 "accessible":all(value in html for value in [":focus-visible","prefers-reduced-motion:reduce","outline:3px solid var(--color-focus)"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    tokens: true,
    hierarchy: true,
    overflow: true,
    responsive: true,
    accessible: true,
  });
});

test('analysis workspace starts with overlays closed on narrow viewports', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /window\.innerWidth<=1180/);
  assert.match(rendered.stdout, /window\.innerWidth<=960/);
  assert.match(rendered.stdout, /!\$\("app-shell"\)\.classList\.contains\("inspector-collapsed"\)/);
});

test('workspace panes own the full height while the header belongs to the main column', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  const shell = html.indexOf('id="app-shell"');
  const sidebar = html.indexOf('id="workspace-sidebar"');
  const header = html.indexOf('class="app-header"');
  const main = html.indexOf('id="workspace-main"');
  const inspector = html.indexOf('id="panel-inspector"');
  assert.ok(shell < sidebar && sidebar < header && header < main && main < inspector);
  assert.match(html, /grid-template-rows:44px minmax\(0,1fr\)/);
  assert.match(html, /\.workspace-sidebar\{grid-column:1;grid-row:1\/3/);
  assert.match(html, /\.workspace-inspector\{grid-column:5;grid-row:1\/3/);
  assert.match(html, /\.app-header\{grid-column:3;grid-row:1/);
  assert.match(html, /class="sidebar-chrome"><span class="brand">RepChat/);
  assert.match(html, /id="compact-title" class="header-title">分析ワークスペース/);
  assert.doesNotMatch(html, /<span class="brand">RepChat<\/span><span>Live analysis demo/);
});

test('selected workspace title is compact and not repeated above the main content', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\.workspace-topbar\{display:none\}/);
  assert.match(
    rendered.stdout,
    /selectWorkspace=view=>\{baseSelectWorkspace\(view\);\$\("compact-title"\)\.textContent=\$\("page-title"\)\.textContent;/,
  );
  assert.match(
    rendered.stdout,
    /build:\["購入成果を改善する","AIと目的・KPI・比較軸を相談し、確認した仕様だけをbuildします。","分析スレッド"\]/,
  );
  assert.doesNotMatch(rendered.stdout, /id="workspace-back"|id="workspace-forward"/);
});

test('workspace chrome uses compact controls and separates splitter hit area from its hairline', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /--header-height:44px/);
  assert.match(rendered.stdout, /--icon-button-size:32px/);
  assert.match(rendered.stdout, /--splitter-hit-area:8px/);
  assert.match(rendered.stdout, /--splitter-line:1px/);
  assert.match(
    rendered.stdout,
    /\.app-shell\.inspector-collapsed \.workspace-inspector,[^}]+display:none;overflow:hidden/,
  );
  assert.match(
    rendered.stdout,
    /\.app-shell\.sidebar-collapsed \.navigation-resizer,[^}]+display:none/,
  );
  assert.match(rendered.stdout, /font-weight:500/);
  assert.doesNotMatch(rendered.stdout, /font-weight:800/);
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

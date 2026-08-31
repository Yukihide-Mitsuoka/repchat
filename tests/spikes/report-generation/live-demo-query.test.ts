import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

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

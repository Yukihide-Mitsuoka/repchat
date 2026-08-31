import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');

function sectionExecution(body: string) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
import section_execution as execution
usage={"input_tokens":1000,"output_tokens":1000}
table=chr(96)+execution.report.DATASET+".events_*"+chr(96)
sql="SELECT COUNT(*) AS metric_value FROM "+table+" WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
period={"from":"20210101","to":"20210131","label":"2021年1月"}
execution.report.generate=lambda *_args,**_kwargs:({"sql":sql,"reason":"集計","undefined_terms":[]},usage)
${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('BigQuery execution errors stop before visualization and result emission', () => {
  const output = sectionExecution(`
execution.report.exec_bq=lambda *_args,**_kwargs:(None,"backend unavailable")
events=[]
try:
 execution.run_section(
  {"title":"結果検証用","planned_visualization":"unsupported"}, period, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,rules="rules",
  bitcoin_rules="bitcoin rules",max_result_rows=10,
 )
except execution.SectionExecutionError as error:message=str(error)
print(json.dumps({
 "message":message,
 "results":[event for event in events if event["type"]=="result"],
 "stages":[event.get("stage") for event in events if event["type"]=="stage"],
}))
`);
  assert.deepEqual(output, {
    message: 'BigQuery実行に失敗しました: backend unavailable',
    results: [],
    stages: ['generate', 'execute'],
  });
});

test('row overflow requests one sentinel row and stops before visualization', () => {
  const output = sectionExecution(`
query_options=[]
def execute(_bq,_sql,**kwargs):
 query_options.append(kwargs)
 return (([(1,),(2,),(3,)], ["metric_value"]),None)
execution.report.exec_bq=execute
events=[]
try:
 execution.run_section(
  {"title":"結果検証用","planned_visualization":"unsupported"}, period, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,rules="rules",
  bitcoin_rules="bitcoin rules",max_result_rows=2,
 )
except execution.SectionExecutionError as error:message=str(error)
print(json.dumps({
 "message":message,
 "max_results":query_options[0]["max_results"],
 "results":[event for event in events if event["type"]=="result"],
}))
`);
  assert.deepEqual(output, {
    message: '結果が2行を超えたため描画しません。集計条件を追加してください。',
    max_results: 3,
    results: [],
  });
});

test('visualization validation errors keep their message and suppress the result', () => {
  const output = sectionExecution(`
execution.report.exec_bq=lambda *_args,**_kwargs:(([('invalid',)], ["metric_value"]),None)
events=[]
try:
 execution.run_section(
  {"title":"結果検証用","planned_visualization":"scorecard"}, period, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,rules="rules",
  bitcoin_rules="bitcoin rules",max_result_rows=10,
 )
except execution.SectionExecutionError as error:
 message=str(error)
 cause=type(error.__cause__).__name__
print(json.dumps({
 "message":message,
 "cause":cause,
 "results":[event for event in events if event["type"]=="result"],
}))
`);
  assert.deepEqual(output, {
    message: '結果検証用の結果形状がAI分析仕様のscorecardと一致しないため描画しません。',
    cause: 'VisualizationResultError',
    results: [],
  });
});

test('successful execution emits the existing normalized result payload', () => {
  const output = sectionExecution(`
from datetime import date
from decimal import Decimal
query_options=[]
def execute(_bq,_sql,**kwargs):
 query_options.append(kwargs)
 return (([(date(2021,1,1),Decimal("2.5"))], ["raw_date","raw_value"]),None)
execution.report.exec_bq=execute
events=[]
cost=execution.run_section(
 {"shape":{"columns":["日付","値"]},"navigation_depth":4,"title":"時系列","planned_visualization":"line"}, period, events.append,
 client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,rules="rules",
 bitcoin_rules="bitcoin rules",max_result_rows=10,
)
result=next(event for event in events if event["type"]=="result")
print(json.dumps({
 "returned_cost":cost,
 "max_results":query_options[0]["max_results"],
 "allowed_dataset":query_options[0]["allowed_dataset"],
 "result":result,
}))
`);
  assert.deepEqual(output, {
    returned_cost: 1.3949999999999998,
    max_results: 11,
    allowed_dataset: 'bigquery-public-data.ga4_obfuscated_sample_ecommerce',
    result: {
      type: 'result',
      columns: ['日付', '値'],
      source_columns: ['raw_date', 'raw_value'],
      rows: [['2021-01-01', 2.5]],
      visualization: 'line',
      navigation_depth: 4,
      verification: 'unverified',
      verification_label: '実行済み・AI分析仕様と形状照合済み',
      cost_jpy: 1.395,
    },
  });
});

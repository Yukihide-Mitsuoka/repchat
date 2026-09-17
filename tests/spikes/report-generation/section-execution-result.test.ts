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
from analysis_contract_context import AnalysisExecutionPolicy,AnalysisResultPolicy
from analysis_schema_policy import AnalysisFieldPolicy
usage={"input_tokens":1000,"output_tokens":1000}
table_name="alpha.dataset.records"
table=chr(96)+table_name+chr(96)
sql="SELECT COUNT(*) AS metric_value FROM "+table
policy=AnalysisExecutionPolicy(frozenset({table_name}),frozenset({table_name}),100,10,schema_fields=(AnalysisFieldPolicy(table_name,("record_id",),"STRING","REQUIRED",False,False),),result=AnalysisResultPolicy(frozenset({'Observed at'}),frozenset(),frozenset({'Observed at'})))
contract=object()
execution.analysis_contract_context.execution_policy=lambda _contract:policy
execution.analysis_contract_context.sql_rules=lambda _contract:"rules"
execution.analysis_contract_context.planning_period=lambda _contract:None
execution.report.generate_request=lambda *_args,**_kwargs:({"sql":sql,"reason":"集計","undefined_terms":[]},usage)
execution.report.generation_request=lambda *_args,**_kwargs:"analysis request"
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
execution.sql_contracts.validate_generated_dashboard_sql=lambda *_args,**_kwargs:None
execution.sql_contracts.validate_dashboard_dry_run_schema=lambda *_args,**_kwargs:None
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
  {"title":"結果検証用","planned_visualization":"unsupported"}, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
  contract=contract,max_result_rows=10,
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
    stages: ['generate', 'validate', 'execute'],
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
  {"title":"結果検証用","planned_visualization":"unsupported"}, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
  contract=contract,max_result_rows=2,
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
  {"title":"結果検証用","planned_visualization":"scorecard"}, events.append,
  client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
  contract=contract,max_result_rows=10,
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
 {"shape":{"columns":["日付","値"]},"navigation_depth":4,"title":"時系列","planned_visualization":"line","semantic_dimensions":["Observed at"]}, events.append,
 client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
 contract=contract,max_result_rows=10,
)
result=next(event for event in events if event["type"]=="result")
print(json.dumps({
 "returned_cost":cost,
 "max_results":query_options[0]["max_results"],
 "contract_policy":query_options[0]["policy"] is policy,
 "result":result,
}))
`);
  assert.deepEqual(output, {
    returned_cost: 1.3949999999999998,
    max_results: 11,
    contract_policy: true,
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './python-test-helpers.ts';

test('contract result policy accepts only declared semantics and exact scalar columns', () => {
  const result = python(`
import contract_result_validation as validation
import hashlib
import analysis_contract_context as context
from analysis_contract import AnalysisContract,fingerprint_contract_content
table='alpha.dataset.records'
metadata={'version':1,'tables':[{'table':table,'fields':[{'name':'group_name','type':'STRING','mode':'NULLABLE'},{'name':'amount','type':'NUMERIC','mode':'NULLABLE'}]}]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,sort_keys=True,separators=(',',':')).encode()).hexdigest()
content={'version':1,'schema':{'fingerprint':schema_fingerprint,'retrieved_at':'2026-09-14T00:00:00+00:00','metadata':metadata},'semantics':{'grain':{},'identifiers':{},'dimensions':{'Group':{}},'measures':{},'metrics':{'Total amount':{}},'relationships':[]},'period':None,'limits':{'maximum_bytes_billed':100,'maximum_result_rows':10}}
encoded=json.dumps(content,sort_keys=True,separators=(',',':'))
policy=context.execution_policy(AnalysisContract(encoded,fingerprint_contract_content(content)))
base={
 'title':'集計','source_columns':['category','metric_value'],
 'semantic_dimensions':['Group'],'semantic_measures':['Total amount'],
}
cases=[
 (base,[('category','STRING','NULLABLE'),('metric_value','NUMERIC','NULLABLE')]),
 (base,['CATEGORY','METRIC_VALUE']),
 ({**base,'source_columns':['source','target','metric_value'],'semantic_dimensions':['Group','Group']},['source','target','metric_value']),
 ({**base,'semantic_dimensions':['Unknown']},[('category','STRING') ,('metric_value','NUMERIC')]),
 ({**base,'semantic_measures':['Unknown']},[('category','STRING'),('metric_value','NUMERIC')]),
 (base,[('wrong','STRING'),('metric_value','NUMERIC')]),
 (base,[('category','STRING','REPEATED'),('metric_value','NUMERIC','NULLABLE')]),
 (base,[('category','STRUCT','NULLABLE'),('metric_value','NUMERIC','NULLABLE')]),
]
print(json.dumps([validation.contract_result_diagnostic(section,columns,policy) for section,columns in cases],ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const diagnostics = JSON.parse(result.stdout) as string[];
  assert.deepEqual(diagnostics.slice(0, 3), ['', '', '']);
  for (const diagnostic of diagnostics.slice(3)) {
    assert.match(diagnostic, /共通分析契約の結果形状/);
  }
});

test('planned sections retain their source-independent semantic names', () => {
  const result = python(`
from visualization_sections import build_planned_analysis_section
section=build_planned_analysis_section({
 'id':'P1','title':'集計','execution_prompt':'区分別に合計する','decision':'判断する',
 'chart':'bar','dimensions':['Group'],'measures':['Total amount'],
})
print(json.dumps({key:section[key] for key in ('semantic_dimensions','semantic_measures')}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    semantic_dimensions: ['Group'],
    semantic_measures: ['Total amount'],
  });
});

test('dry-run and execution result drift stop before an invalid result is emitted', () => {
  const result = python(`
import section_execution as execution
from analysis_contract_context import AnalysisExecutionPolicy,AnalysisResultPolicy
from analysis_schema_policy import AnalysisFieldPolicy
table='alpha.dataset.records'
policy=AnalysisExecutionPolicy(
 frozenset({table}),frozenset({table}),100,10,schema_fields=(AnalysisFieldPolicy(table,('id',),'STRING','REQUIRED',False,False),),
 result=AnalysisResultPolicy(frozenset(),frozenset({'Total'})),
)
execution.analysis_contract_context.execution_policy=lambda _contract:policy
execution.analysis_contract_context.sql_rules=lambda _contract:'rules'
sql='SELECT COUNT(*) AS metric_value FROM '+chr(96)+table+chr(96)
usage={'input_tokens':1,'output_tokens':1}
execution.report.generate_request=lambda *_args,**_kwargs:({'sql':sql,'reason':'集計','undefined_terms':[]},usage)
execution.report.generation_request=lambda *_args:'request'
execution.report.validate_sql=lambda value,**_kwargs:(value,None)
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([('wrong_name','INT64','NULLABLE')],None)
diagnostics=[]
execution.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({'sql':'','reason':'shape mismatch','undefined_terms':[]},usage))
executed=[]
execution.report.exec_bq=lambda *_args,**_kwargs:(executed.append(True) or (([(1,)],['wrong_name']),None))
section={'title':'集計','text':'合計する','planned_visualization':'scorecard','source_columns':['metric_value'],'semantic_dimensions':[],'semantic_measures':['Total'],'shape':{'columns':['合計']}}
try:
 execution.run_section(section,lambda _event:None,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,contract=object(),max_result_rows=10,context={'operation':'dashboard'})
except execution.SectionExecutionError as error:dry_message=str(error)
else:raise AssertionError('mismatched result executed')
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([('metric_value','INT64','NULLABLE')],None)
try:
 execution.run_section(section,lambda _event:None,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,contract=object(),max_result_rows=10,context={'operation':'dashboard'})
except execution.SectionExecutionError as error:execution_message=str(error)
else:raise AssertionError('drifted result emitted')
print(json.dumps({'dry_message':dry_message,'execution_message':execution_message,'diagnostics':diagnostics,'executed':executed},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.diagnostics[0], /共通分析契約の結果形状/);
  assert.match(output.dry_message, /shape mismatch/);
  assert.match(output.execution_message, /共通分析契約の結果形状/);
  assert.deepEqual(output.executed, [true]);
});

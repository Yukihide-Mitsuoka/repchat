import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract_context as context
from analysis_contract import AnalysisContract,expression_for_field,fingerprint_contract_content
table='alpha.dataset.records'
def ref(field):return {'table':table,'field':field}
fields=[
 {'name':'observed_at','type':'DATE','mode':'NULLABLE'},
 {'name':'shipped_at','type':'TIMESTAMP','mode':'NULLABLE'},
 {'name':'group_name','type':'STRING','mode':'NULLABLE'},
 {'name':'private_at','type':'DATE','mode':'NULLABLE','policyTags':{'names':['private']}},
 {'name':'repeated_at','type':'DATE','mode':'REPEATED'},
]
metadata={'version':1,'tables':[{'table':table,'fields':fields}]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def dimension(field):return {'field':ref(field),'expr':expression_for_field(ref(field))}
content={
 'version':1,
 'schema':{'fingerprint':schema_fingerprint,'retrieved_at':'2026-09-18T00:00:00+00:00','metadata':metadata},
 'semantics':{'grain':{},'identifiers':{},'dimensions':{
  'Observed at':dimension('observed_at'),'Shipped at':dimension('shipped_at'),
  'Group':dimension('group_name'),'Private at':dimension('private_at'),
  'Repeated at':dimension('repeated_at'),
 },'measures':{},'metrics':{'Total':{}},'relationships':[]},
 'period':{'business_time':ref('observed_at'),'timezone':'UTC','range':{'start':'2026-01-01','end':'2026-01-31'},'partitions':[]},
 'limits':{'maximum_bytes_billed':100,'maximum_result_rows':100},
}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(',',':'))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
`;

test('temporal chart roles require a non-repeated unrestricted temporal contract field', () => {
  const result = python(setup + `
policy=context.execution_policy(contract)
cases={
 'line_valid':('line',['Observed at']),
 'line_other_time':('line',['Shipped at']),
 'line_text':('line',['Group']),
 'line_private':('line',['Private at']),
 'line_repeated':('line',['Repeated at']),
 'sparkline_table_valid':('sparkline_table',['Group','Observed at']),
 'sparkline_table_swapped':('sparkline_table',['Observed at','Group']),
 'annotated_line_valid':('annotated_line',['Shipped at','Group']),
 'bar_text':('bar',['Group']),
}
print(json.dumps({name:context.temporal_chart_diagnostic(chart,dimensions,policy.result) for name,(chart,dimensions) in cases.items()},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, string>;
  for (const key of ['line_valid', 'line_other_time', 'sparkline_table_valid', 'annotated_line_valid', 'bar_text']) {
    assert.equal(output[key], '', key);
  }
  for (const key of ['line_text', 'line_private', 'line_repeated', 'sparkline_table_swapped']) {
    assert.match(output[key], /時間軸/, key);
  }
});

test('invalid temporal plan is not emitted and invalid section does not call SQL generation', () => {
  const result = python(setup + `
import analysis_workflows as workflows
import section_execution as execution
from visualization_sections import build_planned_analysis_section
events=[]
panel={'id':'P1','title':'test','execution_prompt':'test','decision':'test','chart':'line','dimensions':['Group'],'measures':['Total']}
workflows.planner.propose_dashboard=lambda *_args,**_kwargs:({'panels':[panel]},{'input_tokens':1,'output_tokens':1})
try:
 workflows.plan_dashboard(object(),'test-model','question',{},events.append,contract=contract,analysis_plan=None,revision_instruction=None,check_cancelled=lambda:None)
except workflows.AnalysisWorkflowError as error:plan_error=str(error)
else:raise AssertionError('invalid temporal plan emitted')
generated=[]
def generate(*_args,**_kwargs):
 generated.append(True)
 raise AssertionError('SQL generation was called')
execution.report.generate_request=generate
section=build_planned_analysis_section(panel)
try:
 execution.run_section(section,events.append,client=object(),bq=object(),model='test-model',contract=contract,max_result_rows=10)
except execution.SectionExecutionError as error:section_error=str(error)
else:raise AssertionError('invalid temporal section executed')
print(json.dumps({'plan_error':plan_error,'section_error':section_error,'plan_events':[event['type'] for event in events if event['type']=='plan'],'generated':generated},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.plan_error, /時間軸/);
  assert.match(output.section_error, /時間軸/);
  assert.deepEqual(output.plan_events, []);
  assert.deepEqual(output.generated, []);
});

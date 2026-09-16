import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');

function python(body: string) {
  const result = spawnSync(
    'python3',
    ['-c', `import json,sys\nsys.path.insert(0,${JSON.stringify(MODULE_DIR)})\n${body}`],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('consultation, dashboard planning and meeting report use the current rounded Vertex cost', () => {
  const output = python(`
import analysis_workflows as workflows
usage={"input_tokens":1000,"output_tokens":1000}
workflows.planner.propose_consultation=lambda *_args,**_kwargs:({},usage)
workflows.planner.propose_dashboard=lambda *_args,**_kwargs:({},usage)
workflows.meeting.generate=lambda *_args,**_kwargs:({},usage)
workflows.analysis_contract_context.planner_context=lambda _contract:"context"
workflows.analysis_contract_context.planning_period=lambda _contract:{}
workflows.analysis_contract_context.bind_specification=lambda plan,_contract:plan
contract=object()
events=[]
workflows.consult(
 object(),workflows.report.DEFAULT_MODEL,"question",[],events.append,
 contract=contract,check_cancelled=lambda:None,
)
workflows.plan_dashboard(
 object(),workflows.report.DEFAULT_MODEL,"question",{},events.append,
 contract=contract,analysis_plan=None,revision_instruction=None,check_cancelled=lambda:None,
)
workflows.generate_meeting_report(
 object(),workflows.report.DEFAULT_MODEL,{"build_revision":"build-1"},"build-1",events.append,
 check_cancelled=lambda:None,
)
print(json.dumps([
 event["cost_jpy"] for event in events
 if event["type"] in {"consultation","plan","meeting_report"}
]))
`);
  assert.deepEqual(output, [1.395, 1.395, 1.395]);
});

test('SQL generation returns and emits the current Vertex cost', () => {
  const output = python(`
import section_execution as execution
from analysis_contract_context import AnalysisExecutionPolicy
usage={"input_tokens":1000,"output_tokens":1000}
table="alpha.dataset.records"
sql="SELECT COUNT(*) AS metric_value FROM "+chr(96)+table+chr(96)
policy=AnalysisExecutionPolicy(frozenset({table}),frozenset({table}),100,10)
contract=object()
execution.analysis_contract_context.execution_policy=lambda _contract:policy
execution.analysis_contract_context.sql_rules=lambda _contract:"rules"
execution.analysis_contract_context.planning_period=lambda _contract:None
execution.report.generate_request=lambda *_args,**_kwargs:({"sql":sql,"reason":"集計","undefined_terms":[]},usage)
execution.report.generation_request=lambda *_args,**_kwargs:"analysis request"
execution.report.validate_sql=lambda value,_dataset,**_kwargs:(value,None)
execution.sql_contracts.validate_generated_dashboard_sql=lambda *_args,**_kwargs:None
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
execution.sql_contracts.validate_dashboard_dry_run_schema=lambda *_args,**_kwargs:None
execution.report.exec_bq=lambda *_args,**_kwargs:(([(1,)], ["metric_value"]),None)
execution.visualization_results.dashboard_visualization=lambda *_args:"scalar"
events=[]
cost=execution.run_section(
 {"shape":{"columns":["metric_value"]}}, events.append,
 client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
 contract=contract,max_result_rows=10,
)
result=next(event for event in events if event["type"]=="result")
print(json.dumps({"returned":cost,"emitted":result["cost_jpy"]}))
`);
  assert.deepEqual(output, { returned: 1.3949999999999998, emitted: 1.395 });
});

test('one SQL repair adds its Vertex cost before the result event', () => {
  const output = python(`
import section_execution as execution
from analysis_contract_context import AnalysisExecutionPolicy
initial_usage={"input_tokens":1000,"output_tokens":1000}
repair_usage={"input_tokens":2000,"output_tokens":2000}
table="alpha.dataset.records"
initial="SELECT COUNT(*) AS metric_value FROM "+chr(96)+table+chr(96)
repaired="SELECT COUNT(1) AS metric_value FROM "+chr(96)+table+chr(96)
policy=AnalysisExecutionPolicy(frozenset({table}),frozenset({table}),100,10)
contract=object()
execution.analysis_contract_context.execution_policy=lambda _contract:policy
execution.analysis_contract_context.sql_rules=lambda _contract:"rules"
execution.analysis_contract_context.planning_period=lambda _contract:None
execution.report.generate_request=lambda *_args,**_kwargs:({"sql":initial,"reason":"初回","undefined_terms":[]},initial_usage)
execution.report.generation_request=lambda *_args:"analysis request"
execution.report.validate_sql=lambda value,_dataset,**_kwargs:(value,None)
checks=[]
def validate(_section,_sql):
 checks.append(_sql)
 if len(checks)==1:raise execution.sql_contracts.SQLContractError("shape mismatch")
execution.sql_contracts.validate_generated_dashboard_sql=validate
execution.report.repair=lambda *_args,**_kwargs:({"sql":repaired,"reason":"修正","undefined_terms":[]},repair_usage)
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
execution.sql_contracts.validate_dashboard_dry_run_schema=lambda *_args:None
execution.report.exec_bq=lambda *_args,**_kwargs:(([(1,)], ["metric_value"]),None)
execution.visualization_results.dashboard_visualization=lambda *_args:"scalar"
events=[]
cost=execution.run_section(
 {"source_columns":["metric_value"],"shape":{"columns":["metric_value"]}},
 events.append,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,
 contract=contract,max_result_rows=10,
)
result=next(event for event in events if event["type"]=="result")
print(json.dumps({
 "returned":cost,"emitted":result["cost_jpy"],"checked":checks,
 "stages":[event.get("stage") for event in events if event["type"]=="stage"],
}))
`);
  assert.deepEqual(output, {
    returned: 4.185,
    emitted: 4.185,
    checked: [
      'SELECT COUNT(*) AS metric_value FROM `alpha.dataset.records`',
      'SELECT COUNT(1) AS metric_value FROM `alpha.dataset.records`',
    ],
    stages: ['generate', 'validate', 'repair', 'execute'],
  });
});

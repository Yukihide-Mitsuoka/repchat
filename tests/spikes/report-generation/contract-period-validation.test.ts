import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './python-test-helpers.ts';

function validate(
  constraints: Array<{
    table: string;
    path: string[];
    field_type: string;
    partition: boolean;
  }>,
  sqls: string[],
) {
  const result = python(`
import analysis_contract_context as context
import contract_period_validation as validation
from analysis_schema_policy import AnalysisFieldPolicy
payload=json.loads(${JSON.stringify(JSON.stringify({ constraints, sqls }))})
constraints=tuple(context.AnalysisPeriodConstraint(item["table"],tuple(item["path"]),item["field_type"],item["partition"]) for item in payload["constraints"])
policy=context.AnalysisPeriodPolicy("2026-08-30","2026-09-02","Asia/Tokyo",constraints)
fields=tuple(AnalysisFieldPolicy(item.table,item.path,"STRING" if item.field_type=="DATE_SHARD" else item.field_type,"REQUIRED",False,False) for item in constraints)
execution=context.AnalysisExecutionPolicy(frozenset(item.table for item in constraints),frozenset(item.table for item in constraints),100,10,policy,fields)
print(json.dumps({
 "diagnostics":[validation.contract_period_diagnostic(sql,execution) for sql in payload["sqls"]],
 "guidance":validation.contract_period_repair_guidance(policy),
},ensure_ascii=False))
`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { diagnostics: string[]; guidance: string };
}

const table = 'alpha.dataset.records';

test('date-shard constraints require the exact contract envelope in a WHERE clause', () => {
  const output = validate(
    [{ table, path: ['_TABLE_SUFFIX'], field_type: 'DATE_SHARD', partition: true }],
    [
      "SELECT 1 FROM `alpha.dataset.records` WHERE _TABLE_SUFFIX BETWEEN '20260830' AND '20260902'",
      "SELECT '_TABLE_SUFFIX BETWEEN \\'20260830\\' AND \\'20260902\\'' AS claimed FROM `alpha.dataset.records`",
      "SELECT 1 FROM `alpha.dataset.records` /* WHERE _TABLE_SUFFIX BETWEEN '20260830' AND '20260902' */",
      "SELECT 1 FROM `alpha.dataset.records` WHERE note = \"_TABLE_SUFFIX BETWEEN '20260830' AND '20260902'\"",
      "SELECT 1 FROM `alpha.dataset.records` WHERE _TABLE_SUFFIX BETWEEN '20260831' AND '20260902'",
      "SELECT 1 FROM `alpha.dataset.records` a JOIN `alpha.dataset.records` b ON a.id=b.id WHERE a._TABLE_SUFFIX BETWEEN '20260830' AND '20260902'",
    ],
  );
  assert.equal(output.diagnostics[0], '');
  assert.match(output.guidance, /_TABLE_SUFFIX BETWEEN '20260830' AND '20260902'/);
  for (const diagnostic of output.diagnostics.slice(1)) {
    assert.match(diagnostic, /共通分析契約の期間・partition制約/);
  }
});

test('DATE, DATETIME and TIMESTAMP constraints use generic type-specific bounds', () => {
  const output = validate(
    [
      { table, path: ['created_on'], field_type: 'DATE', partition: true },
      { table, path: ['payload', 'observed_at'], field_type: 'DATETIME', partition: false },
      { table, path: ['occurred_at'], field_type: 'TIMESTAMP', partition: false },
    ],
    [
      `SELECT 1 FROM \`alpha.dataset.records\` AS r WHERE
       r.\`created_on\` BETWEEN DATE '2026-08-30' AND DATE '2026-09-02'
       AND r.payload.observed_at >= DATETIME '2026-08-30 00:00:00'
       AND r.payload.observed_at < DATETIME '2026-09-03 00:00:00'
       AND r.occurred_at >= TIMESTAMP('2026-08-30 00:00:00', 'Asia/Tokyo')
       AND r.occurred_at < TIMESTAMP('2026-09-03 00:00:00', 'Asia/Tokyo')`,
      `SELECT
       created_on BETWEEN DATE '2026-08-30' AND DATE '2026-09-02' AS date_claim,
       payload.observed_at >= DATETIME '2026-08-30 00:00:00' AS datetime_claim,
       occurred_at >= TIMESTAMP('2026-08-30 00:00:00', 'Asia/Tokyo') AS timestamp_claim
       FROM \`alpha.dataset.records\``,
      `SELECT 1 FROM \`alpha.dataset.records\` WHERE
       created_on BETWEEN DATE '2026-08-30' AND DATE '2026-09-02'
       AND payload.observed_at >= DATETIME '2026-08-30 00:00:00'
       AND payload.observed_at < DATETIME '2026-09-03 00:00:00'`,
    ],
  );
  assert.equal(output.diagnostics[0], '');
  assert.match(output.diagnostics[1]!, /created_on/);
  assert.match(output.diagnostics[1]!, /payload\.observed_at/);
  assert.match(output.diagnostics[1]!, /occurred_at/);
  assert.match(output.diagnostics[2]!, /occurred_at/);
  assert.doesNotMatch(output.diagnostics[2]!, /created_on/);
  assert.doesNotMatch(output.diagnostics[2]!, /payload\.observed_at/);
  assert.match(output.guidance, /TIMESTAMP\('2026-08-30 00:00:00', 'Asia\/Tokyo'\)/);
});

test('contract-bound execution derives period checks only from the contract', () => {
  const result = python(`
import section_execution as execution
import analysis_contract_context as context
from analysis_schema_policy import AnalysisFieldPolicy
table="alpha.dataset.records"
constraints=(context.AnalysisPeriodConstraint(table,("created_on",),"DATE",True),context.AnalysisPeriodConstraint(table,("occurred_at",),"TIMESTAMP",False))
period=context.AnalysisPeriodPolicy("2026-09-01","2026-09-02","Asia/Tokyo",constraints)
fields=(AnalysisFieldPolicy(table,("created_on",),"DATE","REQUIRED",False,False),AnalysisFieldPolicy(table,("occurred_at",),"TIMESTAMP","REQUIRED",False,False))
policy=context.AnalysisExecutionPolicy(frozenset({table}),frozenset({table}),100,10,period,fields)
execution.analysis_contract_context.execution_policy=lambda _contract:policy
execution.analysis_contract_context.sql_rules=lambda _contract:"rules"
initial="SELECT COUNT(*) AS metric_value FROM "+chr(96)+table+chr(96)+" WHERE created_on BETWEEN DATE '2026-09-01' AND DATE '2026-09-01'"
repaired="SELECT COUNT(*) AS metric_value FROM "+chr(96)+table+chr(96)+" WHERE created_on BETWEEN DATE '2026-09-01' AND DATE '2026-09-02' AND occurred_at >= TIMESTAMP('2026-09-01 00:00:00', 'Asia/Tokyo') AND occurred_at < TIMESTAMP('2026-09-03 00:00:00', 'Asia/Tokyo')"
usage={"input_tokens":1,"output_tokens":1}
execution.report.generate_request=lambda *_args,**_kwargs:({"sql":initial,"reason":"initial","undefined_terms":[]},usage)
execution.report.generation_request=lambda *_args:"request"
execution.report.validate_sql=lambda sql,**_kwargs:(sql,None)
diagnostics=[]
execution.report.repair=lambda _client,_model,_request,_sql,diagnostic,_rules:(diagnostics.append(diagnostic) or ({"sql":repaired,"reason":"repaired","undefined_terms":[]},usage))
execution.report.inspect_bq_schema=lambda *_args,**_kwargs:([("metric_value","INT64")],None)
executed=[]
execution.report.exec_bq=lambda _bq,sql,**_kwargs:(executed.append(sql) or (([(1,)], ["metric_value"]),None))
execution.visualization_results.dashboard_visualization=lambda *_args:"scalar"
section={"title":"集計","planned_visualization":"scorecard","source_columns":["metric_value"],"nonnull_metric_columns":["metric_value"],"shape":{"columns":["値"]}}
events=[]
execution.run_section(section,events.append,client=object(),bq=object(),model=execution.report.DEFAULT_MODEL,contract=object(),max_result_rows=50,context={"operation":"dashboard"})
print(json.dumps({"diagnostics":diagnostics,"executed":executed,"stages":[event.get("stage") for event in events if event["type"]=="stage"]},ensure_ascii=False))
`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.diagnostics.length, 1);
  assert.match(output.diagnostics[0], /created_on BETWEEN DATE '2026-09-01' AND DATE '2026-09-02'/);
  assert.match(output.diagnostics[0], /occurred_at >= TIMESTAMP/);
  assert.equal(output.executed.length, 1);
  assert.deepEqual(output.stages, ['generate', 'validate', 'repair', 'execute']);
});

test('a contract without a period does not invent temporal requirements', () => {
  const result = python(`
import contract_period_validation as validation
from analysis_contract_context import AnalysisExecutionPolicy
execution=AnalysisExecutionPolicy(frozenset(),frozenset(),1,1)
print(json.dumps({"diagnostic":validation.contract_period_diagnostic("SELECT 1",execution),"guidance":validation.contract_period_repair_guidance(execution.period)}))
`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { diagnostic: '', guidance: '' });
});

test('period validation rejects fields absent from the canonical schema policy', () => {
  const result = python(`
import analysis_contract_context as context
import contract_period_validation as validation
from analysis_schema_policy import AnalysisFieldPolicy
table="alpha.dataset.records"
constraint=context.AnalysisPeriodConstraint(table,("created_on",),"DATE",True)
period=context.AnalysisPeriodPolicy("2026-09-01","2026-09-02","UTC",(constraint,))
variants=(
 (),
 (AnalysisFieldPolicy(table,("other",),"DATE","REQUIRED",False,False),),
 (AnalysisFieldPolicy(table,("created_on",),"TIMESTAMP","REQUIRED",False,False),),
 (AnalysisFieldPolicy(table,("created_on",),"DATE","REPEATED",True,False),),
 (AnalysisFieldPolicy(table,("created_on",),"DATE","REQUIRED",False,True),),
)
sql="SELECT 1 FROM "+chr(96)+table+chr(96)+" WHERE created_on BETWEEN DATE '2026-09-01' AND DATE '2026-09-02'"
diagnostics=[]
for fields in variants:
 execution=context.AnalysisExecutionPolicy(frozenset({table}),frozenset({table}),100,10,period,fields)
 diagnostics.append(validation.contract_period_diagnostic(sql,execution))
print(json.dumps(diagnostics,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  for (const diagnostic of JSON.parse(result.stdout)) {
    assert.match(diagnostic, /schema policy/);
  }
});

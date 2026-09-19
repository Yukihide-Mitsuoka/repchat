import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract_context as context
import sql_contract_validation as sql_contracts
from analysis_contract import AnalysisContract,expression_for_field,fingerprint_contract_content
table='alpha.dataset.records'
def ref(field):return {'table':table,'field':field}
fields=[
 {'name':'primary_time','type':'DATE','mode':'NULLABLE'},
 {'name':'secondary_time','type':'TIMESTAMP','mode':'NULLABLE'},
 {'name':'category','type':'STRING','mode':'NULLABLE'},
]
metadata={'version':1,'tables':[{'table':table,'fields':fields}]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def dimension(field):return {'field':ref(field),'expr':expression_for_field(ref(field))}
content={
 'version':1,
 'schema':{'fingerprint':schema_fingerprint,'retrieved_at':'2026-09-19T00:00:00+00:00','metadata':metadata},
 'semantics':{'grain':{},'identifiers':{},'dimensions':{
  'Primary time':dimension('primary_time'),
  'Secondary time':dimension('secondary_time'),
  'Category':dimension('category'),
 },'measures':{},'metrics':{'Total':{}},'relationships':[]},
 'period':{'business_time':ref('primary_time'),'timezone':'UTC','range':{'start':'2026-01-01','end':'2026-01-31'},'partitions':[]},
 'limits':{'maximum_bytes_billed':100,'maximum_result_rows':100},
}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(',',':'))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
policy=context.execution_policy(contract)
section={
 'title':'時系列',
 'planned_visualization':'line',
 'source_columns':['time_value','metric_value'],
 'nonnull_metric_columns':['metric_value'],
 'max_result_rows':20,
 'semantic_dimensions':['Primary time'],
 'semantic_measures':['Total'],
}
def check(sql):
 try:
  sql_contracts.validate_generated_dashboard_sql(section,sql,policy)
  return ''
 except sql_contracts.SQLContractError as error:
  return str(error)
def check_without_policy(sql):
 try:
  sql_contracts.validate_generated_dashboard_sql(section,sql)
  return ''
 except sql_contracts.SQLContractError as error:
  return str(error)
`;

test('temporal SQL output is traced to the selected contract field without guessing aliases', () => {
  const result = python(
    setup +
      `
suffix='GROUP BY time_value ORDER BY time_value LIMIT 20'
source=chr(96)+table+chr(96)
queries={
 'selected':f'''SELECT DATE(t.primary_time) AS time_value, COUNT(*) AS metric_value
FROM {source} AS t {suffix}''',
 'other_time':f'''SELECT DATE(t.secondary_time) AS time_value, COUNT(*) AS metric_value
FROM {source} AS t {suffix}''',
 'comment_decoy':f'''SELECT DATE(t.secondary_time) /* t.primary_time */ AS time_value, COUNT(*) AS metric_value
FROM {source} AS t {suffix}''',
 'mixed_fields':f'''SELECT COALESCE(DATE(t.primary_time), DATE(t.secondary_time)) AS time_value, COUNT(*) AS metric_value
FROM {source} AS t {suffix}''',
 'cte_alias':f'''WITH source AS (
 SELECT t.primary_time AS time_key FROM {source} AS t
)
SELECT s.time_key AS time_value, COUNT(*) AS metric_value
FROM source AS s {suffix}''',
}
observed={name:check(sql) for name,sql in queries.items()}
observed['missing_policy']=check_without_policy(queries['selected'])
print(json.dumps(observed,ensure_ascii=False))
`,
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, string>;
  assert.equal(output.selected, '');
  for (const key of [
    'other_time',
    'comment_decoy',
    'mixed_fields',
    'cte_alias',
    'missing_policy',
  ]) {
    assert.match(output[key] ?? '', /来歴/, key);
  }
});

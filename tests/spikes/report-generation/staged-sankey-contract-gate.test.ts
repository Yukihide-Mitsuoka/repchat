import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

test('staged Sankey stays unavailable until a common contract can prove complete ordered paths', () => {
  const result = python(`
import json
import analysis_planner as planner
from visualization_sections import build_planned_analysis_section

def panel(chart):
 return {
  'id':'P1','title':'経路','kpi':'件数','chart':chart,'decision':'経路を判断する',
  'reason':'flowを比較するため','execution_prompt':'契約上の有向flowを集計する',
  'dimensions':['Source','Target'],'measures':['Count'],'layout_row':1,'layout_weight':1,
 }

raw={
 'objective_summary':'経路を判断する','audience':'責任者','comparison':'経路比較',
 'hypotheses':['flowに偏りがある'],'clarifications':[],'panels':[panel('sankey')],
}
answers={'audience':'責任者','comparison':'経路比較','business_goal':'flow改善'}
errors={}
try:planner.normalize_dashboard_plan(raw,'経路を分析する',None,answers)
except planner.PlannerError as error:errors['dashboard']=str(error)
else:raise AssertionError('staged Sankey dashboard accepted')
consultation={
 'title':'経路','objective':'経路を判断する','comparison':'経路比較','chart':'sankey_vertical',
 'execution_prompt':'契約上の順序付き経路を集計する','reason':'経路を比較するため',
 'dimensions':['Source','Target'],'measures':['Count'],
}
try:planner.confirm_analysis_specification(consultation)
except planner.PlannerError as error:errors['consultation']=str(error)
else:raise AssertionError('staged Sankey consultation accepted')
try:build_planned_analysis_section(panel('sankey'))
except ValueError as error:errors['section']=str(error)
else:raise AssertionError('staged Sankey SQL section accepted')

flow_raw={**raw,'panels':[panel('flow_sankey')]}
flow_plan=planner.normalize_dashboard_plan(flow_raw,'経路を分析する',None,answers)
flow_section=build_planned_analysis_section(flow_plan['panels'][0])
dashboard_schema=planner._dashboard_response_schema({})['properties']['panels']['items']['properties']['visualization']['properties']['chart']['enum']
consultation_schema=planner._consultation_schema()['properties']['recommendations']['items']['properties']['visualization']['properties']['chart']['enum']
print(json.dumps({
 'errors':errors,
 'dashboard_has_staged':any(chart in dashboard_schema for chart in ['sankey','sankey_vertical']),
 'consultation_has_staged':any(chart in consultation_schema for chart in ['sankey','sankey_vertical']),
 'flow_chart':flow_plan['panels'][0]['chart'],
 'flow_columns':flow_section['source_columns'],
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  for (const diagnostic of Object.values(output.errors) as string[]) {
    assert.match(diagnostic, /完全.*経路.*契約/);
  }
  assert.equal(output.dashboard_has_staged, false);
  assert.equal(output.consultation_has_staged, false);
  assert.equal(output.flow_chart, 'flow_sankey');
  assert.deepEqual(output.flow_columns, ['source', 'target', 'metric_value']);
});

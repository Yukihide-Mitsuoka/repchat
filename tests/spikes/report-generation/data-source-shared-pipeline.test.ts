import assert from 'node:assert/strict';
import test from 'node:test';
import { python } from './python-test-helpers.ts';

test('one canonical contract reaches planning without a target selector or fallback', () => {
  const result = python(`
import hashlib,json
import analysis_workflows as workflows
from analysis_contract import AnalysisContract,fingerprint_contract_content
metadata={"version":1,"tables":[{"table":"project.dataset.records","fields":[{"name":"amount","type":"NUMERIC","mode":"NULLABLE"}]}]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
content={"version":1,"schema":{"fingerprint":schema_fingerprint,"retrieved_at":"2026-09-14T00:00:00+00:00","metadata":metadata},"semantics":{"grain":{},"identifiers":{},"dimensions":{},"measures":{},"metrics":{"total_amount":{"expression":"SUM(amount)"}},"relationships":[]},"period":None,"limits":{"maximum_bytes_billed":1000,"maximum_result_rows":20}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
calls=[]
def propose(_client,_model,_question,period,context,_answers,**kwargs):
 calls.append({"period":period,"context":context,"allowed_metrics":kwargs["allowed_metrics"]})
 return {"revision":"plan-123456789abc","objective":"合計を確認する"},{"input_tokens":1,"output_tokens":1}
workflows.planner.propose_dashboard=propose
events=[]
workflows.plan_dashboard(object(),workflows.report.DEFAULT_MODEL,"合計を確認する",{},events.append,contract=contract,analysis_plan=None,revision_instruction=None,check_cancelled=lambda:None)
plan=events[-1]["plan"]
assert calls[0]["period"]=={"from":"","to":"","label":"期間指定なし"}
assert encoded in calls[0]["context"]
assert calls[0]["allowed_metrics"]==("total_amount",)
assert plan["analysis_contract_fingerprint"]==contract.fingerprint
try:
 workflows.plan_dashboard(object(),workflows.report.DEFAULT_MODEL,"合計を確認する",{},lambda _event:None,contract=contract,analysis_plan={**plan,"analysis_contract_fingerprint":"0"*64},revision_instruction="変更",check_cancelled=lambda:None)
except workflows.AnalysisWorkflowError as error:
 mismatch=str(error)
else:
 raise AssertionError("mismatched contract accepted")
empty_content={**content,"semantics":{**content["semantics"],"metrics":{}}}
empty_encoded=json.dumps(empty_content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
empty_contract=AnalysisContract(empty_encoded,fingerprint_contract_content(empty_content))
try:
 workflows.plan_dashboard(object(),workflows.report.DEFAULT_MODEL,"合計を確認する",{},lambda _event:None,contract=empty_contract,analysis_plan=None,revision_instruction=None,check_cancelled=lambda:None)
except workflows.AnalysisWorkflowError as error:
 no_measures=str(error)
else:
 raise AssertionError("contract without measures reached planning")
print(json.dumps({"mismatch":mismatch,"no_measures":no_measures},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.mismatch, /current analysis contract/);
  assert.match(output.no_measures, /実行可能な指標がない/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract_context as c
from analysis_contract import AnalysisContract
content={"version":1,"schema":{"fingerprint":"schema-a","retrieved_at":"2026-09-07T00:00:00+00:00","metadata":{"tables":[]}},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":{"business_time":{"table":"p.d.t","field":"at"},"timezone":"UTC","range":{"start":"2026-01-01","end":"2026-01-31"},"partitions":[]},"limits":{"maximum_bytes_billed":100,"maximum_result_rows":10}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,hashlib.sha256(encoded.encode()).hexdigest())
`;

test('planner and SQL roles receive the same canonical contract', () => {
  const result = python(
    setup +
      `
planner=c.planner_context(contract)
sql=c.sql_rules(contract)
assert encoded in planner and encoded in sql
assert contract.fingerprint in planner and contract.fingerprint in sql
assert "未信頼" in planner and "未信頼" in sql
assert "固定の分析候補" in planner
assert "SELECT *" in sql
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('binding creates an independent revision tied to the contract', () => {
  const result = python(
    setup +
      `
source={"revision":"plan-123456789abc","objective":"比較"}
bound=c.bind_specification(source,contract)
assert source=={"revision":"plan-123456789abc","objective":"比較"}
assert bound["analysis_contract_fingerprint"]==contract.fingerprint
assert bound["revision"].startswith("plan-") and bound["revision"]!=source["revision"]
assert c.bind_specification(bound,contract)==bound
c.require_specification_contract(bound,contract)
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('insight revisions use the same binding contract', () => {
  const result = python(
    setup +
      `
bound=c.bind_specification({"revision":"insight-abcdef123456","title":"分析"},contract)
assert bound["revision"].startswith("insight-")
c.require_specification_contract(bound,contract)
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('forged contracts and mismatched specifications fail closed', () => {
  const result = python(
    setup +
      `
other_content={**content,"limits":{"maximum_bytes_billed":200,"maximum_result_rows":10}}
other_encoded=json.dumps(other_content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
other=AnalysisContract(other_encoded,hashlib.sha256(other_encoded.encode()).hexdigest())
for action in (
 lambda:c.planner_context(AnalysisContract(encoded,"0"*64)),
 lambda:c.sql_rules(AnalysisContract("{}",hashlib.sha256(b"{}").hexdigest())),
 lambda:c.sql_rules(AnalysisContract('{"version": 1}',hashlib.sha256(b'{"version": 1}').hexdigest())),
 lambda:c.sql_rules(AnalysisContract('{"limits":{},"period":{},"schema":{},"semantics":{},"unexpected":true,"version":1}',hashlib.sha256(b'{"limits":{},"period":{},"schema":{},"semantics":{},"unexpected":true,"version":1}').hexdigest())),
 lambda:c.bind_specification({"revision":"bad"},contract),
 lambda:c.bind_specification({"revision":"plan-123456789abc","analysis_contract_fingerprint":other.fingerprint},contract),
 lambda:c.require_specification_contract({},contract),
):
 try:action()
 except c.AnalysisContextError:pass
 else:raise AssertionError("invalid context accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

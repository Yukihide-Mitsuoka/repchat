import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract_context as c
from analysis_contract import AnalysisContract,fingerprint_contract_content
content={"version":1,"schema":{"fingerprint":"schema-a","retrieved_at":"2026-09-07T00:00:00+00:00","metadata":{"tables":[]}},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":{"business_time":{"table":"p.d.t","field":"at"},"timezone":"UTC","range":{"start":"2026-01-01","end":"2026-01-31"},"partitions":[]},"limits":{"maximum_bytes_billed":100,"maximum_result_rows":10}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
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
assert "_TABLE_SUFFIX BETWEEN" in sql
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

test('SQL context does not invent time constraints for a time-free contract', () => {
  const result = python(
    setup +
      `
time_free={**content,"period":None}
time_free_json=json.dumps(time_free,ensure_ascii=False,sort_keys=True,separators=(",",":"))
time_free_contract=AnalysisContract(time_free_json,fingerprint_contract_content(time_free))
planner=c.planner_context(time_free_contract);sql=c.sql_rules(time_free_contract)
assert "適用可能な場合の期間" in planner
assert "periodはnull" in sql and "期間、timezone、partition疑似列を推測して追加しない" in sql
assert "periodのbusiness_timeで対象期間を絞り" not in sql
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('execution policy is derived only from canonical contract scope and limits', () => {
  const result = python(`
import hashlib,json
import analysis_contract_context as c
from analysis_contract import AnalysisContract,fingerprint_contract_content
ordinary="alpha.dataset.orders"
pattern="alpha.dataset.events_*"
members=["alpha.dataset.events_20260912","alpha.dataset.events_20260913"]
metadata={"version":1,"tables":[
 {"table":ordinary,"fields":[]},
 {"table":pattern,"fields":[],"dateShards":{"suffixFormat":"YYYYMMDD","startSuffix":"20260912","endSuffix":"20260913","members":members}},
]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
content={"version":1,"schema":{"fingerprint":schema_fingerprint,"retrieved_at":"2026-09-13T00:00:00+00:00","metadata":metadata},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":None,"limits":{"maximum_bytes_billed":123,"maximum_result_rows":7}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
policy=c.execution_policy(contract)
assert policy.query_tables==frozenset({ordinary,pattern})
assert policy.job_tables==frozenset({ordinary,pattern,*members})
assert policy.maximum_bytes_billed==123 and policy.maximum_result_rows==7
for change in ("schema_fingerprint","empty_tables","boolean_limit","bad_member","member_type","unsafe_table"):
 invalid=json.loads(encoded)
 if change=="schema_fingerprint":invalid["schema"]["fingerprint"]="0"*64
 if change=="empty_tables":invalid["schema"]["metadata"]["tables"]=[]
 if change=="boolean_limit":invalid["limits"]["maximum_bytes_billed"]=True
 if change=="bad_member":invalid["schema"]["metadata"]["tables"][1]["dateShards"]["members"]=["alpha.dataset.other"]
 if change=="member_type":invalid["schema"]["metadata"]["tables"][1]["dateShards"]["members"]=[{}]
 if change=="unsafe_table":invalid["schema"]["metadata"]["tables"][0]["table"]="alpha.dataset.orders;"
 if change in ("empty_tables","bad_member","member_type","unsafe_table"):
  invalid["schema"]["fingerprint"]=hashlib.sha256(json.dumps(invalid["schema"]["metadata"],ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 invalid_encoded=json.dumps(invalid,ensure_ascii=False,sort_keys=True,separators=(",",":"))
 try:c.execution_policy(AnalysisContract(invalid_encoded,fingerprint_contract_content(invalid)))
 except c.AnalysisContextError:pass
 else:raise AssertionError("invalid execution policy accepted")
print("ok")
`);
  assert.equal(result.status, 0, result.stderr);
});

test('forged contracts and mismatched specifications fail closed', () => {
  const result = python(
    setup +
      `
other_content={**content,"limits":{"maximum_bytes_billed":200,"maximum_result_rows":10}}
other_encoded=json.dumps(other_content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
other=AnalysisContract(other_encoded,fingerprint_contract_content(other_content))
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract_context as c
import analysis_dashboard_plan as planner
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
period=c.planning_period(contract)
assert encoded in planner and encoded in sql
assert contract.fingerprint in planner and contract.fingerprint in sql
assert "未信頼" in planner and "未信頼" in sql
assert "固定の分析候補" in planner
assert "SELECT *" in sql
assert "一意なASCII alias" in sql and "modeがREPEATEDのfieldだけをUNNEST" in sql
assert "_TABLE_SUFFIX BETWEEN" in sql
assert period=={"from":"2026-01-01","to":"2026-01-31","label":"2026-01-01〜2026-01-31"}
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
raw={"objective_summary":"比較する","audience":"責任者","comparison":"区分間","hypotheses":["差がある"],"clarifications":[],"panels":[{"title":"集計","kpi":"合計","chart":"scorecard","decision":"判断する","reason":"必要","execution_prompt":"合計を出す","dimensions":[],"measures":["合計"],"layout_row":1,"layout_weight":1}]}
normalized=planner.normalize_dashboard_plan(raw,"比較する",{"from":"20260101","to":"20260131","label":"2026年1月"},{"audience":"責任者"})
assert "profile" not in normalized
assert planner.normalize_dashboard_plan(raw,"比較する",None,{"audience":"責任者"})["period"] is None
confirmed=planner.confirm_dashboard_plan(c.bind_specification(normalized,contract))
assert confirmed["analysis_contract_fingerprint"]==contract.fingerprint
assert "profile" not in confirmed
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
assert c.planning_period(time_free_contract) is None
import analysis_planner as dashboard
request=dashboard.dashboard_planning_request("全体を把握する",None,planner,{})
assert "対象期間: なし" in request and "期間、日付列、比較期間を推測して追加しない" in request
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
 {"table":ordinary,"fields":[{"name":"record_id","type":"STRING","mode":"REQUIRED"}]},
 {"table":pattern,"fields":[{"name":"event_id","type":"STRING","mode":"REQUIRED"}],"dateShards":{"suffixFormat":"YYYYMMDD","startSuffix":"20260912","endSuffix":"20260913","members":members}},
]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
content={"version":1,"schema":{"fingerprint":schema_fingerprint,"retrieved_at":"2026-09-13T00:00:00+00:00","metadata":metadata},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":{"business_time":{"table":pattern,"field":"_TABLE_SUFFIX"},"timezone":"UTC","range":{"start":"2026-09-12","end":"2026-09-13"},"partitions":[{"table":pattern,"field":"_TABLE_SUFFIX"}]},"limits":{"maximum_bytes_billed":123,"maximum_result_rows":7}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
contract=AnalysisContract(encoded,fingerprint_contract_content(content))
policy=c.execution_policy(contract)
assert policy.query_tables==frozenset({ordinary,pattern})
assert policy.job_tables==frozenset({ordinary,pattern,*members})
assert policy.maximum_bytes_billed==123 and policy.maximum_result_rows==7
assert policy.period.constraints[0].field_type=="DATE_SHARD" and policy.period.constraints[0].partition
assert {(field.table,field.path,field.field_type) for field in policy.schema_fields}=={(ordinary,("record_id",),"STRING"),(pattern,("_TABLE_SUFFIX",),"STRING"),(pattern,("event_id",),"STRING")}
for change in ("schema_fingerprint","empty_tables","boolean_limit","bad_member","member_type","unsafe_table","missing_period","bad_field"):
 invalid=json.loads(encoded)
 if change=="schema_fingerprint":invalid["schema"]["fingerprint"]="0"*64
 if change=="empty_tables":invalid["schema"]["metadata"]["tables"]=[]
 if change=="boolean_limit":invalid["limits"]["maximum_bytes_billed"]=True
 if change=="bad_member":invalid["schema"]["metadata"]["tables"][1]["dateShards"]["members"]=["alpha.dataset.other"]
 if change=="member_type":invalid["schema"]["metadata"]["tables"][1]["dateShards"]["members"]=[{}]
 if change=="unsafe_table":invalid["schema"]["metadata"]["tables"][0]["table"]="alpha.dataset.orders;"
 if change=="missing_period":invalid["period"]=None
 if change=="bad_field":invalid["schema"]["metadata"]["tables"][0]["fields"]=[{"name":"amount","type":"UNKNOWN","mode":"NULLABLE"}]
 if change in ("empty_tables","bad_member","member_type","unsafe_table","bad_field"):
  invalid["schema"]["fingerprint"]=hashlib.sha256(json.dumps(invalid["schema"]["metadata"],ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 invalid_encoded=json.dumps(invalid,ensure_ascii=False,sort_keys=True,separators=(",",":"))
 try:c.execution_policy(AnalysisContract(invalid_encoded,fingerprint_contract_content(invalid)))
 except c.AnalysisContextError:pass
 else:raise AssertionError("invalid execution policy accepted")
print("ok")
`);
  assert.equal(result.status, 0, result.stderr);
});

test('execution policy derives period constraints from contract metadata instead of a profile', () => {
  const result = python(`
import hashlib,json
import analysis_contract_context as c
from analysis_contract import AnalysisContract,fingerprint_contract_content
table="alpha.dataset.records"
metadata={"version":1,"tables":[{"table":table,"fields":[{"name":"occurred_at","type":"TIMESTAMP","mode":"REQUIRED"},{"name":"created_on","type":"DATE","mode":"REQUIRED"}],"timePartitioning":{"type":"DAY","field":"created_on"},"requirePartitionFilter":True}]}
schema_fingerprint=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
period={"business_time":{"table":table,"field":"occurred_at"},"timezone":"Asia/Tokyo","range":{"start":"2026-09-01","end":"2026-09-02"},"comparison":{"start":"2026-08-30","end":"2026-08-31"},"partitions":[{"table":table,"path":["created_on"]}]}
content={"version":1,"schema":{"fingerprint":schema_fingerprint,"retrieved_at":"2026-09-13T00:00:00+00:00","metadata":metadata},"semantics":{"grain":{},"metrics":{},"dimensions":{},"relationships":[]},"period":period,"limits":{"maximum_bytes_billed":100,"maximum_result_rows":10}}
encoded=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(",",":"))
policy=c.execution_policy(AnalysisContract(encoded,fingerprint_contract_content(content)))
assert policy.period.start=="2026-08-30" and policy.period.end=="2026-09-02"
assert policy.period.timezone=="Asia/Tokyo"
observed={(item.table,item.path,item.field_type,item.partition) for item in policy.period.constraints}
assert observed=={(table,("occurred_at",),"TIMESTAMP",False),(table,("created_on",),"DATE",True)}
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

test('schema policy preserves exact nested paths and inherited controls', () => {
  const result = python(`
import analysis_schema_policy as policy
tables=[
 {"table":"alpha.dataset.records","fields":[
  {"name":"record_id","type":"STRING","mode":"REQUIRED"},
  {"name":"items","type":"RECORD","mode":"REPEATED","policyTags":{"names":["tag-a"]},"fields":[
   {"name":"amount","type":"NUMERIC","mode":"NULLABLE"},
   {"name":"secret","type":"STRING","mode":"NULLABLE"},
  ]},
 ],"timePartitioning":{"type":"DAY"}},
 {"table":"alpha.dataset.events_*","fields":[{"name":"marker","type":"BOOL","mode":"NULLABLE"}],"dateShards":{"members":["alpha.dataset.events_20260913"]}},
]
fields=policy.derive_schema_policy(tables)
print(json.dumps([{
 "table":field.table,"path":field.path,"type":field.field_type,"mode":field.mode,
 "repeated":field.repeated,"restricted":field.restricted,
} for field in fields],ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    {
      table: 'alpha.dataset.events_*',
      path: ['_TABLE_SUFFIX'],
      type: 'STRING',
      mode: 'REQUIRED',
      repeated: false,
      restricted: false,
    },
    {
      table: 'alpha.dataset.events_*',
      path: ['marker'],
      type: 'BOOL',
      mode: 'NULLABLE',
      repeated: false,
      restricted: false,
    },
    {
      table: 'alpha.dataset.records',
      path: ['_PARTITIONDATE'],
      type: 'DATE',
      mode: 'REQUIRED',
      repeated: false,
      restricted: false,
    },
    {
      table: 'alpha.dataset.records',
      path: ['items'],
      type: 'RECORD',
      mode: 'REPEATED',
      repeated: true,
      restricted: true,
    },
    {
      table: 'alpha.dataset.records',
      path: ['items', 'amount'],
      type: 'NUMERIC',
      mode: 'NULLABLE',
      repeated: true,
      restricted: true,
    },
    {
      table: 'alpha.dataset.records',
      path: ['items', 'secret'],
      type: 'STRING',
      mode: 'NULLABLE',
      repeated: true,
      restricted: true,
    },
    {
      table: 'alpha.dataset.records',
      path: ['record_id'],
      type: 'STRING',
      mode: 'REQUIRED',
      repeated: false,
      restricted: false,
    },
  ]);
});

test('schema policy rejects malformed or ambiguous field metadata', () => {
  const result = python(`
import analysis_schema_policy as policy
base={"table":"alpha.dataset.records","fields":[{"name":"value","type":"STRING","mode":"NULLABLE"}]}
cases=[
 {**base,"fields":[]},
 {**base,"fields":[base["fields"][0],{"name":"VALUE","type":"STRING","mode":"NULLABLE"}]},
 {**base,"fields":[{"name":"value","type":"UNKNOWN","mode":"NULLABLE"}]},
 {**base,"fields":[{"name":"value","type":"STRING","mode":"MANY"}]},
 {**base,"fields":[{"name":"value","type":"STRING","mode":"NULLABLE","fields":[{"name":"child","type":"STRING","mode":"NULLABLE"}]}]},
 {**base,"fields":[{"name":"value","type":"STRING","mode":"NULLABLE","fields":[]}]},
 {**base,"fields":[{"name":"value","type":"STRING","mode":"NULLABLE","policyTags":{"names":[]}}]},
 {**base,"table":"alpha.dataset.bad*name"},
 [base,base],
 {**base,"timePartitioning":"DAY"},
]
errors=[]
for value in cases:
 try:policy.derive_schema_policy(value if isinstance(value,list) else [value])
 except policy.SchemaPolicyError as error:errors.append(str(error))
 else:raise AssertionError("invalid schema policy accepted")
print(json.dumps(errors))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).length, 10);
});

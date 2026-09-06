import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import hashlib,json
import analysis_contract as a
from bigquery_schema_snapshot import SchemaSnapshot
schema={"version":1,"tables":[{"table":"example.dataset.events","location":"US","fields":[
 {"name":"occurred_at","type":"TIMESTAMP","mode":"NULLABLE"},
 {"name":"items","type":"RECORD","mode":"REPEATED","fields":[{"name":"amount","type":"NUMERIC","mode":"NULLABLE"}]}
],"timePartitioning":{"type":"DAY","field":"occurred_at"},"requirePartitionFilter":True}]}
schema_json=json.dumps(schema,ensure_ascii=False,sort_keys=True,separators=(",",":"))
snapshot=SchemaSnapshot(schema_json,hashlib.sha256(schema_json.encode()).hexdigest(),"2026-09-06T00:00:00+00:00")
semantics={"grain":{"event":{"expr":"event_id"}},"metrics":{"売上":{"expr":"SUM(items.amount)","unit":"USD","aliases":["revenue"]}},"dimensions":{},"relationships":[]}
period={"business_time":{"table":"example.dataset.events","field":"occurred_at"},"timezone":"Asia/Tokyo","range":{"start":"2026-01-01","end":"2026-01-31"},"partitions":[{"table":"example.dataset.events","field":"occurred_at"}]}
limits={"maximum_bytes_billed":1000000,"maximum_result_rows":1000}
`;

test('common contract freezes schema, semantics, period and execution limits', () => {
  const result = python(
    setup +
      `
contract=a.compile_contract(snapshot,semantics,period,limits)
content=contract.content()
assert content["schema"]["fingerprint"]==snapshot.fingerprint
assert content["semantics"]["metrics"]["売上"]["unit"]=="USD"
assert content["period"]["timezone"]=="Asia/Tokyo"
assert content["limits"]==limits
content["schema"].clear()
assert a.compile_contract(snapshot,semantics,period,limits).fingerprint==contract.fingerprint
assert contract.content()["schema"]["fingerprint"]==snapshot.fingerprint
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('business and comparison ranges are validated independently', () => {
  const result = python(
    setup +
      `
period["comparison"]={"start":"2025-12-01","end":"2025-12-31"}
assert a.compile_contract(snapshot,semantics,period,limits).content()["period"]["comparison"]["end"]=="2025-12-31"
for candidate in (
 {**period,"timezone":"Not/AZone"},
 {**period,"range":{"start":"2026-02-01","end":"2026-01-01"}},
 {**period,"range":{"start":"20260101","end":"2026-01-31"}},
 {**period,"comparison":{"start":"2025-12-01"}},
):
 try:a.compile_contract(snapshot,semantics,candidate,limits)
 except a.AnalysisContractError:pass
 else:raise AssertionError("invalid period accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('time and partition fields must exist and match inspected metadata', () => {
  const result = python(
    setup +
      `
cases=[]
for key,value in (
 ("business_time",{"table":"example.dataset.events","field":"missing"}),
 ("business_time",{"table":"example.dataset.events","field":"items.amount"}),
 ("partitions",[{"table":"example.dataset.events","field":"items.amount"}]),
 ("partitions",[{"table":"other.dataset.events","field":"occurred_at"}]),
):cases.append({**period,key:value})
cases.append({**period,"partitions":[]})
for candidate in cases:
 try:a.compile_contract(snapshot,semantics,candidate,limits)
 except a.AnalysisContractError:pass
 else:raise AssertionError("invalid field contract accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('unpartitioned tables may use business time without a partition filter', () => {
  const result = python(
    setup +
      `
schema["tables"][0].pop("timePartitioning")
schema["tables"][0]["requirePartitionFilter"]=False
schema_json=json.dumps(schema,ensure_ascii=False,sort_keys=True,separators=(",",":"))
snapshot=SchemaSnapshot(schema_json,hashlib.sha256(schema_json.encode()).hexdigest(),"2026-09-06T00:00:00+00:00")
period["partitions"]=[]
assert a.compile_contract(snapshot,semantics,period,limits).content()["period"]["partitions"]==[]
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('ingestion-time partitions use an explicit BigQuery partition pseudocolumn', () => {
  const result = python(
    setup +
      `
schema["tables"][0]["timePartitioning"]={"type":"DAY"}
schema_json=json.dumps(schema,ensure_ascii=False,sort_keys=True,separators=(",",":"))
snapshot=SchemaSnapshot(schema_json,hashlib.sha256(schema_json.encode()).hexdigest(),"2026-09-06T00:00:00+00:00")
period["partitions"]=[{"table":"example.dataset.events","field":"_PARTITIONDATE"}]
assert a.compile_contract(snapshot,semantics,period,limits).content()["period"]["partitions"][0]["field"]=="_PARTITIONDATE"
period["partitions"][0]["field"]="occurred_at"
try:a.compile_contract(snapshot,semantics,period,limits)
except a.AnalysisContractError:pass
else:raise AssertionError("physical field accepted for ingestion partition")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('relationships require inspected tables and an explicit cardinality', () => {
  const result = python(
    setup +
      `
valid={"left_table":"example.dataset.events","right_table":"example.dataset.events","condition":"left.event_id = right.event_id","cardinality":"one_to_one"}
semantics["relationships"]=[valid]
assert a.compile_contract(snapshot,semantics,period,limits).content()["semantics"]["relationships"][0]["cardinality"]=="one_to_one"
for relationship in ({**valid,"right_table":"other.dataset.events"},{**valid,"cardinality":"unknown"},{"left_table":"example.dataset.events"}):
 semantics["relationships"]=[relationship]
 try:a.compile_contract(snapshot,semantics,period,limits)
 except a.AnalysisContractError:pass
 else:raise AssertionError("invalid relationship accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('forged schema, malformed semantics and unsafe limits fail closed', () => {
  const result = python(
    setup +
      `
for bad_snapshot in (
 SchemaSnapshot(snapshot.metadata_json,"0"*64,snapshot.retrieved_at),
 SchemaSnapshot("{}",hashlib.sha256(b"{}").hexdigest(),snapshot.retrieved_at),
 SchemaSnapshot(snapshot.metadata_json,snapshot.fingerprint,"not-a-time"),
 SchemaSnapshot(snapshot.metadata_json,snapshot.fingerprint,"2026-09-06T00:00:00"),
):
 try:a.compile_contract(bad_snapshot,semantics,period,limits)
 except a.AnalysisContractError:pass
 else:raise AssertionError("forged snapshot accepted")
bad_semantics=(
 {},
 {**semantics,"metrics":{"x":{}}},
 {**semantics,"metrics":{"x":{"expr":" ","unknown":"x"}}},
 {**semantics,"metrics":{"x":{"expr":"COUNT(*)","aliases":[None]}}},
 {**semantics,"metrics":{"売上":{"expr":"COUNT(*)","aliases":["event"]}}},
)
for candidate in bad_semantics:
 try:a.compile_contract(snapshot,candidate,period,limits)
 except a.AnalysisContractError:pass
 else:raise AssertionError("invalid semantics accepted")
for candidate in ({},{"maximum_bytes_billed":0,"maximum_result_rows":1},{"maximum_bytes_billed":True,"maximum_result_rows":1}):
 try:a.compile_contract(snapshot,semantics,period,candidate)
 except a.AnalysisContractError:pass
 else:raise AssertionError("invalid limits accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

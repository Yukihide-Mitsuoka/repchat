import assert from 'node:assert/strict';
import test from 'node:test';
import { python } from './live-demo-test-helpers.ts';

const setup = String.raw`
import copy,hashlib,json
from datetime import date
import analysis_contract_compiler as c
from bigquery_scope_discovery import DiscoverySnapshot
metadata={"version":1,"tables":[{"table":"alpha.dataset.records","location":"US","fields":[
 {"name":"observed_at","type":"TIMESTAMP","mode":"NULLABLE"},
 {"name":"amount","type":"NUMERIC","mode":"NULLABLE","description":"集計可能な値"},
 {"name":"labels","type":"RECORD","mode":"REPEATED","fields":[{"name":"name","type":"STRING","mode":"NULLABLE"}]},
 {"name":"private_value","type":"STRING","mode":"NULLABLE","policyTags":{"names":["restricted"]}}
],"timePartitioning":{"type":"DAY","field":"observed_at"},"requirePartitionFilter":True}]}
fields=[
 {"path":"observed_at","segments":["observed_at"],"type":"TIMESTAMP","mode":"NULLABLE","valueClass":"temporal","valueSummary":{"status":"bounded_values","minimum":"2026-01-01T00:00:00+00:00"}},
 {"path":"amount","segments":["amount"],"type":"NUMERIC","mode":"NULLABLE","valueClass":"numeric","valueSummary":{"status":"bounded_values","minimum":"1"}},
 {"path":"labels","segments":["labels"],"type":"RECORD","mode":"REPEATED","valueClass":"repeated","valueSummary":{"status":"metadata_only","reason":"repeated"}},
 {"path":"labels.name","segments":["labels","name"],"type":"STRING","mode":"NULLABLE","valueClass":"repeated","valueSummary":{"status":"metadata_only","reason":"repeated"}},
 {"path":"private_value","segments":["private_value"],"type":"STRING","mode":"NULLABLE","valueClass":"restricted","valueSummary":{"status":"metadata_only","reason":"restricted"}},
]
limits={"maximumTables":c.MAX_TABLES,"maximumFields":c.MAX_FIELDS,"maximumValueFieldsPerTable":c.MAX_VALUE_FIELDS_PER_TABLE,"maximumSampleRows":c.MAX_SAMPLE_ROWS,"samplePercent":1,"maximumSampleValues":c.MAX_SAMPLE_VALUES,"maximumCategoricalDistinct":c.MAX_CATEGORICAL_DISTINCT,"maximumSampleCharacters":c.MAX_SAMPLE_CHARACTERS,"maximumBytesBilledPerQuery":c.MAX_BYTES_BILLED_PER_QUERY,"maximumBytesBilledTotal":c.MAX_BYTES_BILLED_TOTAL}
def snapshot(value):
 value=copy.deepcopy(value);encoded=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"));return DiscoverySnapshot(encoded,hashlib.sha256(encoded.encode()).hexdigest(),"2026-09-13T00:00:00+00:00")
schema={"metadata":metadata,"fingerprint":hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()}
content={"version":1,"schema":schema,"tables":[{"table":"alpha.dataset.records","location":"US","fields":fields,"timePartitioning":{"type":"DAY","field":"observed_at"},"requirePartitionFilter":True}],"limits":limits}
`;

test('discovery becomes a bounded generic catalog with opaque token bindings', () => {
  const result = python(
    setup +
      String.raw`
prepared=c.prepare_compiler_input(snapshot(content),"直近の変化",as_of=date(2026,9,13));catalog=json.loads(prepared.catalog_json)
assert catalog["question"]=="直近の変化" and catalog["as_of"]=="2026-09-13" and prepared.tables=={"t000":"alpha.dataset.records"}
assert prepared.fields["f0000"]["reference"]=={"table":"alpha.dataset.records","path":["observed_at"]} and catalog["fields"][1]["description"]=="集計可能な値"
assert [field["selectable"] for field in catalog["fields"]]==[True,True,False,False,False]
assert catalog["fields"][2]["value_summary"]=={"status":"metadata_only"} and "reason" not in prepared.catalog_json
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('forged discovery metadata and invalid questions fail closed', () => {
  const result = python(
    setup +
      String.raw`
cases=[]
for change in ("class","table","limits","missing"):
 value=copy.deepcopy(content)
 if change=="class":value["tables"][0]["fields"][1]["valueClass"]="categorical_candidate"
 if change=="table":value["tables"][0]["table"]="outside.dataset.records"
 if change=="limits":value["limits"]["maximumSampleRows"]+=1
 if change=="missing":value["tables"][0]["fields"].pop()
 cases.append(lambda value=value:c.prepare_compiler_input(snapshot(value),"分析",as_of=date(2026,9,13)))
cases.extend((lambda:c.prepare_compiler_input(snapshot(content),"",as_of=date(2026,9,13)),lambda:c.prepare_compiler_input(snapshot(content),"分析",as_of=None)))
for call in cases:
 try:call()
 except c.ContractCompilerError:pass
 else:raise AssertionError("invalid compiler input accepted")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

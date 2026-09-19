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
 {"name":"entity_code","type":"STRING","mode":"REQUIRED"},
 {"name":"labels","type":"RECORD","mode":"REPEATED","fields":[{"name":"name","type":"STRING","mode":"NULLABLE"}]},
 {"name":"private_value","type":"STRING","mode":"NULLABLE","policyTags":{"names":["restricted"]}}
],"timePartitioning":{"type":"DAY","field":"observed_at"},"requirePartitionFilter":True}]}
fields=[
 {"path":"observed_at","segments":["observed_at"],"type":"TIMESTAMP","mode":"NULLABLE","valueClass":"temporal","valueSummary":{"status":"bounded_values","minimum":"2026-01-01T00:00:00+00:00"}},
 {"path":"amount","segments":["amount"],"type":"NUMERIC","mode":"NULLABLE","valueClass":"numeric","valueSummary":{"status":"bounded_values","minimum":"1"}},
 {"path":"entity_code","segments":["entity_code"],"type":"STRING","mode":"REQUIRED","valueClass":"categorical_candidate","valueSummary":{"status":"aggregates","approxDistinct":100}},
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
assert [field["selectable"] for field in catalog["fields"]]==[True,True,True,False,False,False]
assert catalog["fields"][3]["value_summary"]=={"status":"metadata_only"} and "reason" not in prepared.catalog_json
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

const normalizationSetup =
  setup +
  String.raw`
import analysis_contract_response as r
second=copy.deepcopy(metadata["tables"][0]);second["table"]="beta.dataset.records";second["timePartitioning"]={"type":"DAY"};metadata["tables"].append(second)
second_catalog=copy.deepcopy(content["tables"][0]);second_catalog["table"]="beta.dataset.records";second_catalog["timePartitioning"]={"type":"DAY"};content["tables"].append(second_catalog)
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
prepared=c.prepare_compiler_input(snapshot(content),"期間比較",as_of=date(2026,9,13))
raw={"tables":["t001","t000"],"time_enabled":True,"business_time":"f0000","time_candidates":[{"field":"f0006","confidence":"low"},{"field":"f0000","confidence":"high"}],"grain":[],"identifiers":[{"name":"entity","field":"f0002","aliases":["id"]}],"dimensions":[],"measures":[{"name":"amount","field":"f0001","aliases":[]}],"metrics":[{"name":"total","field":"f0001","aliases":["sum","aggregate"],"aggregation":"sum","unit":"count"}],"relationships":[{"left_field":"f0002","right_field":"f0008","cardinality":"many_to_one"}],"period":{"start":"2026-08-01","end":"2026-08-31","comparison_enabled":True,"comparison_start":"2026-07-01","comparison_end":"2026-07-31"}}
`;

test('token candidates become one canonical schema-validated contract', () => {
  const result = python(
    normalizationSetup +
      String.raw`
contract=r.normalize_contract_response(raw,prepared);value=contract.content()
assert [table["table"] for table in value["schema"]["metadata"]["tables"]]==["alpha.dataset.records","beta.dataset.records"]
assert value["semantics"]["metrics"]["total"]["field"]=={"table":"alpha.dataset.records","path":["amount"]}
assert value["semantics"]["metrics"]["total"]["expr"]=="SUM("+chr(96)+"alpha.dataset.records"+chr(96)+"."+chr(96)+"amount"+chr(96)+")"
assert [item["field"]["table"] for item in value["semantics"]["time_candidates"]]==["alpha.dataset.records","beta.dataset.records"]
assert value["period"]["partitions"][1]=={"table":"beta.dataset.records","field":"_PARTITIONDATE"} and value["limits"]=={"maximum_bytes_billed":r.MAX_EXECUTION_BYTES,"maximum_result_rows":r.MAX_RESULT_ROWS}
other=copy.deepcopy(raw);other["tables"].reverse();other["time_candidates"].reverse();other["metrics"][0]["aliases"].reverse()
assert r.normalize_contract_response(other,prepared).fingerprint==contract.fingerprint
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('consolidated shards expose their governed date as a temporal dimension only', () => {
  const result = python(
    setup +
      String.raw`
import analysis_contract_response as r
import analysis_contract_generation as g
import analysis_contract_context as context
pattern="alpha.dataset.records_*";members=["alpha.dataset.records_20260801","alpha.dataset.records_20260802"]
date_shards={"suffixFormat":"YYYYMMDD","startSuffix":"20260801","endSuffix":"20260802","members":members}
metadata["tables"][0]["table"]=pattern;metadata["tables"][0].pop("timePartitioning");metadata["tables"][0]["requirePartitionFilter"]=False;metadata["tables"][0]["dateShards"]=date_shards
content["tables"][0]["table"]=pattern;content["tables"][0].pop("timePartitioning");content["tables"][0]["requirePartitionFilter"]=False;content["tables"][0]["dateShards"]=date_shards
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
prepared=c.prepare_compiler_input(snapshot(content),"2日間の合計",as_of=date(2026,9,13));catalog=json.loads(prepared.catalog_json)
suffix=next(token for token,field in prepared.fields.items() if field["reference"].get("field")=="_TABLE_SUFFIX")
suffix_field=next(field for field in catalog["fields"] if field["token"]==suffix)
assert suffix_field["role_selectable"] is False and suffix_field["dimension_selectable"] is True
response_schema=g._contract_response_schema(prepared)
assert suffix in response_schema["properties"]["business_time"]["enum"]
assert suffix in response_schema["properties"]["dimensions"]["items"]["properties"]["field"]["enum"]
assert suffix not in response_schema["properties"]["metrics"]["items"]["properties"]["field"]["enum"]
raw={"tables":["t000"],"time_enabled":True,"business_time":suffix,"time_candidates":[{"field":suffix,"confidence":"high"}],"grain":[],"identifiers":[],"dimensions":[{"name":"Date","field":suffix,"aliases":[]}],"measures":[{"name":"amount","field":"f0001","aliases":[]}],"metrics":[{"name":"total","field":"f0001","aliases":[],"aggregation":"sum","unit":""}],"relationships":[],"period":{"start":"2026-08-01","end":"2026-08-02","comparison_enabled":False,"comparison_start":"","comparison_end":""}}
compiled=r.normalize_contract_response(raw,prepared);contract=compiled.content()
assert contract["period"]["business_time"]=={"table":pattern,"field":"_TABLE_SUFFIX"}
assert contract["period"]["partitions"]==[{"table":pattern,"field":"_TABLE_SUFFIX"}]
assert contract["semantics"]["dimensions"]["Date"]["field"]=={"table":pattern,"field":"_TABLE_SUFFIX"}
assert "PARSE_DATE" in contract["semantics"]["dimensions"]["Date"]["expr"]
policy=context.execution_policy(compiled)
assert policy.result.temporal_dimensions==frozenset({"Date"})
assert "PARSE_DATE('%Y%m%d'" in context.sql_rules(compiled)
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('unsafe generated candidates and unconsolidated shards fail closed', () => {
  const result = python(
    normalizationSetup +
      String.raw`
cases=[]
for change in ("restricted","string_sum","future","confidence","cardinality","same_table","incompatible","disabled_time","extra"):
 value=copy.deepcopy(raw)
 if change=="restricted":value["metrics"][0]["field"]="f0005"
 if change=="string_sum":value["metrics"][0]["field"]="f0002"
 if change=="future":value["period"]["end"]="2026-10-01"
 if change=="confidence":value["time_candidates"][0]["confidence"]=[]
 if change=="cardinality":value["relationships"][0]["cardinality"]=[]
 if change=="same_table":value["relationships"][0]["right_field"]="f0002"
 if change=="incompatible":value["relationships"][0]["right_field"]="f0007"
 if change=="disabled_time":value.update({"time_enabled":False,"business_time":"","time_candidates":[],"period":{"start":"","end":"","comparison_enabled":False,"comparison_start":"","comparison_end":""}})
 if change=="extra":value["unexpected"]=True
 cases.append(value)
sharded=copy.deepcopy(content);sharded["tables"][0]["dateShardCandidate"]={"pattern":"alpha.dataset.records_*","suffixFormat":"YYYYMMDD","suffix":"20260801"}
shard_input=c.prepare_compiler_input(snapshot(sharded),"期間比較",as_of=date(2026,9,13));shard_raw=copy.deepcopy(raw);shard_raw["tables"]=["t000"];shard_raw["time_candidates"]=[{"field":"f0000","confidence":"high"}];shard_raw["relationships"]=[]
for value,input_value in [*( (value,prepared) for value in cases),(shard_raw,shard_input)]:
 try:r.normalize_contract_response(value,input_value)
 except c.ContractCompilerError:pass
 else:raise AssertionError("unsafe generated contract accepted")
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

test('contract generation makes one token-constrained request and normalizes it', () => {
  const result = python(
    normalizationSetup +
      String.raw`
import sys,types
import analysis_contract_generation as g
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
calls=[]
class Models:
 def generate_content(self,**kwargs):
  calls.append(kwargs)
  return types.SimpleNamespace(text=json.dumps(raw,ensure_ascii=False),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=types.SimpleNamespace(prompt_token_count=11,candidates_token_count=7,thoughts_token_count=3))
client=types.SimpleNamespace(models=Models())
contract,usage=g.generate_contract(client,"test-model",snapshot(content),"期間比較",as_of=date(2026,9,13))
call=calls[0];config=call["config"];response_schema=config.response_schema
prepared=c.prepare_compiler_input(snapshot(content),"期間比較",as_of=date(2026,9,13))
assert len(calls)==1 and call["model"]=="test-model"
assert call["contents"].endswith(prepared.catalog_json) and "dateShardCandidate付きtableは選ばない" in call["contents"]
assert config.system_instruction==g.SYSTEM_INSTRUCTION and config.response_mime_type=="application/json" and config.max_output_tokens==g.CONTRACT_MAX_OUTPUT_TOKENS
assert response_schema["required"]==list(g.RESPONSE_KEYS) and response_schema["propertyOrdering"]==list(g.RESPONSE_KEYS)
assert response_schema["properties"]["tables"]["items"]["enum"]==["t000","t001"]
assert response_schema["properties"]["business_time"]["enum"]==["","f0000","f0006","f0012"]
assert prepared.fields["f0012"]["reference"]=={"table":"beta.dataset.records","field":"_PARTITIONDATE"}
encoded_schema=json.dumps(response_schema,ensure_ascii=False)
assert "alpha.dataset.records" not in encoded_schema and "observed_at" not in encoded_schema
assert contract.content()["semantics"]["metrics"]["total"]["aggregation"]=="sum"
assert usage=={"input_tokens":11,"output_tokens":10}
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('tables without a time boundary generate an explicit time-free contract', () => {
  const result = python(
    setup +
      String.raw`
import sys,types
import analysis_contract_generation as g
import analysis_contract_response as r
table=content["schema"]["metadata"]["tables"][0];table["fields"]=[field for field in table["fields"] if field["name"]!="observed_at"];table.pop("timePartitioning");table["requirePartitionFilter"]=False
catalog=content["tables"][0];catalog["fields"]=[field for field in catalog["fields"] if field["path"]!="observed_at"];catalog.pop("timePartitioning");catalog["requirePartitionFilter"]=False
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
discovery=snapshot(content);prepared=c.prepare_compiler_input(discovery,"合計を確認",as_of=date(2026,9,13))
raw={"tables":["t000"],"time_enabled":False,"business_time":"","time_candidates":[],"grain":[],"identifiers":[],"dimensions":[],"measures":[{"name":"amount","field":"f0000","aliases":[]}],"metrics":[{"name":"total","field":"f0000","aliases":[],"aggregation":"sum","unit":""}],"relationships":[],"period":{"start":"","end":"","comparison_enabled":False,"comparison_start":"","comparison_end":""}}
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
calls=[]
class Models:
 def generate_content(self,**kwargs):
  calls.append(kwargs)
  return types.SimpleNamespace(text=json.dumps(raw),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=types.SimpleNamespace())
contract,usage=g.generate_contract(types.SimpleNamespace(models=Models()),"test-model",discovery,"合計を確認",as_of=date(2026,9,13))
response_schema=calls[0]["config"].response_schema;time_schema=response_schema["properties"]["time_candidates"]
assert "enum" not in response_schema["properties"]["business_time"]
assert "minItems" not in time_schema and "maxItems" not in time_schema
assert contract.content()["period"] is None and "time_candidates" not in contract.content()["semantics"]
assert usage=={"input_tokens":0,"output_tokens":0}
for change in ("enabled","period","boolean"):
 invalid=copy.deepcopy(raw)
 if change=="enabled":invalid["time_enabled"]=True
 if change=="period":invalid["period"]["start"]="2026-09-01"
 if change=="boolean":invalid["period"]["comparison_enabled"]=0
 try:r.normalize_contract_response(invalid,prepared)
 except c.ContractCompilerError:pass
 else:raise AssertionError("invalid time-free response accepted")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('time applicability follows selected tables rather than the whole catalog', () => {
  const result = python(
    setup +
      String.raw`
import analysis_contract_response as r
other_metadata=copy.deepcopy(metadata["tables"][0]);other_metadata["table"]="beta.dataset.records";other_metadata["fields"]=[field for field in other_metadata["fields"] if field["name"]!="observed_at"];other_metadata.pop("timePartitioning");other_metadata["requirePartitionFilter"]=False;metadata["tables"].append(other_metadata)
other_catalog=copy.deepcopy(content["tables"][0]);other_catalog["table"]="beta.dataset.records";other_catalog["fields"]=[field for field in other_catalog["fields"] if field["path"]!="observed_at"];other_catalog.pop("timePartitioning");other_catalog["requirePartitionFilter"]=False;content["tables"].append(other_catalog)
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
prepared=c.prepare_compiler_input(snapshot(content),"二つ目の表の合計",as_of=date(2026,9,13));amount=next(token for token,field in prepared.fields.items() if field["reference"]=={"table":"beta.dataset.records","path":["amount"]})
raw={"tables":["t001"],"time_enabled":False,"business_time":"","time_candidates":[],"grain":[],"identifiers":[],"dimensions":[],"measures":[{"name":"amount","field":amount,"aliases":[]}],"metrics":[{"name":"total","field":amount,"aliases":[],"aggregation":"sum","unit":""}],"relationships":[],"period":{"start":"","end":"","comparison_enabled":False,"comparison_start":"","comparison_end":""}}
contract=r.normalize_contract_response(raw,prepared).content()
assert contract["period"] is None
assert [table["table"] for table in contract["schema"]["metadata"]["tables"]]==["beta.dataset.records"]
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('ingestion-time partition metadata supplies a generic temporal token', () => {
  const result = python(
    setup +
      String.raw`
import analysis_contract_response as r
table=content["schema"]["metadata"]["tables"][0];table["fields"]=[field for field in table["fields"] if field["name"]!="observed_at"];table["timePartitioning"]={"type":"DAY"};table["requirePartitionFilter"]=True
catalog=content["tables"][0];catalog["fields"]=[field for field in catalog["fields"] if field["path"]!="observed_at"];catalog["timePartitioning"]={"type":"DAY"};catalog["requirePartitionFilter"]=True
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
prepared=c.prepare_compiler_input(snapshot(content),"30日間の合計",as_of=date(2026,9,13))
synthetic=next(token for token,field in prepared.fields.items() if field["reference"].get("field")=="_PARTITIONDATE")
raw={"tables":["t000"],"time_enabled":True,"business_time":synthetic,"time_candidates":[{"field":synthetic,"confidence":"high"}],"grain":[],"identifiers":[],"dimensions":[],"measures":[{"name":"amount","field":"f0000","aliases":[]}],"metrics":[{"name":"total","field":"f0000","aliases":[],"aggregation":"sum","unit":""}],"relationships":[],"period":{"start":"2026-08-15","end":"2026-09-13","comparison_enabled":False,"comparison_start":"","comparison_end":""}}
contract=r.normalize_contract_response(raw,prepared).content()
assert contract["period"]["business_time"]=={"table":"alpha.dataset.records","field":"_PARTITIONDATE"}
assert contract["period"]["partitions"]==[{"table":"alpha.dataset.records","field":"_PARTITIONDATE"}]
assert contract["semantics"]["time_candidates"]==[{"field":{"table":"alpha.dataset.records","field":"_PARTITIONDATE"},"confidence":"high"}]
table["timePartitioning"]={"type":"HOUR"};catalog["timePartitioning"]={"type":"HOUR"};schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
hourly=c.prepare_compiler_input(snapshot(content),"1時間の合計",as_of=date(2026,9,13))
assert any(field["reference"].get("field")=="_PARTITIONTIME" and field["type"]=="TIMESTAMP" for field in hourly.fields.values())
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('contract generation reports bounded structured failures without retrying', () => {
  const result = python(
    normalizationSetup +
      String.raw`
import sys,types
import analysis_contract_generation as g
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
secret="do-not-retain-this-response"
class Models:
 def __init__(self):self.calls=0
 def generate_content(self,**_kwargs):
  self.calls+=1
  return types.SimpleNamespace(text="{"+secret,candidates=[types.SimpleNamespace(finish_reason="STOP")])
models=Models();client=types.SimpleNamespace(models=models)
try:g.generate_contract(client,"test-model",snapshot(content),"期間比較",as_of=date(2026,9,13))
except c.ContractCompilerError as error:
 assert str(error)=="structured contract response failed: malformed_json" and secret not in str(error)
else:raise AssertionError("malformed structured response accepted")
assert models.calls==1
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('contract generation does not call the model for unconsolidated shards', () => {
  const result = python(
    setup +
      String.raw`
import sys,types
import analysis_contract_generation as g
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
sharded=copy.deepcopy(content);sharded["tables"][0]["dateShardCandidate"]={"pattern":"alpha.dataset.records_*","suffixFormat":"YYYYMMDD","suffix":"20260801"}
class Models:
 def __init__(self):self.calls=0
 def generate_content(self,**_kwargs):self.calls+=1;raise AssertionError("model called")
models=Models()
try:g.generate_contract(types.SimpleNamespace(models=models),"test-model",snapshot(sharded),"分析",as_of=date(2026,9,13))
except c.ContractCompilerError as error:assert str(error)=="no consolidated table is available for generation"
else:raise AssertionError("unconsolidated shard accepted")
assert models.calls==0
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('generic orchestration selects opaque shard groups before contract generation', () => {
  const result = python(
    setup +
      String.raw`
import sys,types
import analysis_contract_orchestration as o
from analysis_contract import AnalysisContract
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
source_metadata=copy.deepcopy(metadata["tables"][0]);source_catalog=copy.deepcopy(content["tables"][0])
metadata["tables"]=[];content["tables"]=[]
for suffix in ("20260801","20260802"):
 name="alpha.dataset.records_"+suffix;pattern="alpha.dataset.records_*"
 table=copy.deepcopy(source_metadata);table["table"]=name;table.pop("timePartitioning");table["requirePartitionFilter"]=False
 catalog=copy.deepcopy(source_catalog);catalog["table"]=name;catalog.pop("timePartitioning");catalog["requirePartitionFilter"]=False
 catalog["dateShardCandidate"]={"pattern":pattern,"suffixFormat":"YYYYMMDD","suffix":suffix}
 for field in catalog["fields"]:
  reason=field["valueClass"] if field["valueClass"] in ("restricted","repeated","structured") else "date_shard_candidate"
  field["valueSummary"]={"status":"metadata_only","reason":reason}
 metadata["tables"].append(table);content["tables"].append(catalog)
schema["fingerprint"]=hashlib.sha256(json.dumps(metadata,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
discovery=snapshot(content);prepared=o.prepare_shard_plan(discovery,"2日間を前日と比較",as_of=date(2026,9,13));catalog=json.loads(prepared.catalog_json)
assert prepared.groups=={"s000":"alpha.dataset.records_*"}
assert catalog["shard_groups"]==[{"available_end":"20260802","available_start":"20260801","pattern":"alpha.dataset.records_*","table_tokens":["t000","t001"],"token":"s000"}]
plan={"shard_groups":["s000"],"period":{"start":"2026-08-02","end":"2026-08-02","comparison_enabled":True,"comparison_start":"2026-08-01","comparison_end":"2026-08-01"}}
calls=[]
class Models:
 def generate_content(self,**kwargs):
  calls.append(kwargs)
  return types.SimpleNamespace(text=json.dumps(plan),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=types.SimpleNamespace(prompt_token_count=5,candidates_token_count=3,thoughts_token_count=1))
captured={}
def consolidate(bq,value,ranges):captured["bq"]=bq;captured["ranges"]=ranges;return "consolidated"
def generate(vertex,model,value,question,*,as_of,fixed_period=None):
 captured["contract"]=(vertex,model,value,question,as_of,fixed_period)
 return AnalysisContract("{}","contract-fingerprint"),{"input_tokens":7,"output_tokens":2}
o.consolidate_date_shards=consolidate;o.generate_contract=generate
bq=object();vertex=types.SimpleNamespace(models=Models())
contract,usage=o.generate_discovered_contract(bq,vertex,"test-model",discovery,"2日間を前日と比較",as_of=date(2026,9,13))
assert len(calls)==1 and calls[0]["config"].response_schema["properties"]["shard_groups"]["items"]["enum"]==["s000"]
assert "alpha.dataset.records" not in json.dumps(calls[0]["config"].response_schema)
assert captured["bq"] is bq and captured["ranges"]=={"alpha.dataset.records_*":("20260801","20260802")}
assert captured["contract"]==(vertex,"test-model","consolidated","2日間を前日と比較",date(2026,9,13),plan["period"])
assert contract.fingerprint=="contract-fingerprint" and usage=={"input_tokens":12,"output_tokens":6}
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('generic orchestration bypasses shard planning for ordinary tables', () => {
  const result = python(
    setup +
      String.raw`
import analysis_contract_orchestration as o
from analysis_contract import AnalysisContract
calls=[]
def generate(vertex,model,value,question,*,as_of,fixed_period=None):
 calls.append((vertex,model,value,question,as_of,fixed_period))
 return AnalysisContract("{}","ordinary"),{"input_tokens":4,"output_tokens":2}
o.generate_contract=generate
bq=object();vertex=object();discovery=snapshot(content)
contract,usage=o.generate_discovered_contract(bq,vertex,"test-model",discovery,"分析",as_of=date(2026,9,13))
assert calls==[(vertex,"test-model",discovery,"分析",date(2026,9,13),None)]
assert contract.fingerprint=="ordinary" and usage=={"input_tokens":4,"output_tokens":2}
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('fixed shard period cannot drift during full contract generation', () => {
  const result = python(
    normalizationSetup +
      String.raw`
import sys,types
import analysis_contract_generation as g
google=types.ModuleType("google");genai=types.ModuleType("google.genai")
class GenerateContentConfig:
 def __init__(self,**kwargs):self.__dict__.update(kwargs)
genai.types=types.SimpleNamespace(GenerateContentConfig=GenerateContentConfig)
google.genai=genai;sys.modules["google"]=google;sys.modules["google.genai"]=genai
fixed=copy.deepcopy(raw["period"]);changed=copy.deepcopy(raw);changed["period"]["start"]="2026-08-02"
calls=[]
class Models:
 def generate_content(self,**kwargs):
  calls.append(kwargs)
  return types.SimpleNamespace(text=json.dumps(changed),candidates=[types.SimpleNamespace(finish_reason="STOP")],usage_metadata=types.SimpleNamespace())
try:g.generate_contract(types.SimpleNamespace(models=Models()),"test-model",snapshot(content),"期間比較",as_of=date(2026,9,13),fixed_period=fixed)
except c.ContractCompilerError as error:assert str(error)=="generated period differs from the fixed period"
else:raise AssertionError("generated period drift was accepted")
period_schema=calls[0]["config"].response_schema["properties"]["period"]["properties"]
assert period_schema["start"]["enum"]==["2026-08-01"] and period_schema["comparison_end"]["enum"]==["2026-07-31"]
assert len(calls)==1
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

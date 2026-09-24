import assert from 'node:assert/strict';
import test from 'node:test';
import { python } from './live-demo-test-helpers.ts';

const setup = String.raw`
import copy,json,re,sys,types
from datetime import datetime,timezone
from decimal import Decimal

bigquery=types.ModuleType("google.cloud.bigquery")
class QueryJobConfig:
 def __init__(self,**kwargs):self.values=kwargs
bigquery.QueryJobConfig=QueryJobConfig
google=types.ModuleType("google");cloud=types.ModuleType("google.cloud")
cloud.bigquery=bigquery;google.cloud=cloud
sys.modules["google"]=google;sys.modules["google.cloud"]=cloud
sys.modules["google.cloud.bigquery"]=bigquery

import bigquery_scope_discovery as d

dataset="sample-project.analytics"
exact="second-project.core.measures"
listed_tables=["records_20260102","records_20260101"]
base_fields=[
 {"name":"observed_at","type":"TIMESTAMP"},
 {"name":"category","type":"STRING"},
 {"name":"free_text","type":"STRING"},
 {"name":"amount","type":"NUMERIC"},
 {"name":"enabled","type":"BOOL"},
 {"name":"attributes","type":"RECORD","fields":[{"name":"label","type":"STRING"}]},
 {"name":"items","type":"RECORD","mode":"REPEATED","fields":[{"name":"sku","type":"STRING"}]},
 {"name":"payload","type":"JSON"},
 {"name":"secret","type":"STRING","policyTags":{"names":["taxonomy/pii"]}},
 {"name":"odd.name","type":"BOOL"},
]

class Listed:
 def __init__(self,table_id,table_type="TABLE"):
  self.table_id=table_id;self.table_type=table_type
class Reference:
 def __init__(self,name):self.project,self.dataset_id,self.table_id=name.split(".")
class Table:
 def __init__(self,name):self.name=name
 def to_api_repr(self):
  project,dataset_id,table_id=self.name.split(".")
  return {"tableReference":{"projectId":project,"datasetId":dataset_id,"tableId":table_id},"type":"TABLE","location":"US","schema":{"fields":copy.deepcopy(base_fields)},"timePartitioning":{"type":"DAY","field":"observed_at"},"clustering":{"fields":["category"]},"requirePartitionFilter":True}

def result_row():
 return {
  "sampled_rows":100,
  "f0_nulls":0,"f0_distinct":20,"f0_minimum":datetime(2026,1,1,tzinfo=timezone.utc),"f0_maximum":datetime(2026,1,2,tzinfo=timezone.utc),
  "f1_nulls":4,"f1_distinct":40,"f1_minimum":Decimal("1.25"),"f1_maximum":Decimal("99.75"),
  "f2_nulls":0,"f2_distinct":2,"f2_samples":[True,False],
  "f3_nulls":3,"f3_distinct":2,"f3_max_length":4,"f3_samples":["east","west"],
  "f4_nulls":5,
  "f5_nulls":0,"f5_distinct":2,"f5_samples":[True,False],
  "f6_nulls":2,"f6_distinct":3,"f6_max_length":5,"f6_samples":["alpha","beta"],
  "f7_nulls":1,"f7_distinct":90,"f7_max_length":20,"f7_samples":["private example"],
 }
class Job:
 def __init__(self,name,dry,client):
  self.statement_type=client.statement_type
  reference=client.reference_override or name
  self.referenced_tables=[Reference(reference)] if reference else None
  self.total_bytes_processed=client.bytes_processed if dry else None
  self.client=client
 def result(self,**kwargs):
  self.client.result_calls.append(kwargs)
  if self.client.result_error:raise RuntimeError(self.client.result_error)
  return self.client.rows
class Client:
 def __init__(self):
  self.list_calls=[];self.get_calls=[];self.query_calls=[];self.result_calls=[]
  self.statement_type="SELECT";self.reference_override=None;self.bytes_processed=100
  self.result_error=None;self.rows=[result_row()]
 def list_tables(self,requested,**kwargs):
  self.list_calls.append((requested,kwargs))
  return [Listed(name) for name in listed_tables]+[Listed("derived_view","VIEW")]
 def get_table(self,name,**kwargs):
  self.get_calls.append((name,kwargs));return Table(name)
 def query(self,sql,job_config):
  match=re.search(r"FROM .([^ ]+). AS source",sql)
  assert match,sql
  name=match.group(1)
  self.query_calls.append((name,sql,job_config.values))
  return Job(name,job_config.values.get("dry_run",False),self)

def discover(client=None):
 client=client or Client()
 scope=d.AuthorizedScope(datasets=frozenset([dataset]),tables=frozenset([exact]))
 return client,d.discover_scope(client,scope)
`;

test('authorized scope automatically yields schema, field paths, shards and bounded values', () => {
  const result = python(
    setup +
      String.raw`
client,snapshot=discover();content=snapshot.content()
assert [table["table"] for table in content["tables"]]==[
 "sample-project.analytics.records_20260101",
 "sample-project.analytics.records_20260102",
 exact,
]
assert client.list_calls==[(dataset,{"max_results":d.MAX_LISTED_TABLES+1,"timeout":30,"retry":None})]
assert len(client.get_calls)==3
first=content["tables"][0]
assert first["timePartitioning"]=={"type":"DAY","field":"observed_at"}
assert first["clustering"]=={"fields":["category"]}
assert first["dateShardCandidate"]=={"pattern":"sample-project.analytics.records_*","suffixFormat":"YYYYMMDD","suffix":"20260101"}
fields={field["path"]:field for field in first["fields"]}
assert fields["attributes.label"]["mode"]=="NULLABLE"
assert fields["attributes.label"]["segments"]==["attributes","label"]
assert fields["odd.name"]["segments"]==["odd.name"]
assert fields["items.sku"]["valueClass"]=="repeated"
assert fields["items.sku"]["valueSummary"]=={"status":"metadata_only","reason":"repeated"}
assert fields["secret"]["valueClass"]=="restricted"
assert fields["secret"]["valueSummary"]=={"status":"metadata_only","reason":"restricted"}
assert fields["category"]["valueSummary"]=={"status":"metadata_only","reason":"date_shard_candidate"}
profiled={field["path"]:field for field in content["tables"][2]["fields"]}
assert profiled["category"]["valueSummary"]["samples"]==["alpha","beta"]
assert profiled["category"]["valueSummary"]["status"]=="bounded_values"
assert profiled["free_text"]["valueSummary"]["status"]=="aggregates"
assert "samples" not in profiled["free_text"]["valueSummary"]
assert profiled["amount"]["valueSummary"]["minimum"]=="1.25"
assert profiled["observed_at"]["valueSummary"]["minimum"]=="2026-01-01T00:00:00+00:00"
assert profiled["payload"]["valueSummary"]=={"status":"aggregates","nullFraction":0.05}
secret_metadata=next(field for field in content["schema"]["metadata"]["tables"][0]["fields"] if field["name"]=="secret")
assert secret_metadata["policyTags"]=={"names":["taxonomy/pii"]}
assert all("secret" not in sql and "items" not in sql for _,sql,_ in client.query_calls)
quoted_odd="source."+chr(96)+"odd.name"+chr(96)
assert all(quoted_odd in sql for _,sql,_ in client.query_calls)
assert all("LIMIT 10000" in sql and "TABLESAMPLE SYSTEM (1 PERCENT)" in sql for _,sql,_ in client.query_calls)
partition_filter="WHERE source."+chr(96)+"observed_at"+chr(96)+" IS NOT NULL"
assert all(partition_filter in sql for _,sql,_ in client.query_calls)
assert [name for name,_,_ in client.query_calls]==[exact,exact]
assert [config["dry_run"] for _,_,config in client.query_calls]==[True,False]
assert all(call=={"timeout":d.QUERY_TIMEOUT_SECONDS,"max_results":2} for call in client.result_calls)
assert snapshot.fingerprint==d.discover_scope(Client(),d.AuthorizedScope(datasets=frozenset([dataset]),tables=frozenset([exact]))).fingerprint
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('discovered date shards consolidate and profile through one bounded wildcard', () => {
  const result = python(
    setup +
      String.raw`
pattern=dataset+".records_*"
class UnpartitionedTable(Table):
 def to_api_repr(self):
  data=super().to_api_repr()
  if self.name.startswith(dataset+".records_"):
   data.pop("timePartitioning");data["requirePartitionFilter"]=False
  return data
class UnpartitionedClient(Client):
 def get_table(self,name,**kwargs):
  self.get_calls.append((name,kwargs));return UnpartitionedTable(name)
client,physical=discover(UnpartitionedClient())
consolidated=d.consolidate_date_shards(client,physical,{pattern:("20260101","20260102")})
content=consolidated.content();tables=content["tables"]
assert [table["table"] for table in tables]==[pattern,exact]
wildcard=tables[0]
assert wildcard["dateShards"]=={"suffixFormat":"YYYYMMDD","startSuffix":"20260101","endSuffix":"20260102","members":[dataset+".records_20260101",dataset+".records_20260102"]}
assert "dateShardCandidate" not in wildcard
assert next(field for field in wildcard["fields"] if field["path"]=="category")["valueSummary"]["samples"]==["alpha","beta"]
assert [name for name,_,_ in client.query_calls]==[exact,exact,pattern,pattern]
wildcard_sql=[sql for name,sql,_ in client.query_calls if name==pattern]
assert all("_TABLE_SUFFIX BETWEEN '20260101' AND '20260102'" in sql for sql in wildcard_sql)
assert client.list_calls==[(dataset,{"max_results":d.MAX_LISTED_TABLES+1,"timeout":30,"retry":None})]*2
assert consolidated.fingerprint==d.consolidate_date_shards(UnpartitionedClient(),discover(UnpartitionedClient())[1],{pattern:("20260101","20260102")}).fingerprint
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('shard consolidation rejects scope expansion and partitioned groups', () => {
  const result = python(
    setup +
      String.raw`
pattern=dataset+".records_*";client,physical=discover()
before=len(client.list_calls)
try:d.consolidate_date_shards(client,physical,{pattern:("20251231","20260102")})
except d.ScopeDiscoveryError:pass
else:raise AssertionError("range outside discovered scope accepted")
assert len(client.list_calls)==before
try:d.consolidate_date_shards(client,physical,{pattern:("20260101","20260102")})
except d.ScopeDiscoveryError as error:assert str(error)=="partitioned date-shard groups are unsupported"
else:raise AssertionError("partitioned shard group accepted")
from bigquery_schema_snapshot import SchemaInspectionInfrastructureError
original=d.inspect_date_shards
d.inspect_date_shards=lambda *_args,**_kwargs:(_ for _ in ()).throw(SchemaInspectionInfrastructureError("private provider payload"))
try:d.consolidate_date_shards(client,physical,{pattern:("20260101","20260102")})
except d.ScopeDiscoveryInfrastructureError as error:assert "private" not in str(error)
else:raise AssertionError("shard infrastructure failure accepted")
d.inspect_date_shards=original
assert [name for name,_,_ in client.query_calls]==[exact,exact]
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('scope validation and listing limits fail before metadata or value queries', () => {
  const result = python(
    setup +
      String.raw`
invalid=(
 lambda:d.AuthorizedScope(),
 lambda:d.AuthorizedScope(datasets={dataset}),
 lambda:d.AuthorizedScope(datasets=frozenset(["missing-project"])),
 lambda:d.AuthorizedScope(tables=frozenset(["not.a.table.extra"])),
 lambda:d.AuthorizedScope(datasets=frozenset(f"project.dataset{i}" for i in range(d.MAX_AUTHORIZED_DATASETS+1))),
)
for call in invalid:
 try:call()
 except d.ScopeDiscoveryError:pass
 else:raise AssertionError("invalid scope accepted")
client=Client();listed_tables[:]=[]
try:d.discover_scope(client,d.AuthorizedScope(datasets=frozenset([dataset])))
except d.ScopeDiscoveryError:pass
else:raise AssertionError("view-only scope accepted")
assert not client.get_calls and not client.query_calls
listed_tables[:]=[f"table_{i}" for i in range(d.MAX_TABLES+1)]
client=Client()
try:d.discover_scope(client,d.AuthorizedScope(datasets=frozenset([dataset])))
except d.ScopeDiscoveryError:pass
else:raise AssertionError("large scope accepted")
assert not client.get_calls and not client.query_calls
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('dry-run scope and byte enforcement happen before any value query', () => {
  const result = python(
    setup +
      String.raw`
for change in ("statement","reference","bytes","missing"):
 client=Client()
 if change=="statement":client.statement_type="INSERT"
 if change=="reference":client.reference_override="foreign-project.other.table"
 if change=="bytes":client.bytes_processed=d.MAX_BYTES_BILLED_PER_QUERY+1
 if change=="missing":client.bytes_processed=None
 try:discover(client)
 except d.ScopeDiscoveryError:pass
 else:raise AssertionError("unsafe dry run accepted")
 assert client.query_calls
 assert all(config.get("dry_run") for _,_,config in client.query_calls)
 assert not client.result_calls
listed_tables[:]=["records_alpha","records_beta"]
client=Client();client.bytes_processed=d.MAX_BYTES_BILLED_TOTAL//3+1
try:discover(client)
except d.ScopeDiscoveryError:pass
else:raise AssertionError("aggregate byte budget was not enforced")
assert len(client.query_calls)==3
assert all(config.get("dry_run") for _,_,config in client.query_calls)
assert not client.result_calls
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('provider and result failures are sanitized and fail closed', () => {
  const result = python(
    setup +
      String.raw`
def fail(*_args,**_kwargs):raise RuntimeError("credential=private-value")
provider_clients=[]
client=Client();client.list_tables=fail;provider_clients.append(client)
client=Client();client.get_table=fail;provider_clients.append(client)
client=Client();client.query=fail;provider_clients.append(client)
client=Client();client.result_error="credential=private-value";provider_clients.append(client)
for client in provider_clients:
 try:discover(client)
 except d.ScopeDiscoveryInfrastructureError as error:
  import traceback
  assert "private-value" not in "".join(traceback.format_exception(error))
 else:raise AssertionError("provider failure accepted")
for rows in ([],[result_row(),result_row()],[{"sampled_rows":True}]):
 client=Client();client.rows=rows
 try:discover(client)
 except d.ScopeDiscoveryInfrastructureError:raise AssertionError("invalid provider result classified as infrastructure")
 except d.ScopeDiscoveryError:pass
 else:raise AssertionError("invalid result accepted")
original=d.inspect_schema
d.inspect_schema=lambda *_args,**_kwargs:(_ for _ in ()).throw(RuntimeError("programming defect"))
try:discover(Client())
except RuntimeError as error:assert str(error)=="programming defect"
else:raise AssertionError("unknown exception was converted")
d.inspect_schema=original
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('value field budget retains complete metadata and marks the remainder', () => {
  const result = python(
    setup +
      String.raw`
base_fields[:]=[{"name":f"field_{index}","type":"JSON"} for index in range(d.MAX_VALUE_FIELDS_PER_TABLE+2)]
listed_tables[:]=[]
client=Client()
row={"sampled_rows":10}
for index in range(d.MAX_VALUE_FIELDS_PER_TABLE):row[f"f{index}_nulls"]=index%2
client.rows=[row]
_,snapshot=discover(client);fields=snapshot.content()["tables"][0]["fields"]
assert len(fields)==d.MAX_VALUE_FIELDS_PER_TABLE+2
deferred=[field for field in fields if field["valueSummary"]=={"status":"metadata_only","reason":"field_budget"}]
assert len(deferred)==2
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

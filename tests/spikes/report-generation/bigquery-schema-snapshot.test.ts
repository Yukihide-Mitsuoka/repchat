import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

const setup = `
import copy
import bigquery_schema_snapshot as s
name="example-project.sample.records"
raw={"tableReference":{"projectId":"example-project","datasetId":"sample","tableId":"records"},"type":"TABLE","location":"US","schema":{"fields":[
 {"name":"occurred","type":"TIMESTAMP"},
 {"name":"items","type":"RECORD","mode":"REPEATED","fields":[{"name":"codes","type":"STRING","mode":"REPEATED","description":"識別子"}]}]},
 "timePartitioning":{"type":"DAY","field":"occurred"},"requirePartitionFilter":True}
class Table:
 def to_api_repr(self):return copy.deepcopy(raw)
class Client:
 def __init__(self):self.calls=[]
 def get_table(self,table_id,**kwargs):
  self.calls.append((table_id,kwargs));return Table()
client=Client()
def inspect():return s.inspect_schema(client,[name],allowed_tables=frozenset([name]))
`;

const shardSetup =
  setup +
  `
pattern="example-project.sample.events_*"
class Item:
 def __init__(self,table_id):self.table_id=table_id
class ShardClient:
 def __init__(self,names):self.names=names;self.list_calls=[];self.get_calls=[];self.mutations={}
 def list_tables(self,dataset,**kwargs):
  self.list_calls.append((dataset,kwargs));return [Item(item) for item in self.names]
 def get_table(self,table_id,**kwargs):
  self.get_calls.append((table_id,kwargs));data=copy.deepcopy(raw)
  data["tableReference"]["tableId"]=table_id.split(".")[-1]
  for key,value in self.mutations.get(table_id,{ }).items():data[key]=value
  class Result:
   def to_api_repr(self):return data
  return Result()
def shards(client,start="20260101",end="20260103"):
 return s.inspect_date_shards(client,pattern,start_suffix=start,end_suffix=end,allowed_patterns=frozenset([pattern]))
`;

test('schema inspection preserves nested modes and partitions without reading rows', () => {
  const result = python(
    setup +
      `
snapshot=inspect()
metadata=snapshot.metadata()
assert metadata["tables"][0]["fields"][1]["fields"][0]["mode"]=="REPEATED"
assert metadata["tables"][0]["timePartitioning"]==raw["timePartitioning"]
assert metadata["tables"][0]["requirePartitionFilter"] is True
metadata["tables"].clear()
assert len(snapshot.metadata()["tables"])==1
assert snapshot.fingerprint==inspect().fingerprint
raw["schema"]["fields"][0]["type"]="DATE"
assert snapshot.fingerprint!=inspect().fingerprint
assert all(options=={"timeout":30,"retry":None} for _,options in client.calls)
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('unapproved, wildcard, duplicate and excessive selections fail before metadata calls', () => {
  const result = python(
    setup +
      `
for selection in ([],[name,name],["other-project.sample.records"],["example-project.sample.records_*"],[name]*21,[None]):
 try:s.inspect_schema(client,selection,allowed_tables=frozenset([name]))
 except s.SchemaInspectionError:pass
 else:raise AssertionError("invalid selection accepted")
assert not client.calls
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('missing, changed and unsupported metadata stop inspection without a fallback', () => {
  const result = python(
    setup +
      `
original=copy.deepcopy(raw)
variants=[]
for key,value in [("location",None),("type","VIEW"),("schema",{"fields":[]}),("requirePartitionFilter","true")]:
 item=copy.deepcopy(original);item[key]=value;variants.append(item)
item=copy.deepcopy(original);item["tableReference"]["tableId"]="other";variants.append(item)
for field in ({"name":"bad","type":"UNKNOWN"},{"name":"occurred","type":"DATE"},{"name":"bad","type":"STRING","mode":"UNKNOWN"}):
 item=copy.deepcopy(original);item["schema"]["fields"].append(field);variants.append(item)
item=copy.deepcopy(original);item["schema"]["fields"][1]["description"]="x"*(s.MAX_METADATA_BYTES+1);variants.append(item)
for raw in variants:
 try:inspect()
 except s.SchemaInspectionError:pass
 else:raise AssertionError("invalid metadata accepted")
raw=original
def fail(*args,**kwargs):raise RuntimeError("private provider payload")
client.get_table=fail
try:inspect()
except s.SchemaInspectionError as error:
 import traceback
 assert "private" not in "".join(traceback.format_exception(error))
else:raise AssertionError("provider failure accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('field and nesting budgets reject oversized schemas without truncation', () => {
  const result = python(
    setup +
      `
raw["schema"]["fields"]=[{"name":f"c{i}","type":"INTEGER"} for i in range(s.MAX_FIELDS)]
assert len(inspect().metadata()["tables"][0]["fields"])==s.MAX_FIELDS
raw["schema"]["fields"].append({"name":"extra","type":"STRING"})
try:inspect()
except s.SchemaInspectionError:pass
else:raise AssertionError("field limit not enforced")
field={"name":"leaf","type":"STRING"}
for _ in range(s.MAX_DEPTH):field={"name":"nested","type":"RECORD","fields":[field]}
raw["schema"]["fields"]=[field]
inspect()
raw["schema"]["fields"]=[{"name":"extra","type":"RECORD","fields":[field]}]
try:inspect()
except s.SchemaInspectionError:pass
else:raise AssertionError("depth limit not enforced")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('table ordering is canonical while schema and location changes are detected', () => {
  const result = python(
    setup +
      `
other="example-project.sample.second"
class MultiClient:
 def get_table(self,table_id,**kwargs):
  data=copy.deepcopy(raw);data["tableReference"]["tableId"]=table_id.split(".")[-1]
  if table_id==other:data["location"]=other_location
  class Result:
   def to_api_repr(self):return data
  return Result()
other_location="US"
def multi(names):return s.inspect_schema(MultiClient(),names,allowed_tables=frozenset([name,other]))
first=multi([name,other])
assert first.fingerprint==multi([other,name]).fingerprint
raw["timePartitioning"]["type"]="MONTH"
assert first.fingerprint!=multi([name,other]).fingerprint
other_location="EU"
try:multi([name,other])
except s.SchemaInspectionError:pass
else:raise AssertionError("mixed locations accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('range partitions and ingestion-time partitions retain their distinct metadata', () => {
  const result = python(
    setup +
      `
raw["timePartitioning"]={"type":"DAY"}
assert "field" not in inspect().metadata()["tables"][0]["timePartitioning"]
del raw["timePartitioning"]
raw["rangePartitioning"]={"field":"sequence","range":{"start":"0","end":"100","interval":"10"}}
raw["schema"]["fields"].append({"name":"sequence","type":"INTEGER"})
assert inspect().metadata()["tables"][0]["rangePartitioning"]==raw["rangePartitioning"]
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('date shards resolve to one canonical schema with exact period members', () => {
  const result = python(
    shardSetup +
      `
client=ShardClient(["other","events_20260103","events_20260101","events_20260102"])
snapshot=shards(client)
table=snapshot.metadata()["tables"][0]
assert table["table"]==pattern
assert table["dateShards"]=={
 "suffixFormat":"YYYYMMDD","startSuffix":"20260101","endSuffix":"20260103",
 "members":["example-project.sample.events_20260101","example-project.sample.events_20260102","example-project.sample.events_20260103"]}
assert client.list_calls==[("example-project.sample",{"max_results":s.MAX_LISTED_TABLES+1,"timeout":30,"retry":None})]
assert all(options=={"timeout":30,"retry":None} for _,options in client.get_calls)
client.names.reverse()
assert snapshot.fingerprint==shards(client).fingerprint
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('date shard inspection rejects unauthorized patterns, invalid ranges and gaps', () => {
  const result = python(
    shardSetup +
      `
client=ShardClient(["events_20260101","events_20260103"])
invalid=(
 lambda:s.inspect_date_shards(client,pattern,start_suffix="20260101",end_suffix="20260103",allowed_patterns=frozenset()),
 lambda:s.inspect_date_shards(client,pattern,start_suffix="20260101",end_suffix="20260103",allowed_patterns=pattern),
 lambda:s.inspect_date_shards(client,"example-project.sample.*",start_suffix="20260101",end_suffix="20260103",allowed_patterns=frozenset([pattern])),
 lambda:shards(client,"20260132","20260103"),
 lambda:shards(client,"20260103","20260101"),
)
for call in invalid:
 try:call()
 except s.SchemaInspectionError:pass
 else:raise AssertionError("invalid shard request accepted")
assert not client.list_calls
try:shards(client)
except s.SchemaInspectionError:pass
else:raise AssertionError("missing date shard accepted")
assert not client.get_calls
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('every wildcard match is checked for unsafe names and schema drift', () => {
  const result = python(
    shardSetup +
      `
client=ShardClient(["events_20260101","events_20260102","events_20260103","events_backup"])
try:shards(client)
except s.SchemaInspectionError:pass
else:raise AssertionError("non-date wildcard match accepted")
assert not client.get_calls
client=ShardClient(["events_20260101","events_20260102","events_20260103","events_20260104"])
changed=copy.deepcopy(raw["schema"]);changed["fields"][0]["type"]="DATE"
client.mutations["example-project.sample.events_20260104"]={"schema":changed}
try:shards(client)
except s.SchemaInspectionError:pass
else:raise AssertionError("out-of-period schema drift accepted")
assert len(client.get_calls)==4
client=ShardClient(["events_20260101","events_20260102","events_20260103"])
client.mutations["example-project.sample.events_20260103"]={"encryptionConfiguration":{"kmsKeyName":"private-key"}}
try:shards(client)
except s.SchemaInspectionError as error:assert "private-key" not in str(error)
else:raise AssertionError("encrypted wildcard accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('date shard listing limits and provider failures stay fail-closed', () => {
  const result = python(
    shardSetup +
      `
from datetime import date,timedelta
client=ShardClient(["events_"+(date(2026,1,1)+timedelta(days=i)).strftime("%Y%m%d") for i in range(s.MAX_SHARDS+1)])
try:shards(client)
except s.SchemaInspectionError:pass
else:raise AssertionError("shard limit not enforced")
assert not client.get_calls
def fail(*args,**kwargs):raise RuntimeError("private provider payload")
client=ShardClient([]);client.list_tables=fail
try:shards(client)
except s.SchemaInspectionError as error:
 import traceback
 assert "private" not in "".join(traceback.format_exception(error))
else:raise AssertionError("provider failure accepted")
print("ok")
`,
  );
  assert.equal(result.status, 0, result.stderr);
});

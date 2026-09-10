import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');

test('Vertex API failures expose bounded guidance without retry or response leakage', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys,types
sys.path.insert(0,${JSON.stringify(MODULE_DIR)})
from vertex_generation import VertexRequestError, generate_content

class ProviderError(Exception):
 def __init__(self,code,status):
  super().__init__('private request body and provider response')
  self.code=code;self.status=status

cases=[
 (400,'INVALID_ARGUMENT'),(401,'UNAUTHENTICATED'),
 (403,'PERMISSION_DENIED'),(404,'NOT_FOUND'),
 (429,'RESOURCE_EXHAUSTED'),(503,'UNAVAILABLE'),
]
messages=[];calls=[]
for code,status in cases:
 class Models:
  def generate_content(self,**_kwargs):
   calls.append((code,status));raise ProviderError(code,status)
 try:generate_content(types.SimpleNamespace(models=Models()),model='test')
 except VertexRequestError as error:messages.append(str(error))

unknown=RuntimeError('ordinary failure')
class UnknownModels:
 def generate_content(self,**_kwargs):raise unknown
same_unknown=False
try:generate_content(types.SimpleNamespace(models=UnknownModels()),model='test')
except RuntimeError as error:same_unknown=error is unknown

print(json.dumps({'calls':calls,'messages':messages,'same_unknown':same_unknown},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.calls, [
    [400, 'INVALID_ARGUMENT'],
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RESOURCE_EXHAUSTED'],
    [503, 'UNAVAILABLE'],
  ]);
  assert.equal(output.messages.length, 6);
  assert.match(output.messages[0], /400 INVALID_ARGUMENT/);
  assert.match(output.messages[1], /認証/);
  assert.match(output.messages[2], /権限/);
  assert.match(output.messages[3], /モデル/);
  assert.match(output.messages[4], /割り当て上限/);
  assert.match(output.messages[5], /一時的/);
  assert.ok(output.messages.every((message: string) => message.includes('自動再実行していません')));
  assert.ok(output.messages.every((message: string) => !message.includes('private')));
  assert.equal(output.same_unknown, true);
});


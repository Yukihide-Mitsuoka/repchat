import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNNER = path.join(ROOT, 'spikes/report-generation/verify_live_services.py');

function python(body: string) {
  return spawnSync(
    'python3',
    ['-c', `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(RUNNER))})\n${body}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('live verification requires an explicit cost gate before ADC or clients', () => {
  const result = python(`
import verify_live_services as v
v.require_adc=lambda: (_ for _ in ()).throw(AssertionError("ADC must not be checked"))
status=v.main(["--project","example-project","--output","/private/tmp/repchat-test.json"])
print(status)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '2');
  assert.match(result.stderr, /--accept-cost/);
});

test('quality record keeps contract metadata and excludes generated payloads', () => {
  const result = python(`
import json
import verify_live_services as v
summary=v.quality_summary([
 {"type":"sql","sql_sha256":"a"*16},
 {"type":"result","panel_id":"P1","columns":["page","count"],"rows":[["secret",4]],"visualization":"bar","verification":"unverified"},
 {"type":"dashboard_complete","cost_jpy":1.5},
], {"dashboard_complete"})
print(json.dumps(summary,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /secret/);
  assert.match(result.stdout, /"row_count": 1/);
  assert.match(result.stdout, /"sql_sha256s": \["aaaaaaaaaaaaaaaa"\]/);
});

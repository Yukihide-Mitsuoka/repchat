import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

test('budgeted manifest evaluation settles providers and writes only complete artifacts', () => {
  const script = path.join(ROOT, 'tests/spikes/budgeted-manifest-runtime-fixture.py');
  const result = spawnSync('python3', [script], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

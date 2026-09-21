import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './live-demo-test-helpers.ts';

const PROBE = path.join(ROOT, 'spikes/report-generation/chart_renderer_probe.mjs');

function probeRaw(input: string) {
  return spawnSync(process.execPath, [PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    timeout: 5000,
  });
}

function probe(payload: unknown) {
  return probeRaw(JSON.stringify(payload));
}

function assertSilentSuccess(payload: unknown) {
  const result = probe(payload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

test('generic chart payload reaches the real ECharts SVG renderer', () => {
  assertSilentSuccess({
    visualization: 'bar',
    columns: ['category', 'metric_value'],
    rows: [
      ['A', 2],
      ['B', 1],
    ],
  });
});

test('generic scalar and table payloads reach their DOM renderers', () => {
  assertSilentSuccess({
    visualization: 'scalar',
    columns: ['metric_value'],
    rows: [[2.5]],
  });
  assertSilentSuccess({
    visualization: 'table',
    columns: ['category', 'metric_value'],
    rows: [['A', 2.5]],
  });
});

test('sparkline table reaches the real ECharts SVG renderer', () => {
  assertSilentSuccess({
    visualization: 'sparkline_table',
    columns: ['category', 'time_value', 'metric_value'],
    rows: [
      ['A', '2026-09-20', 1],
      ['A', '2026-09-21', 2],
    ],
  });
});

test('invalid or unsupported payloads fail without emitting result data', () => {
  const results = [
    probe({ visualization: 'unknown', columns: ['secret'], rows: [['sensitive-value']] }),
    probe({ visualization: 'unknown', columns: ['secret'], rows: [] }),
    probe({ visualization: 'bar', columns: ['category'], rows: 'invalid' }),
    probe({ visualization: 'bar', columns: ['category'], rows: [], extra: true }),
    probe({ visualization: 'bar', columns: ['category'], rows: [[{ nested: true }]] }),
    probeRaw('{'),
    probeRaw('x'.repeat(1024 * 1024 + 1)),
  ];
  for (const result of results) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

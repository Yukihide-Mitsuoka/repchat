import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const LIVE = path.join(ROOT, 'spikes/report-generation/live_demo.py');

const CHART_RENDERER_FILES = [
  'chart_renderer_core.js',
  'chart_renderer_cartesian.js',
  'chart_renderer_indicators.js',
  'chart_renderer_composition.js',
  'chart_renderer_maps.js',
  'chart_renderer_dispatch.js',
  'chart_renderer_tables.js',
];

export function chartRendererSource() {
  return CHART_RENDERER_FILES.map((filename) =>
    readFileSync(path.join(ROOT, 'spikes/report-generation', filename), 'utf8'),
  ).join('');
}

export function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})\nimport live_demo as m\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

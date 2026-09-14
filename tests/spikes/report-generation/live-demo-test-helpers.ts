import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');

export function python(body: string) {
  return spawnSync(
    'python3',
    ['-c', `import json,sys\nsys.path.insert(0,${JSON.stringify(MODULE_DIR)})\n${body}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

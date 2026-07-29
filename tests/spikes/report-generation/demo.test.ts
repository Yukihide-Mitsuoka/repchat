import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEMO = path.join(ROOT, 'spikes/report-generation/demo.py');
const EVIDENCE_LOCK = path.join(ROOT, 'spikes/report-generation/evidence-package-lock.json');

function demo(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync('python3', [DEMO, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    input: '',
  });
}

test('the demo refuses to start without a billing project', () => {
  const env = { ...process.env };
  delete env['GOOGLE_CLOUD_PROJECT'];
  const result = demo(['--accept-cost', '--dry-run'], env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /project.*required/);
});

test('a non-interactive paid run requires explicit cost acceptance', () => {
  const result = demo(['--project', 'example-project', '--build-only']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /paid run not confirmed/);
});

test('dry-run reports every stage without installing or calling cloud services', () => {
  const result = demo(['--project', 'example-project', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /create isolated Python venv/);
  assert.match(result.stdout, /generate and verify.*Vertex AI \+ BigQuery/);
  assert.match(result.stdout, /materialize Evidence sources and build/);
  assert.match(result.stdout, /open http:\/\/localhost:3000\//);
});

test('the Evidence package definition matches the minimal audited lockfile', () => {
  const packageResult = spawnSync(
    'python3',
    [
      '-c',
      `import json, runpy; print(json.dumps(runpy.run_path(${JSON.stringify(DEMO)})["EVIDENCE_PACKAGE"]))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(packageResult.status, 0, packageResult.stderr);

  const packageDefinition = JSON.parse(packageResult.stdout);
  const lock = JSON.parse(readFileSync(EVIDENCE_LOCK, 'utf8'));
  const lockedRoot = lock.packages[''];
  assert.deepEqual(packageDefinition.dependencies, lockedRoot.dependencies);
  assert.deepEqual(packageDefinition.devDependencies, lockedRoot.devDependencies);
  assert.deepEqual(Object.keys(lockedRoot.dependencies).sort(), [
    '@evidence-dev/bigquery',
    '@evidence-dev/core-components',
    '@evidence-dev/evidence',
  ]);
  assert.equal(lock.packages['node_modules/vitest'].version, '3.2.6');
  assert.equal(packageDefinition.devDependencies.typescript, '5.4.2');
});

test('the Evidence plugin configuration matches the minimal installed packages', () => {
  const configResult = spawnSync(
    'python3',
    ['-c', `import runpy; print(runpy.run_path(${JSON.stringify(DEMO)})["EVIDENCE_CONFIG"])`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(configResult.status, 0, configResult.stderr);
  assert.match(configResult.stdout, /@evidence-dev\/core-components/);
  assert.match(configResult.stdout, /@evidence-dev\/bigquery/);
  assert.doesNotMatch(configResult.stdout, /@evidence-dev\/csv/);

  const source = readFileSync(DEMO, 'utf8');
  assert.match(source, /"evidence\.config\.yaml"\)\.write_text\(EVIDENCE_CONFIG/);
  const install = source.slice(
    source.indexOf('def install_generated_report()'),
    source.indexOf('def planned_steps('),
  );
  assert.match(install, /target_sources = EVIDENCE_DIR \/ "sources"/);
  assert.doesNotMatch(install, /EVIDENCE_DIR \/ "sources" \/ "ga4"/);
});

test('a real demo fails when npm reports a critical Evidence advisory', () => {
  const source = readFileSync(DEMO, 'utf8');
  const main = source.slice(source.indexOf('def main()'));
  assert.match(source, /"npm", "audit", "--audit-level=critical"/);
  assert.match(source, /EVIDENCE_DIR\.is_symlink\(\)/);
  assert.ok(main.indexOf('require_adc()') < main.indexOf('prepare_python()'));
});

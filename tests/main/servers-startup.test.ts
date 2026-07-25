// Startup smoke test for the two composition roots. Nothing else in CI loads
// them (they need a real DB/BigQuery), so this at least proves each main
// imports cleanly and fails CLOSED on missing configuration — a wiring typo or
// a bad import path would surface here as a non-2 exit or a crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mainPath = (name: string): string =>
  fileURLToPath(new URL(`../../src/main/${name}`, import.meta.url));

/** Run a server main with NO required env; capture exit code and stderr. */
function runWithoutEnv(name: string): Promise<{ code: number | 'timeout' | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [mainPath(name)], {
      // Only PATH — every required variable is absent, so startup must refuse.
      env: { PATH: process.env['PATH'] ?? '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    // A misconfigured start MUST exit fast. If it somehow does not, kill it and
    // report — a spawn test that can hang would freeze the whole CI run.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 'timeout', stderr });
    }, 15_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

for (const name of ['control-plane-server.ts', 'executor-server.ts']) {
  test(`${name} fails closed (exit 2) when required config is missing`, async () => {
    const { code, stderr } = await runWithoutEnv(name);
    assert.equal(code, 2, `expected a clean config-refusal exit, got ${code}`);
    assert.match(stderr, /missing required environment variable/);
  });
}

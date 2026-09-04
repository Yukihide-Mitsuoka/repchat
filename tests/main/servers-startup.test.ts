// Startup smoke test for the two composition roots. Nothing else in CI loads
// them (they need a real DB/BigQuery), so this at least proves each main
// imports cleanly and fails CLOSED on missing configuration — a wiring typo or
// a bad import path would surface here as a non-2 exit or a crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const mainPath = (name: string): string =>
  fileURLToPath(new URL(`../../src/main/${name}`, import.meta.url));
const rejectRuntimeImportsPath = fileURLToPath(
  new URL('./reject-runtime-imports.mjs', import.meta.url),
);

interface StartupResult {
  readonly code: number | 'timeout' | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly timings: {
    readonly diagnosticMs: number | null;
    readonly exitMs: number | null;
    readonly cleanupMs: number | null;
    readonly totalMs: number;
  };
}

/** Run a server main with NO required env; preserve failure phases for diagnosis. */
function runWithoutEnv(name: string, preload?: string): Promise<StartupResult> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const args = preload === undefined ? [mainPath(name)] : ['--import', preload, mainPath(name)];
    const child = spawn(process.execPath, args, {
      // Only PATH — every required variable is absent, so startup must refuse.
      env: { PATH: process.env['PATH'] ?? '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let diagnosticAt: number | null = null;
    let exitedAt: number | null = null;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let timedOut = false;
    child.stderr.on('data', (d: Buffer) => {
      diagnosticAt ??= performance.now();
      stderr += d.toString();
    });
    // A misconfigured start MUST exit fast. If it somehow does not, kill it and
    // report — a spawn test that can hang would freeze the whole CI run.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 15_000);
    child.on('exit', (code, signal) => {
      exitedAt = performance.now();
      exitCode = code;
      exitSignal = signal;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const closedAt = performance.now();
      resolve({
        code: timedOut ? 'timeout' : (exitCode ?? code),
        signal: exitSignal ?? signal,
        stderr,
        timings: {
          diagnosticMs: diagnosticAt === null ? null : diagnosticAt - startedAt,
          exitMs: exitedAt === null ? null : exitedAt - startedAt,
          cleanupMs: exitedAt === null ? null : closedAt - exitedAt,
          totalMs: closedAt - startedAt,
        },
      });
    });
  });
}

function assertConfigRefusal(result: StartupResult): void {
  const diagnostic = JSON.stringify({ signal: result.signal, timings: result.timings });
  assert.equal(
    result.code,
    2,
    `expected a clean config-refusal exit, got ${result.code}; ${diagnostic}; stderr=${JSON.stringify(result.stderr)}`,
  );
  assert.match(result.stderr, /missing required environment variable/);
}

for (const name of ['control-plane-server.ts', 'executor-server.ts']) {
  test(`${name} fails closed (exit 2) when required config is missing`, async () => {
    assertConfigRefusal(await runWithoutEnv(name));
  });

  test(`${name} validates config before loading runtime dependencies`, async () => {
    assertConfigRefusal(await runWithoutEnv(name, rejectRuntimeImportsPath));
  });
}

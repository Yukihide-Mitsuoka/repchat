import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const targets = [
  'help',
  'setup',
  'format',
  'lint',
  'test',
  'test-unit',
  'test-integration',
  'coverage',
  'build',
  'run',
  'security-scan',
  'sbom',
  'clean',
  'doctor',
  'doctor-slow',
  'infra-plan',
  'deploy',
  'destroy',
];

for (const target of targets) {
  test(`Make ${target} has only one Task command`, () => {
    const result = spawnSync('make', ['--no-print-directory', '-n', target], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.match(result.stdout, new RegExp(`task "${target}"`));
  });
}

test('Make forwards a quoted FILE as one Task variable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-compatibility-'));
  try {
    const capture = join(directory, 'capture');
    const fakeTask = join(directory, 'task');
    writeFileSync(fakeTask, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n');
    chmodSync(fakeTask, 0o755);
    const filename = 'file "quoted" `printf BAD`.ts';
    for (const target of ['format', 'lint']) {
      const result = spawnSync('make', ['--no-print-directory', target, `FILE=${filename}`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE_FILE: capture },
      });
      assert.equal(result.status, 0);
      assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
        target,
        `FILE=${filename}`,
      ]);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('Make propagates Task failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-compatibility-'));
  try {
    const fakeTask = join(directory, 'task');
    writeFileSync(fakeTask, '#!/bin/sh\nexit 23\n');
    chmodSync(fakeTask, 0o755);
    const result = spawnSync('make', ['--no-print-directory', 'help'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

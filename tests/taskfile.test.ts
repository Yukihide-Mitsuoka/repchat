import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('native Task entry has no Make shim or optional profile copies', () => {
  for (const path of [
    'Makefile',
    'profiles/README.md',
    'profiles/python-uv/Makefile',
    'profiles/typescript-node/Makefile',
    'profiles/terraform-gcp/Makefile',
  ]) {
    assert.equal(existsSync(path), false, path);
  }
});

test('Dev Container installs pinned Task before doctor', () => {
  const config = JSON.parse(
    readFileSync('.devcontainer/devcontainer.json', 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  );
  assert.equal(
    config.postCreateCommand,
    'npm install -g @anthropic-ai/claude-code @go-task/cli@3.53.1 && task doctor',
  );
});

test('Task lists canonical and project tasks without executing them', () => {
  const result = spawnSync('task', ['--list-all'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const task of [
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
  ]) {
    assert.ok(result.stdout.includes(`* ${task}:`), task);
  }
});

test('Task passes a quoted FILE unchanged to formatting and lint tools', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-task-'));
  try {
    const capture = join(directory, 'capture');
    const tool = join(directory, 'npx');
    writeFileSync(tool, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n');
    chmodSync(tool, 0o755);
    const filename = 'file "quoted" `printf BAD`.ts';
    for (const [task, flag] of [
      ['format', '--write'],
      ['lint', '--check'],
    ] as const) {
      const result = spawnSync('task', [task, `FILE=${filename}`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE_FILE: capture },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
        'prettier',
        flag,
        '--ignore-unknown',
        filename,
      ]);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('Task propagates tool failure without fallback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-task-'));
  try {
    const tool = join(directory, 'npx');
    writeFileSync(tool, '#!/bin/sh\nexit 23\n');
    chmodSync(tool, 0o755);
    const result = spawnSync('task', ['format', 'FILE=sample.ts'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, null);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exit status 23/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('Task rejects unknown tasks', () => {
  const result = spawnSync('task', ['unknown-test-task'], { encoding: 'utf8' });
  assert.notEqual(result.status, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
});

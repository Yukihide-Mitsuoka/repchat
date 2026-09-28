import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

function job(name: string): string {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/^  [a-z][a-z-]*:\n/m);
  return next < 0 ? rest : rest.slice(0, next);
}

for (const [name, expected] of [
  ['lint', ['setup', 'lint']],
  ['test', ['setup', 'coverage']],
  ['build', ['setup', 'build']],
  ['doctor', ['doctor']],
  ['doctor-slow', ['doctor-slow']],
] as const) {
  test(`CI installs Task before canonical commands in ${name}`, () => {
    const steps = job(name);
    const action = 'uses: ./scripts/actions/setup-task';
    assert.equal(steps.split(action).length, 2);
    assert.ok(steps.indexOf('uses: actions/checkout@') < steps.indexOf(action));
    assert.ok(steps.indexOf(action) < steps.indexOf('run: task '));
    assert.deepEqual(
      [...steps.matchAll(/- run: task ([a-z-]+)/g)].map((match) => match[1]),
      expected,
    );
    assert.doesNotMatch(steps, /- run: make /);
  });
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('tracked files use only the RepChat repository identity', () => {
  const legacyIdentityTokens = [['chat', 'chart'].join('-'), ['chat', 'chart'].join('')];
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const historicalEvidence = new Set([
    '.ai/decision-log.md',
    'CHANGELOG.md',
    'docs/discovery-log.md',
  ]);
  const occurrences = trackedFiles.flatMap((path) => {
    if (historicalEvidence.has(path)) return [];
    const content = readFileSync(path, 'utf8');
    return legacyIdentityTokens.some((token) => content.toLowerCase().includes(token))
      ? [path]
      : [];
  });

  assert.deepEqual(
    occurrences,
    [],
    `replace the legacy repository identity in: ${occurrences.join(', ')}`,
  );
});

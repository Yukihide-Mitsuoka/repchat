import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const legacyIdentityTokens = [['chat', 'chart'].join('-'), ['chat', 'chart'].join('')];
const retiredRepository = ['Yukihide-Mitsuoka', legacyIdentityTokens[0]].join('/');
const permittedPreventionLines = new Map<string, ReadonlySet<string>>([
  [
    '.github/inheritance/README.md',
    new Set([`and rejects reintroduction of the retired \`${retiredRepository}\` repository.`]),
  ],
  ['docs/foundation/inheritance-fleet.json', new Set([`    "${retiredRepository}"`])],
  [
    'scripts/tests/test_template_inheritance_plan.py',
    new Set([`            config["retired_repositories"], ["${retiredRepository}"]`]),
  ],
]);

function findUnexpectedLegacyIdentityLines(
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  return files.flatMap(({ path, content }) =>
    content.split('\n').flatMap((line, index) => {
      const containsLegacyIdentity = legacyIdentityTokens.some((token) =>
        line.toLowerCase().includes(token),
      );
      if (!containsLegacyIdentity || permittedPreventionLines.get(path)?.has(line)) {
        return [];
      }
      return [`${path}:${index + 1}`];
    }),
  );
}

test('legacy identity prevention metadata is permitted only at exact foundation lines', () => {
  const permittedFiles = [...permittedPreventionLines].map(([path, lines]) => ({
    path,
    content: [...lines].join('\n'),
  }));

  assert.deepEqual(findUnexpectedLegacyIdentityLines(permittedFiles), []);
  assert.deepEqual(
    findUnexpectedLegacyIdentityLines([
      {
        path: 'docs/foundation/inheritance-fleet.json',
        content: `active_parent: ${retiredRepository}`,
      },
      { path: 'README.md', content: `Migrated from ${retiredRepository}` },
    ]),
    ['docs/foundation/inheritance-fleet.json:1', 'README.md:1'],
  );
});

test('tracked files use only the RepChat repository identity', () => {
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
  const occurrences = findUnexpectedLegacyIdentityLines(
    trackedFiles
      .filter((path) => !historicalEvidence.has(path))
      .map((path) => ({ path, content: readFileSync(path, 'utf8') })),
  );

  assert.deepEqual(
    occurrences,
    [],
    `replace the legacy repository identity in: ${occurrences.join(', ')}`,
  );
});

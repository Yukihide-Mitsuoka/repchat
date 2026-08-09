import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const legacyIdentityTokens = [['chat', 'chart'].join('-'), ['chat', 'chart'].join('')];
const inheritanceManifest = JSON.parse(
  readFileSync('.github/inheritance/manifest.json', 'utf8'),
) as { inherited_paths: string[] };

function isInheritedPath(path: string): boolean {
  return inheritanceManifest.inherited_paths.some((root) =>
    root.endsWith('/') ? path.startsWith(root) : path === root,
  );
}

function findUnexpectedLegacyIdentityLines(
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  return files.flatMap(({ path, content }) =>
    content.split('\n').flatMap((line, index) => {
      const containsLegacyIdentity = legacyIdentityTokens.some((token) =>
        line.toLowerCase().includes(token),
      );
      if (!containsLegacyIdentity) {
        return [];
      }
      return [`${path}:${index + 1}`];
    }),
  );
}

test('foundation paths are outside the RepChat repository identity namespace', () => {
  assert.equal(isInheritedPath('.github/inheritance/README.md'), true);
  assert.equal(isInheritedPath('docs/foundation/inheritance-fleet.json'), true);
  assert.equal(isInheritedPath('scripts/tests/test_template_inheritance_plan.py'), true);
  assert.equal(isInheritedPath('README.md'), false);
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
      .filter((path) => !historicalEvidence.has(path) && !isInheritedPath(path))
      .map((path) => ({ path, content: readFileSync(path, 'utf8') })),
  );

  assert.deepEqual(
    occurrences,
    [],
    `replace the legacy repository identity in: ${occurrences.join(', ')}`,
  );
});

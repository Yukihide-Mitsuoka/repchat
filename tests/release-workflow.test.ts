import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

test('main-push releases explicitly attach the generated SBOM to the created tag', () => {
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]/);
  assert.match(workflow, /name: Attach generated SBOM to GitHub Release/);
  assert.match(
    workflow,
    /RELEASE_TAG: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}/,
  );
  assert.match(workflow, /test -s "\$SBOM_PATH"/);
  assert.match(
    workflow,
    /gh release upload "\$RELEASE_TAG" "\$SBOM_ASSET" --clobber/,
  );
  assert.doesNotMatch(workflow, /RELEASE_TAG: \$\{\{ github\.ref_name \}\}/);
});

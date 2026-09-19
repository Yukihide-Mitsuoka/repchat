import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const ASSEMBLER = path.join(ROOT, 'spikes/schema-generalization-evaluation/assemble.py');
const REQUIRED_CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function evidenceBundle() {
  const fingerprints = {
    runtime: '1'.repeat(64),
    prompt: '2'.repeat(64),
    configuration: '3'.repeat(64),
  };
  return {
    version: 1,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: ['scope-a', 'scope-b'].map((schemaId, schemaIndex) => {
      const scopeContent = JSON.stringify({ schema_id: schemaId, version: 1 });
      const scopeFingerprint = createHash('sha256').update(scopeContent).digest('hex');
      const contractFingerprint = String(schemaIndex + 6).repeat(64);
      const expectedRows = [{ category: `group-${schemaIndex}`, metric_value: schemaIndex + 1 }];
      return {
        schema_id: schemaId,
        scope_snapshot_fingerprint: scopeFingerprint,
        cases: [
          {
            case_id: 'question-1',
            question: '区分別の値を集計して',
            reference: {
              sql: 'SELECT category, SUM(value) AS metric_value FROM authorized_table GROUP BY category',
              expected_rows: expectedRows,
              row_order: 'unordered',
              author_id: `author-${schemaIndex}`,
              reviewer_id: `reviewer-${schemaIndex}`,
              reviewed_at: '2026-09-19T00:00:00Z',
            },
            runs: Array.from({ length: 3 }, (_, runIndex) => ({
              run_id: `run-${runIndex + 1}`,
              ...fingerprints,
              runtime_input: {
                scope_snapshot_fingerprint: scopeFingerprint,
                analysis_contract_fingerprint: contractFingerprint,
                question: '区分別の値を集計して',
              },
              generated_sql:
                'SELECT category, SUM(value) AS metric_value FROM authorized_table GROUP BY category',
              sql_execution_succeeded: true,
              actual_rows: expectedRows,
              unauthorized_reference: false,
              dangerous_sql: false,
              scan_limit_exceeded: false,
              semantic_error: false,
              render_succeeded: true,
              bytes_processed: 100,
              cost_jpy: 0.1,
            })),
          },
        ],
      };
    }),
  };
}

function separatedEvidence() {
  const bundle = evidenceBundle();
  const fixture = {
    version: 2,
    thresholds: bundle.thresholds,
    schemas: bundle.schemas.map((schema) => ({
      schema_id: schema.schema_id,
      scope_snapshot_fingerprint: schema.scope_snapshot_fingerprint,
      cases: schema.cases.map(({ runs: _runs, ...referenceCase }) => ({
        ...referenceCase,
        capabilities: REQUIRED_CAPABILITIES,
      })),
    })),
  };
  const recordings = {
    version: 2,
    reviewed_fixture_sha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    runs: bundle.schemas.flatMap((schema) =>
      schema.cases.flatMap((evaluationCase) =>
        evaluationCase.runs.map((run) => ({
          schema_id: schema.schema_id,
          case_id: evaluationCase.case_id,
          run,
        })),
      ),
    ),
  };
  const scopeSnapshots = {
    version: 1,
    snapshots: bundle.schemas.map((schema) => ({
      schema_id: schema.schema_id,
      content_json: JSON.stringify({ schema_id: schema.schema_id, version: 1 }),
      retrieved_at: '2026-09-20T00:00:00+00:00',
    })),
  };
  return { bundle, fixture, recordings, scopeSnapshots };
}

function assemble(
  fixture: object,
  recordings: object,
  scopeSnapshots: object,
  preexistingOutput = false,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'schema-fixture-'));
  const fixturePath = path.join(directory, 'fixture.json');
  const recordingsPath = path.join(directory, 'recordings.json');
  const scopeSnapshotsPath = path.join(directory, 'scope-snapshots.json');
  const bundlePath = path.join(directory, 'evidence.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(recordingsPath, JSON.stringify(recordings));
  writeFileSync(scopeSnapshotsPath, JSON.stringify(scopeSnapshots));
  if (preexistingOutput) writeFileSync(bundlePath, JSON.stringify({ preserved: true }));
  try {
    const result = spawnSync(
      'python3',
      [ASSEMBLER, fixturePath, recordingsPath, scopeSnapshotsPath, bundlePath],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    return {
      result,
      bundle: existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, 'utf8')) : undefined,
      mode: existsSync(bundlePath) ? statSync(bundlePath).mode & 0o777 : undefined,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('reviewed fixture and separately recorded runs assemble deterministically', () => {
  const { bundle, fixture, recordings, scopeSnapshots } = separatedEvidence();

  const { result, bundle: assembled, mode } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(assembled, bundle);
  assert.equal(mode, 0o600);
});

test('reference fixture cannot contain runtime runs', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  Object.assign(fixture.schemas[0]!.cases[0]!, { runs: [] });

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture cases may contain only ID, question, and reference/);
  assert.equal(result.stdout, '');
});

test('recorded runs cannot contain reference answers', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  Object.assign(recordings.runs[0]!.run, { reference: { expected_rows: [] } });

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run contains unsupported or missing fields/);
  assert.equal(result.stdout, '');
});

test('recorded runs must name one fixture schema and case', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.runs[0]!.case_id = 'unknown-case';

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recorded run does not match a fixture schema and case/);
  assert.equal(result.stdout, '');
});

test('every fixture case must have at least one separately recorded run', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.runs = recordings.runs.filter((record) => record.schema_id !== 'scope-a');

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /each fixture case must have recorded runs/);
  assert.equal(result.stdout, '');
});

test('fixture version must be an integer rather than a JSON boolean', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  fixture.version = true as unknown as number;

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture version must be 2/);
  assert.equal(result.stdout, '');
});

test('recordings version must be an integer rather than a JSON boolean', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.version = true as unknown as number;

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recordings version must be 2/);
  assert.equal(result.stdout, '');
});

test('recorded runs cannot be assembled against a changed reviewed fixture', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  fixture.schemas[0]!.cases[0]!.reference.expected_rows = [
    { category: 'changed-after-review', metric_value: 999 },
  ];

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recordings must bind to the exact reviewed fixture/);
  assert.equal(result.stdout, '');
});

test('reviewed fixture fingerprint must be a lowercase SHA-256 value', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.reviewed_fixture_sha256 = 'A'.repeat(64);

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /reviewed fixture fingerprint must be a lowercase SHA-256 value/);
  assert.equal(result.stdout, '');
});

test('assembler refuses to overwrite an existing evidence artifact', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();

  const { result, bundle } = assemble(fixture, recordings, scopeSnapshots, true);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evidence output already exists/);
  assert.deepEqual(bundle, { preserved: true });
});

test('every schema fixture must cover every required analysis capability', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  fixture.schemas[0]!.cases[0]!.capabilities = REQUIRED_CAPABILITIES.slice(0, -1);

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /each fixture schema must cover every required capability/);
  assert.equal(result.stdout, '');
});

test('fixture capabilities reject unknown or duplicated labels', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  fixture.schemas[0]!.cases[0]!.capabilities = [...REQUIRED_CAPABILITIES, 'unknown'];

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture case capabilities are invalid/);
  assert.equal(result.stdout, '');
});

test('scope snapshot content must match the fixture fingerprint', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  scopeSnapshots.snapshots[0]!.content_json = JSON.stringify({ schema_id: 'changed', version: 1 });

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /scope snapshot content must match its fixture fingerprint/);
  assert.equal(result.stdout, '');
});

test('every fixture schema must have exactly one scope snapshot', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  scopeSnapshots.snapshots.pop();

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /scope snapshots must match fixture schema IDs exactly/);
  assert.equal(result.stdout, '');
});

test('scope snapshot content must preserve the canonical runtime representation', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  scopeSnapshots.snapshots[0]!.content_json = '{"version":1, "schema_id":"scope-a"}';

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /scope snapshot content must be canonical JSON/);
  assert.equal(result.stdout, '');
});

test('scope snapshot retrieval time must include a timezone', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  scopeSnapshots.snapshots[0]!.retrieved_at = '2026-09-20T00:00:00';

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /scope snapshot retrieval time must include a timezone/);
  assert.equal(result.stdout, '');
});

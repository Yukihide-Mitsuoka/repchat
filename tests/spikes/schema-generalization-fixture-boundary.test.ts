import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const ASSEMBLER = path.join(ROOT, 'spikes/schema-generalization-evaluation/assemble.py');

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
      const scopeFingerprint = String(schemaIndex + 4).repeat(64);
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
    version: bundle.version,
    thresholds: bundle.thresholds,
    schemas: bundle.schemas.map((schema) => ({
      schema_id: schema.schema_id,
      scope_snapshot_fingerprint: schema.scope_snapshot_fingerprint,
      cases: schema.cases.map(({ runs: _runs, ...referenceCase }) => referenceCase),
    })),
  };
  const recordings = {
    version: 1,
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
  return { bundle, fixture, recordings };
}

function assemble(fixture: object, recordings: object) {
  const directory = mkdtempSync(path.join(tmpdir(), 'schema-fixture-'));
  const fixturePath = path.join(directory, 'fixture.json');
  const recordingsPath = path.join(directory, 'recordings.json');
  const bundlePath = path.join(directory, 'evidence.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(recordingsPath, JSON.stringify(recordings));
  try {
    const result = spawnSync('python3', [ASSEMBLER, fixturePath, recordingsPath, bundlePath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return {
      result,
      bundle: existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, 'utf8')) : undefined,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('reviewed fixture and separately recorded runs assemble deterministically', () => {
  const { bundle, fixture, recordings } = separatedEvidence();

  const { result, bundle: assembled } = assemble(fixture, recordings);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(assembled, bundle);
});

test('reference fixture cannot contain runtime runs', () => {
  const { fixture, recordings } = separatedEvidence();
  Object.assign(fixture.schemas[0]!.cases[0]!, { runs: [] });

  const { result } = assemble(fixture, recordings);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture cases may contain only ID, question, and reference/);
  assert.equal(result.stdout, '');
});

test('recorded runs cannot contain reference answers', () => {
  const { fixture, recordings } = separatedEvidence();
  Object.assign(recordings.runs[0]!.run, { reference: { expected_rows: [] } });

  const { result } = assemble(fixture, recordings);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run contains unsupported or missing fields/);
  assert.equal(result.stdout, '');
});

test('recorded runs must name one fixture schema and case', () => {
  const { fixture, recordings } = separatedEvidence();
  recordings.runs[0]!.case_id = 'unknown-case';

  const { result } = assemble(fixture, recordings);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recorded run does not match a fixture schema and case/);
  assert.equal(result.stdout, '');
});

test('every fixture case must have at least one separately recorded run', () => {
  const { fixture, recordings } = separatedEvidence();
  recordings.runs = recordings.runs.filter((record) => record.schema_id !== 'scope-a');

  const { result } = assemble(fixture, recordings);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /each fixture case must have recorded runs/);
  assert.equal(result.stdout, '');
});

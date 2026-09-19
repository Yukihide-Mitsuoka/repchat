import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const EVALUATOR = path.join(ROOT, 'spikes/schema-generalization-evaluation/evaluate.py');
const FINGERPRINTS = {
  runtime: '1'.repeat(64),
  prompt: '2'.repeat(64),
  configuration: '3'.repeat(64),
};

function evidenceBundle() {
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
              ...FINGERPRINTS,
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

function evaluate(bundle: object) {
  const directory = mkdtempSync(path.join(tmpdir(), 'schema-evaluation-'));
  const bundlePath = path.join(directory, 'evidence.json');
  writeFileSync(bundlePath, JSON.stringify(bundle));
  try {
    return spawnSync('python3', [EVALUATOR, bundlePath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('two schemas with three matching runs produce passing evidence', () => {
  const result = evaluate(evidenceBundle());

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.schema_count, 2);
  assert.equal(report.run_count, 6);
  assert.equal(report.result_match_rate, 1);
  assert.deepEqual(
    report.schemas.map((schema: { schema_id: string; passed: boolean }) => schema),
    [
      {
        schema_id: 'scope-a',
        case_count: 1,
        run_count: 3,
        sql_execution_success_rate: 1,
        result_match_rate: 1,
        render_success_rate: 1,
        semantic_error_rate: 0,
        unauthorized_reference_count: 0,
        dangerous_sql_count: 0,
        scan_limit_exceeded_count: 0,
        total_bytes_processed: 300,
        total_cost_jpy: 0.3,
        passed: true,
      },
      {
        schema_id: 'scope-b',
        case_count: 1,
        run_count: 3,
        sql_execution_success_rate: 1,
        result_match_rate: 1,
        render_success_rate: 1,
        semantic_error_rate: 0,
        unauthorized_reference_count: 0,
        dangerous_sql_count: 0,
        scan_limit_exceeded_count: 0,
        total_bytes_processed: 300,
        total_cost_jpy: 0.3,
        passed: true,
      },
    ],
  );
});

test('a fingerprint change between schema runs is rejected before scoring', () => {
  const bundle = evidenceBundle();
  bundle.schemas[1]!.cases[0]!.runs[0]!.runtime = '9'.repeat(64);

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /all runs must use one runtime, prompt, and configuration fingerprint/,
  );
  assert.equal(result.stdout, '');
});

test('reference answers cannot appear in the recorded runtime input', () => {
  const bundle = evidenceBundle();
  Object.assign(bundle.schemas[0]!.cases[0]!.runs[0]!.runtime_input, {
    expected_rows: bundle.schemas[0]!.cases[0]!.reference.expected_rows,
  });

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /runtime_input may contain only scope, contract, and question/);
  assert.equal(result.stdout, '');
});

test('repeated runs of one case must reproduce one analysis contract', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0].cases[0].runs[1].runtime_input.analysis_contract_fingerprint = 'f'.repeat(64);

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /each case must reproduce one analysis contract fingerprint/);
  assert.equal(result.stdout, '');
});

test('evaluation thresholds cannot be relaxed by the evidence bundle', () => {
  const bundle = evidenceBundle();
  bundle.thresholds.minimum_runs_per_case = 1;
  bundle.thresholds.minimum_result_match_rate = 0;

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /thresholds cannot be lower than the fixed acceptance policy/);
  assert.equal(result.stdout, '');
});

test('unknown result ordering semantics are rejected instead of guessed', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0].cases[0].reference.row_order = 'implicit';

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /reference row_order must be ordered or unordered/);
  assert.equal(result.stdout, '');
});

test('unsafe or mismatched runs remain visible in a failing report', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0].cases[0].runs[0];
  failedRun.actual_rows = [{ category: 'wrong', metric_value: 999 }];
  failedRun.dangerous_sql = true;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.result_match_rate, 0.833333);
  assert.deepEqual(
    {
      result_match_rate: report.schemas[0].result_match_rate,
      dangerous_sql_count: report.schemas[0].dangerous_sql_count,
      passed: report.schemas[0].passed,
    },
    { result_match_rate: 0.666667, dangerous_sql_count: 1, passed: false },
  );
  assert.equal(report.schemas[1].passed, true);
});

test('a semantic error fails evaluation even when result rows match', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0].cases[0].runs[0].semantic_error = true;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemas[0].result_match_rate, 1);
  assert.equal(report.schemas[0].semantic_error_rate, 0.333333);
  assert.equal(report.schemas[0].passed, false);
  assert.equal(report.passed, false);
});

test('unsupported evidence versions are rejected before evaluation', () => {
  const bundle = evidenceBundle();
  bundle.version = 2;

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evidence version must be 1/);
  assert.equal(result.stdout, '');
});

test('safety outcomes must be JSON booleans rather than truthy strings', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0].cases[0].runs[0].dangerous_sql = 'false' as unknown as boolean;

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run safety and outcome fields must be booleans/);
  assert.equal(result.stdout, '');
});

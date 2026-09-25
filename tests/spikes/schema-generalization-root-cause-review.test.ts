import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const REVIEWER = path.join(ROOT, 'spikes/schema-generalization-evaluation/root_cause_review.py');
const CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function evidenceBundle() {
  return {
    version: 6,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: ['scope-a', 'scope-b'].map((schemaId, schemaIndex) => {
      const expectedRows = [{ metric_value: schemaIndex + 1 }];
      return {
        schema_id: schemaId,
        scope_snapshot_fingerprint: String(schemaIndex + 4).repeat(64),
        cases: [
          {
            case_id: 'case-1',
            question: '値を集計して',
            capabilities: CAPABILITIES,
            reference: {
              sql: 'SELECT 1 AS metric_value',
              expected_rows: expectedRows,
              row_order: 'unordered',
              author_id: 'author',
              reviewer_id: 'reference-reviewer',
              reviewed_at: '2026-09-25T00:00:00Z',
            },
            runs: Array.from({ length: 3 }, (_, index) => ({
              run_id: `run-${index + 1}`,
              runtime: '1'.repeat(64),
              prompt: '2'.repeat(64),
              configuration: '3'.repeat(64),
              runtime_input: {
                scope_snapshot_fingerprint: String(schemaIndex + 4).repeat(64),
                analysis_contract_fingerprint: String(schemaIndex + 6).repeat(64),
                question: '値を集計して',
              },
              generated_sql: 'SELECT 1 AS metric_value',
              failure_stage: 'none',
              failure_code: '',
              failure_kind: 'none',
              diagnostic: null,
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

function runReview(evidence: object, reviews: object[], fingerprint?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'root-cause-review-'));
  const evidencePath = path.join(directory, 'evidence.json');
  const reviewPath = path.join(directory, 'review.json');
  const evidenceBytes = JSON.stringify(evidence);
  writeFileSync(evidencePath, evidenceBytes);
  writeFileSync(
    reviewPath,
    JSON.stringify({
      version: 1,
      evidence_sha256: fingerprint ?? createHash('sha256').update(evidenceBytes).digest('hex'),
      reviews,
    }),
  );
  try {
    return spawnSync('python3', [REVIEWER, evidencePath, reviewPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function review(cause = 'join_path') {
  return {
    schema_id: 'scope-a',
    case_id: 'case-1',
    run_id: 'run-1',
    cause,
    reviewer_id: 'diagnostic-reviewer',
    basis: ['generated_sql', 'reviewed_reference'],
  };
}

test('post-run review counts a classified mismatch without exposing rows or SQL', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  const result = runReview(evidence, [review()]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    reviewed_mismatch_count: 1,
    cause_counts: { join_path: 1 },
    cause_case_counts: { join_path: 1 },
  });
  assert.doesNotMatch(result.stdout, /metric_value|SELECT/);
});

test('every nonmatching quality run requires exactly one review', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  assert.equal(runReview(evidence, []).status, 2);
  assert.equal(runReview(evidence, [review(), review()]).status, 2);
});

test('matching runs cannot receive a root-cause annotation', () => {
  assert.equal(runReview(evidenceBundle(), [review()]).status, 2);
  assert.equal(runReview(evidenceBundle(), []).status, 0);
});

test('review is bound to the exact evidence bytes', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  assert.equal(runReview(evidence, [review()], '0'.repeat(64)).status, 2);
});

test('unknown cause or evidence basis is rejected', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  assert.equal(runReview(evidence, [review('unknown')]).status, 2);
  assert.equal(runReview(evidence, [{ ...review(), basis: ['raw_customer_value'] }]).status, 2);
});

test('repeated mismatches in one case count as one affected case', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];
  evidence.schemas[0]!.cases[0]!.runs[1]!.actual_rows = [{ metric_value: 8 }];

  const result = runReview(evidence, [review(), { ...review(), run_id: 'run-2' }]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cause_counts.join_path, 2);
  assert.equal(JSON.parse(result.stdout).cause_case_counts.join_path, 1);
});

test('infrastructure failures are not assigned a quality root cause', () => {
  const evidence = evidenceBundle();
  const run = evidence.schemas[0]!.cases[0]!.runs[0]!;
  run.actual_rows = [{ metric_value: 9 }];
  run.failure_stage = 'rendering';
  run.failure_code = 'renderer_infrastructure_failed';
  run.failure_kind = 'infrastructure';
  run.render_succeeded = false;

  const result = runReview(evidence, []);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reviewed_mismatch_count, 0);
});

test('a reference without a distinct reviewer ID cannot be classified', () => {
  const evidence = evidenceBundle();
  evidence.schemas[0]!.cases[0]!.reference.reviewer_id = 'author';
  evidence.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  assert.equal(runReview(evidence, [review()]).status, 2);
});

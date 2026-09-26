import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const COMPARATOR = path.join(ROOT, 'spikes/schema-generalization-evaluation/compare_evidence.py');
const CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function evidenceBundle(contract = '6') {
  return {
    version: 6,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: ['scope-a', 'scope-b'].map((schemaId, schemaIndex) => {
      const expectedRows = [{ metric_value: schemaIndex + 1 }];
      const scopeFingerprint = String(schemaIndex + 4).repeat(64);
      return {
        schema_id: schemaId,
        scope_snapshot_fingerprint: scopeFingerprint,
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
                scope_snapshot_fingerprint: scopeFingerprint,
                analysis_contract_fingerprint: contract.repeat(64),
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

function compare(baseline: object, diagnostic: object) {
  const directory = mkdtempSync(path.join(tmpdir(), 'paired-evidence-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const diagnosticPath = path.join(directory, 'diagnostic.json');
  writeFileSync(baselinePath, JSON.stringify(baseline));
  writeFileSync(diagnosticPath, JSON.stringify(diagnostic));
  try {
    return spawnSync('python3', [COMPARATOR, baselinePath, diagnosticPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('paired evidence reports rates separately without leaking reference data', () => {
  const baseline = evidenceBundle();
  const diagnostic = evidenceBundle('7');
  baseline.schemas[0]!.cases[0]!.runs[0]!.actual_rows = [{ metric_value: 9 }];

  const result = compare(baseline, diagnostic);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.contract_changed_case_count, 2);
  assert.equal(report.baseline.result_match_rate, 0.833333);
  assert.equal(report.diagnostic.result_match_rate, 1);
  assert.equal(report.cases[0].baseline_result_match_rate, 0.666667);
  assert.equal(report.cases[0].diagnostic_result_match_rate, 1);
  assert.doesNotMatch(result.stdout, /metric_value|SELECT|値を集計して/);
});

test('comparison rejects changed references, scopes, run IDs, or pipeline fingerprints', () => {
  const baseline = evidenceBundle();
  const changedReference = evidenceBundle('7');
  changedReference.schemas[0]!.cases[0]!.reference.expected_rows = [{ metric_value: 9 }];
  assert.equal(compare(baseline, changedReference).status, 2);

  const changedScope = evidenceBundle('7');
  changedScope.schemas[0]!.scope_snapshot_fingerprint = '8'.repeat(64);
  changedScope.schemas[0]!.cases[0]!.runs.forEach((run) => {
    run.runtime_input.scope_snapshot_fingerprint = '8'.repeat(64);
  });
  assert.equal(compare(baseline, changedScope).status, 2);

  const changedRuns = evidenceBundle('7');
  changedRuns.schemas[0]!.cases[0]!.runs[0]!.run_id = 'replacement';
  assert.equal(compare(baseline, changedRuns).status, 2);

  const changedPipeline = evidenceBundle('7');
  changedPipeline.schemas.forEach((schema) =>
    schema.cases[0]!.runs.forEach((run) => {
      run.prompt = '9'.repeat(64);
    }),
  );
  assert.equal(compare(baseline, changedPipeline).status, 2);
});

test('comparison rejects identical contracts and infrastructure failures', () => {
  assert.equal(compare(evidenceBundle(), evidenceBundle()).status, 2);

  const diagnostic = evidenceBundle('7');
  const run = diagnostic.schemas[0]!.cases[0]!.runs[0]!;
  run.failure_stage = 'rendering';
  run.failure_code = 'renderer_infrastructure_failed';
  run.failure_kind = 'infrastructure';
  run.render_succeeded = false;
  assert.equal(compare(evidenceBundle(), diagnostic).status, 2);
});

test('comparison rejects references without an independent reviewer', () => {
  const baseline = evidenceBundle();
  const diagnostic = evidenceBundle('7');
  baseline.schemas[0]!.cases[0]!.reference.reviewer_id = 'author';
  diagnostic.schemas[0]!.cases[0]!.reference.reviewer_id = 'author';

  assert.equal(compare(baseline, diagnostic).status, 2);
});

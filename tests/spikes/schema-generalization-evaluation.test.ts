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
type Diagnostic = { code: string; category: string } | null;
const REQUIRED_CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function evidenceBundle() {
  return {
    version: 5,
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
            capabilities: REQUIRED_CAPABILITIES,
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
              failure_stage: 'none',
              failure_code: '',
              diagnostic: null as Diagnostic,
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
        cases: [
          {
            case_id: 'question-1',
            run_count: 3,
            result_match_rate: 1,
            render_success_rate: 1,
            semantic_error_count: 0,
            unauthorized_reference_count: 0,
            dangerous_sql_count: 0,
            scan_limit_exceeded_count: 0,
            passed: true,
          },
        ],
        capability_success_counts: Object.fromEntries(
          REQUIRED_CAPABILITIES.map((capability) => [capability, 3]),
        ),
        run_count: 3,
        failure_count: 0,
        failure_stage_counts: {},
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
        cases: [
          {
            case_id: 'question-1',
            run_count: 3,
            result_match_rate: 1,
            render_success_rate: 1,
            semantic_error_count: 0,
            unauthorized_reference_count: 0,
            dangerous_sql_count: 0,
            scan_limit_exceeded_count: 0,
            passed: true,
          },
        ],
        capability_success_counts: Object.fromEntries(
          REQUIRED_CAPABILITIES.map((capability) => [capability, 3]),
        ),
        run_count: 3,
        failure_count: 0,
        failure_stage_counts: {},
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

test('one failing case cannot be hidden by another case in the same schema', () => {
  const bundle = evidenceBundle();
  const cases = bundle.schemas[0]!.cases;
  const passingCase = cases[0]!;
  passingCase.runs = Array.from({ length: 27 }, (_, index) => ({
    ...structuredClone(passingCase.runs[index % 3]!),
    run_id: `passing-${index}`,
  }));
  const failingCase = structuredClone(passingCase);
  failingCase.case_id = 'question-2';
  passingCase.capabilities = REQUIRED_CAPABILITIES.slice(0, -1);
  failingCase.capabilities = ['ordered_behavior'];
  failingCase.runs = Array.from({ length: 3 }, (_, index) => ({
    ...structuredClone(passingCase.runs[index]!),
    run_id: `failing-${index}`,
    actual_rows: [{ category: 'wrong', metric_value: 999 }],
  }));
  cases.push(failingCase);

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemas[0].result_match_rate, 0.9);
  assert.equal(report.schemas[0].cases[1].result_match_rate, 0);
  assert.equal(report.schemas[0].cases[1].passed, false);
  assert.equal(report.schemas[0].capability_success_counts.ordered_behavior, 0);
  assert.equal(report.schemas[0].passed, false);
});

test('required capabilities report successful end-to-end run counts', () => {
  const result = evaluate(evidenceBundle());

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    report.schemas[0].capability_success_counts,
    Object.fromEntries(REQUIRED_CAPABILITIES.map((capability) => [capability, 3])),
  );
});

test('evidence rejects incomplete or unknown capability assignments', () => {
  const incomplete = evidenceBundle();
  incomplete.schemas[0]!.cases[0]!.capabilities = REQUIRED_CAPABILITIES.slice(0, -1);
  assert.match(evaluate(incomplete).stderr, /each schema must cover every required capability/);

  const unknown = evidenceBundle();
  unknown.schemas[0]!.cases[0]!.capabilities = ['unknown'];
  assert.match(evaluate(unknown).stderr, /case capabilities are invalid/);
});

test('a matching result with failed rendering does not pass end to end', () => {
  const bundle = evidenceBundle();
  const run = bundle.schemas[0]!.cases[0]!.runs[0]!;
  run.failure_stage = 'rendering';
  run.failure_code = 'rendering_failed';
  run.render_succeeded = false;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemas[0].result_match_rate, 1);
  assert.equal(report.schemas[0].cases[0].render_success_rate, 0.666667);
  assert.equal(report.schemas[0].passed, false);
});

test('an infrastructure failure is excluded from quality rates and prevents passing', () => {
  const bundle = evidenceBundle();
  const run = bundle.schemas[0]!.cases[0]!.runs[0]!;
  Object.assign(run, {
    failure_kind: 'infrastructure',
    failure_stage: 'dry_run',
    failure_code: 'dry_run_failed',
    diagnostic: { code: 'dry_run_provider_failure', category: 'provider_failure' },
    sql_execution_succeeded: false,
    actual_rows: [],
    render_succeeded: false,
  });
  for (const schema of bundle.schemas) {
    for (const candidate of schema.cases[0]!.runs) {
      if (!('failure_kind' in candidate)) Object.assign(candidate, { failure_kind: 'none' });
    }
  }

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result_match_rate, 1);
  assert.equal(report.schemas[0].quality_run_count, 2);
  assert.equal(report.schemas[0].infrastructure_failure_count, 1);
  assert.equal(report.schemas[0].cases[0].quality_run_count, 2);
  assert.equal(report.schemas[0].cases[0].infrastructure_failure_count, 1);
  assert.equal(report.schemas[0].cases[0].result_match_rate, 1);
  assert.equal(report.schemas[0].passed, false);
  assert.equal(report.passed, false);
});

test('unknown or inconsistent failure kinds invalidate the evidence bundle', () => {
  for (const [kind, expected] of [
    ['dependency', /failure kind is unsupported/],
    ['infrastructure', /failure kind conflicts with its outcome/],
  ] as const) {
    const bundle = evidenceBundle();
    for (const schema of bundle.schemas) {
      for (const run of schema.cases[0]!.runs) Object.assign(run, { failure_kind: 'none' });
    }
    Object.assign(bundle.schemas[0]!.cases[0]!.runs[0]!, { failure_kind: kind });

    const result = evaluate(bundle);

    assert.equal(result.status, 2);
    assert.match(result.stderr, expected);
  }
});

test('recorded diagnostics reject unknown values, mismatched pairs, and raw messages', () => {
  const cases = [
    [
      { code: 'unknown_code', category: 'dangerous_sql' },
      /diagnostic code or category is unsupported/,
    ],
    [
      { code: 'forbidden_keyword', category: 'unknown_category' },
      /diagnostic code or category is unsupported/,
    ],
    [
      { code: 'forbidden_keyword', category: 'provider_failure' },
      /diagnostic code and category are inconsistent/,
    ],
    [
      { code: 'forbidden_keyword', category: 'dangerous_sql', message: 'private-table' },
      /diagnostic must contain only code and category/,
    ],
  ] as const;
  for (const [diagnostic, expected] of cases) {
    const bundle = evidenceBundle();
    const run = bundle.schemas[0]!.cases[0]!.runs[0]!;
    run.failure_stage = 'sql_validation';
    run.failure_code = 'sql_validation_failed';
    run.sql_execution_succeeded = false;
    run.actual_rows = [];
    run.render_succeeded = false;
    run.dangerous_sql = true;
    run.diagnostic = diagnostic;
    const result = evaluate(bundle);
    assert.equal(result.status, 2);
    assert.match(result.stderr, expected);
  }
});

test('diagnostic stage and safety flags must match while semantic failures may have no diagnostic', () => {
  const bundle = evidenceBundle();
  const run = bundle.schemas[0]!.cases[0]!.runs[0]!;
  run.failure_stage = 'dry_run';
  run.failure_code = 'dry_run_failed';
  run.sql_execution_succeeded = false;
  run.actual_rows = [];
  run.render_succeeded = false;
  run.scan_limit_exceeded = true;

  assert.match(evaluate(bundle).stderr, /safety evidence requires a matching diagnostic/);
  run.diagnostic = { code: 'execution_scan_limit_exceeded', category: 'scan_limit_exceeded' };
  assert.match(evaluate(bundle).stderr, /diagnostic code does not match failure stage/);
  run.diagnostic = { code: 'dry_run_scan_limit_exceeded', category: 'scan_limit_exceeded' };
  assert.equal(evaluate(bundle).status, 1);
  run.scan_limit_exceeded = false;
  assert.match(evaluate(bundle).stderr, /safety evidence requires a matching diagnostic/);
  run.diagnostic = null;
  assert.match(
    evaluate(bundle).stderr,
    /SQL boundary failure requires a diagnostic or semantic error/,
  );
  run.semantic_error = true;
  assert.equal(evaluate(bundle).status, 1);
});

test('successful and non-SQL failure stages reject typed diagnostics', () => {
  const bundle = evidenceBundle();
  const run = bundle.schemas[0]!.cases[0]!.runs[0]!;
  run.diagnostic = { code: 'forbidden_keyword', category: 'dangerous_sql' };
  assert.match(evaluate(bundle).stderr, /successful runs cannot contain a diagnostic/);
  run.failure_stage = 'planning';
  run.failure_code = 'planning_failed';
  run.generated_sql = '';
  run.sql_execution_succeeded = false;
  run.actual_rows = [];
  run.render_succeeded = false;
  assert.match(evaluate(bundle).stderr, /diagnostic code does not match failure stage/);
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
  bundle.schemas[0]!.cases[0]!.runs[1]!.runtime_input.analysis_contract_fingerprint = 'f'.repeat(
    64,
  );

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
  bundle.schemas[0]!.cases[0]!.reference.row_order = 'implicit';

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /reference row_order must be ordered or unordered/);
  assert.equal(result.stdout, '');
});

test('unsafe or mismatched runs remain visible in a failing report', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'sql_validation';
  failedRun.failure_code = 'sql_validation_failed';
  failedRun.sql_execution_succeeded = false;
  failedRun.actual_rows = [];
  failedRun.dangerous_sql = true;
  failedRun.render_succeeded = false;
  failedRun.diagnostic = { code: 'forbidden_keyword', category: 'dangerous_sql' };

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

test('a recorded SQL generation failure remains in rates and stage counts', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'sql_generation';
  failedRun.failure_code = 'structured_response_invalid';
  failedRun.generated_sql = '';
  failedRun.sql_execution_succeeded = false;
  failedRun.actual_rows = [];
  failedRun.render_succeeded = false;
  failedRun.bytes_processed = 0;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.run_count, 6);
  assert.equal(report.result_match_rate, 0.833333);
  assert.deepEqual(
    {
      failure_count: report.schemas[0].failure_count,
      failure_stage_counts: report.schemas[0].failure_stage_counts,
      sql_execution_success_rate: report.schemas[0].sql_execution_success_rate,
      render_success_rate: report.schemas[0].render_success_rate,
      passed: report.schemas[0].passed,
    },
    {
      failure_count: 1,
      failure_stage_counts: { sql_generation: 1 },
      sql_execution_success_rate: 0.666667,
      render_success_rate: 0.666667,
      passed: false,
    },
  );
});

test('a scope discovery failure remains in rates without invented runtime fingerprints', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'scope_discovery';
  failedRun.failure_code = 'metadata_request_failed';
  failedRun.runtime_input.scope_snapshot_fingerprint = null as unknown as string;
  failedRun.runtime_input.analysis_contract_fingerprint = null as unknown as string;
  failedRun.generated_sql = '';
  failedRun.sql_execution_succeeded = false;
  failedRun.actual_rows = [];
  failedRun.render_succeeded = false;
  failedRun.bytes_processed = 25;
  failedRun.cost_jpy = 0.2;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result_match_rate, 0.833333);
  assert.deepEqual(report.schemas[0].failure_stage_counts, { scope_discovery: 1 });

  failedRun.runtime_input.scope_snapshot_fingerprint =
    bundle.schemas[0]!.scope_snapshot_fingerprint;
  const invalid = evaluate(bundle);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /failure stage and available fingerprints/);
});

test('an analysis contract generation failure keeps only its observed scope fingerprint', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'analysis_contract_generation';
  failedRun.failure_code = 'contract_response_invalid';
  failedRun.runtime_input.analysis_contract_fingerprint = null as unknown as string;
  failedRun.generated_sql = '';
  failedRun.sql_execution_succeeded = false;
  failedRun.actual_rows = [];
  failedRun.render_succeeded = false;
  failedRun.bytes_processed = 25;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.schemas[0].failure_stage_counts, {
    analysis_contract_generation: 1,
  });
});

test('failure codes reject raw provider messages', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'sql_generation';
  failedRun.failure_code = 'Provider said: secret table missing';
  failedRun.generated_sql = '';
  failedRun.sql_execution_succeeded = false;
  failedRun.actual_rows = [];
  failedRun.render_succeeded = false;
  failedRun.bytes_processed = 0;

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /failure code must be an empty value or a safe machine code/);
  assert.equal(result.stdout, '');
});

test('run outcome fields must agree with their failure stage', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'sql_generation';
  failedRun.failure_code = 'structured_response_invalid';

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run outcome conflicts with its failure stage/);
  assert.equal(result.stdout, '');
});

test('a successful outcome requires generated SQL', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0]!.cases[0]!.runs[0]!.generated_sql = '';

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run outcome conflicts with its failure stage/);
  assert.equal(result.stdout, '');
});

test('unsupported failure stages are rejected', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'provider_specific';
  failedRun.failure_code = 'provider_error';

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /failure stage is unsupported/);
  assert.equal(result.stdout, '');
});

test('a result validation failure cannot count as a matching result', () => {
  const bundle = evidenceBundle();
  const failedRun = bundle.schemas[0]!.cases[0]!.runs[0]!;
  failedRun.failure_stage = 'result_validation';
  failedRun.failure_code = 'result_contract_mismatch';
  failedRun.render_succeeded = false;

  const result = evaluate(bundle);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result_match_rate, 0.833333);
  assert.equal(report.schemas[0].result_match_rate, 0.666667);
  assert.deepEqual(report.schemas[0].failure_stage_counts, { result_validation: 1 });
  assert.equal(report.schemas[0].passed, false);
});

test('a semantic error fails evaluation even when result rows match', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0]!.cases[0]!.runs[0]!.semantic_error = true;

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
  assert.match(result.stderr, /evidence version must be 5/);
  assert.equal(result.stdout, '');
});

test('safety outcomes must be JSON booleans rather than truthy strings', () => {
  const bundle = evidenceBundle();
  bundle.schemas[0]!.cases[0]!.runs[0]!.dangerous_sql = 'false' as unknown as boolean;

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /run safety and outcome fields must be booleans/);
  assert.equal(result.stdout, '');
});

test('duplicated schema evidence cannot satisfy the two-schema requirement', () => {
  const bundle = evidenceBundle();
  bundle.schemas[1]!.schema_id = bundle.schemas[0]!.schema_id;
  bundle.schemas[1]!.scope_snapshot_fingerprint = bundle.schemas[0]!.scope_snapshot_fingerprint;
  for (const run of bundle.schemas[1]!.cases[0]!.runs) {
    run.runtime_input.scope_snapshot_fingerprint = bundle.schemas[0]!.scope_snapshot_fingerprint;
  }

  const result = evaluate(bundle);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /at least two distinct schemas are required/);
  assert.equal(result.stdout, '');
});

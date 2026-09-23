import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const BUILDER = path.join(ROOT, 'spikes/schema-generalization-evaluation/execution_manifest.py');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function inputs() {
  const fixture = {
    version: 2,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: [
      {
        schema_id: 'schema-a',
        scope_snapshot_fingerprint: 'a'.repeat(64),
        cases: [
          {
            case_id: 'case-a',
            question: '認可済みデータを集計して',
            reference: {
              sql: 'SELECT 1',
              expected_rows: [{ value: 1 }],
              row_order: 'unordered',
              author_id: 'author-a',
              reviewer_id: 'reviewer-a',
              reviewed_at: '2026-09-23T00:00:00Z',
            },
            capabilities: ['join'],
          },
        ],
      },
    ],
  };
  const fixtureBytes = JSON.stringify(fixture);
  const pipeline = {
    runtime: '1'.repeat(64),
    prompt: '2'.repeat(64),
    configuration: '3'.repeat(64),
  };
  const plan = {
    version: 1,
    reviewed_fixture_sha256: sha256(fixtureBytes),
    pipeline,
    runs: [1, 2, 3].map((number) => ({
      schema_id: 'schema-a',
      case_id: 'case-a',
      run_id: `run-${number}`,
    })),
  };
  const authorization = {
    version: 1,
    schemas: [
      {
        schema_id: 'schema-a',
        datasets: ['project.dataset'],
        tables: ['project.dataset.table'],
      },
    ],
  };
  return { fixture, fixtureBytes, plan, authorization, pipeline };
}

function runBuilder(
  mutate: (value: ReturnType<typeof inputs>) => void = () => undefined,
  preexistingOutput = false,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'execution-manifest-'));
  try {
    const value = inputs();
    mutate(value);
    const fixturePath = path.join(directory, 'fixture.json');
    const planPath = path.join(directory, 'plan.json');
    const authorizationPath = path.join(directory, 'authorization.json');
    const outputPath = path.join(directory, 'manifest.json');
    writeFileSync(fixturePath, value.fixtureBytes);
    writeFileSync(planPath, JSON.stringify(value.plan));
    writeFileSync(authorizationPath, JSON.stringify(value.authorization));
    if (preexistingOutput) writeFileSync(outputPath, '{"preserved":true}');
    const result = spawnSync(
      'python3',
      [BUILDER, fixturePath, planPath, authorizationPath, outputPath],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return {
      result,
      value,
      output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : undefined,
      mode: existsSync(outputPath) ? statSync(outputPath).mode & 0o777 : undefined,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runWithReference(mutate: (reference: Record<string, unknown>) => void) {
  return runBuilder((value) => {
    const reference = value.fixture.schemas[0]!.cases[0]!.reference as Record<string, unknown>;
    reference.sql = 'SELECT sensitive_marker FROM private_table';
    reference.expected_rows = [{ value: 'private-row-marker' }];
    mutate(reference);
    value.fixtureBytes = JSON.stringify(value.fixture);
    value.plan.reviewed_fixture_sha256 = sha256(value.fixtureBytes);
  });
}

test('execution manifest exposes only authorized runtime inputs and planned runs', () => {
  const { result, value, output, mode } = runBuilder();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(mode, 0o600);
  assert.deepEqual(JSON.parse(output!), {
    version: 1,
    evaluation_plan_sha256: sha256(JSON.stringify(value.plan)),
    pipeline: value.pipeline,
    schemas: [
      {
        schema_id: 'schema-a',
        authorized_scope: {
          datasets: ['project.dataset'],
          tables: ['project.dataset.table'],
        },
        cases: [
          {
            case_id: 'case-a',
            question: '認可済みデータを集計して',
            run_ids: ['run-1', 'run-2', 'run-3'],
          },
        ],
      },
    ],
  });
  assert.doesNotMatch(output!, /SELECT 1|expected_rows|capabilities/);
});

test('authorization cannot add analysis settings or omit a fixture scope', () => {
  const addedSetting = runBuilder(({ authorization }) => {
    Object.assign(authorization.schemas[0]!, { profile: 'source-specific' });
  });
  const missingScope = runBuilder(({ authorization }) => {
    authorization.schemas = [];
  });

  assert.equal(addedSetting.result.status, 2);
  assert.match(addedSetting.result.stderr, /authorization schema fields are invalid/);
  assert.equal(addedSetting.output, undefined);
  assert.equal(missingScope.result.status, 2);
  assert.match(missingScope.result.stderr, /must match fixture schema IDs exactly/);
  assert.equal(missingScope.output, undefined);
});

test('execution manifest rejects incomplete or unreviewed reference records before output', () => {
  for (const [label, mutate, expected] of [
    [
      'missing reviewer',
      (reference: Record<string, unknown>) => delete reference.reviewer_id,
      /fixture reference fields are invalid/,
    ],
    [
      'extra field',
      (reference: Record<string, unknown>) => {
        reference.note = 'private-note-marker';
      },
      /fixture reference fields are invalid/,
    ],
    [
      'self review',
      (reference: Record<string, unknown>) => {
        reference.reviewer_id = ' author-a ';
      },
      /fixture reference reviewer must differ from author/,
    ],
    [
      'invalid order',
      (reference: Record<string, unknown>) => {
        reference.row_order = 'sometimes';
      },
      /fixture reference values are invalid/,
    ],
    [
      'missing rows',
      (reference: Record<string, unknown>) => {
        reference.expected_rows = null;
      },
      /fixture reference values are invalid/,
    ],
    [
      'blank SQL',
      (reference: Record<string, unknown>) => {
        reference.sql = ' ';
      },
      /fixture reference values are invalid/,
    ],
    [
      'invalid author',
      (reference: Record<string, unknown>) => {
        reference.author_id = null;
      },
      /fixture reference values are invalid/,
    ],
    [
      'blank review time',
      (reference: Record<string, unknown>) => {
        reference.reviewed_at = ' ';
      },
      /fixture reference values are invalid/,
    ],
  ] as const) {
    const { result, output } = runWithReference(mutate);

    assert.equal(result.status, 2, `${label}: ${result.stderr}`);
    assert.match(result.stderr, expected, label);
    assert.equal(output, undefined, label);
    assert.doesNotMatch(
      result.stderr,
      /sensitive_marker|private-row-marker|private-note-marker/,
      label,
    );
  }
});

test('execution manifest does not include a valid private reference', () => {
  const { result, output } = runWithReference(() => undefined);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(output);
  assert.doesNotMatch(output, /sensitive_marker|private-row-marker|expected_rows|reference/);
});

test('execution manifest output is private and never overwritten', () => {
  const { result, output } = runBuilder(() => undefined, true);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /output already exists/);
  assert.equal(output, '{"preserved":true}');
});

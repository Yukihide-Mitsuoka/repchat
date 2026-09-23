import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const VALIDATOR = path.join(ROOT, 'spikes/schema-generalization-evaluation/execution_intent.py');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function validInputs(directory: string) {
  const pipeline = {
    runtime: 'a'.repeat(64),
    prompt: 'b'.repeat(64),
    configuration: 'c'.repeat(64),
  };
  const runs = ['schema-a', 'schema-b'].flatMap((schema_id) =>
    [1, 2, 3].map((number) => ({ schema_id, case_id: 'case-a', run_id: `run-${number}` })),
  );
  const plan = { version: 1, reviewed_fixture_sha256: 'd'.repeat(64), pipeline, runs };
  const planBytes = JSON.stringify(plan);
  const manifest = {
    version: 1,
    evaluation_plan_sha256: sha256(planBytes),
    pipeline,
    schemas: ['schema-a', 'schema-b'].map((schema_id) => ({
      schema_id,
      authorized_scope: {
        datasets: [`project.dataset_${schema_id.slice(-1)}`],
        tables: [`project.dataset_${schema_id.slice(-1)}.table`],
      },
      cases: [
        {
          case_id: 'case-a',
          question: '認可済みデータを集計して',
          run_ids: ['run-1', 'run-2', 'run-3'],
        },
      ],
    })),
  };
  const manifestBytes = JSON.stringify(manifest);
  const pricing = {
    captured_at: '2026-09-23T00:00:00+00:00',
    source_url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    currency: 'JPY',
    model: 'model',
    region: 'asia-northeast1',
    vertex_tier: 'standard-text',
    bigquery_billing: 'on-demand',
    vertex_input_jpy_per_million: '100',
    vertex_output_jpy_per_million: '200',
    bigquery_jpy_per_tib: '300',
  };
  const pricingBytes = JSON.stringify(pricing);
  const intent = {
    version: 1,
    evaluation_plan_sha256: sha256(planBytes),
    execution_manifest_sha256: sha256(manifestBytes),
    pricing_snapshot_sha256: sha256(pricingBytes),
    model: 'model',
    region: 'asia-northeast1',
    as_of: '2026-09-01',
    execution_date: '2026-09-23',
    output_directory: path.join(directory, 'output'),
    vertex_budget_jpy: '100',
    bigquery_budget_jpy: '25',
    total_budget_jpy: '110',
  };
  return { plan, manifest, pricing, intent };
}

function runValidator(
  mutate: (value: ReturnType<typeof validInputs>) => void = () => undefined,
  intentBytes?: string,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'evaluation-intent-'));
  try {
    const value = validInputs(directory);
    mutate(value);
    const names = ['intent', 'plan', 'manifest', 'pricing'] as const;
    for (const name of names) {
      writeFileSync(
        path.join(directory, `${name}.json`),
        name === 'intent' && intentBytes ? intentBytes : JSON.stringify(value[name]),
      );
    }
    return spawnSync(
      'python3',
      [
        VALIDATOR,
        ...names.map((name) => path.join(directory, `${name}.json`)),
        'model',
        'asia-northeast1',
        '2026-09-01',
        '2026-09-23',
        path.join(directory, 'output'),
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('execution intent binds complete planned runs, scope, pricing and spending ceilings offline', () => {
  const result = runValidator();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'execution intent valid\n');
  assert.equal(result.stderr, '');
});

test('execution intent rejects changed artifacts and inconsistent run identities', () => {
  const cases = [
    (value: ReturnType<typeof validInputs>) => {
      value.plan.runs.pop();
    },
    (value: ReturnType<typeof validInputs>) => {
      value.manifest.schemas[0]!.authorized_scope.tables[0] = 'project.dataset_a.other';
    },
    (value: ReturnType<typeof validInputs>) => {
      value.pricing.vertex_input_jpy_per_million = '1';
    },
    (value: ReturnType<typeof validInputs>) => {
      value.manifest.schemas[0]!.cases[0]!.run_ids.pop();
      value.intent.execution_manifest_sha256 = sha256(JSON.stringify(value.manifest));
    },
  ];
  for (const mutate of cases) {
    const result = runValidator(mutate);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /project\.dataset_a|認可済みデータ/);
  }
});

test('execution intent rejects unsupported or ambiguous approvals', () => {
  const invalidFields: Record<string, unknown> = {
    unknown: true,
    version: true,
    model: 'other',
    region: 'us-central1',
    as_of: '2026-09-02',
    execution_date: '2026-09-24',
    output_directory: 'relative/output',
    vertex_budget_jpy: 'NaN',
    bigquery_budget_jpy: '0',
    total_budget_jpy: '126',
  };
  for (const [name, invalid] of Object.entries(invalidFields)) {
    const result = runValidator((value) => Object.assign(value.intent, { [name]: invalid }));
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
  }
  const missing = runValidator((value) => {
    delete (value.intent as Record<string, unknown>).model;
  });
  assert.equal(missing.status, 2, missing.stderr);
  const oversized = runValidator((value) => {
    value.intent.vertex_budget_jpy = '1'.repeat(33);
  });
  assert.equal(oversized.status, 2, oversized.stderr);
  const duplicate = runValidator(undefined, '{"version":1,"version":1}');
  assert.equal(duplicate.status, 2, duplicate.stderr);
});

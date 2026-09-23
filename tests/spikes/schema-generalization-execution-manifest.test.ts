import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const BUILDER = path.join(ROOT, 'spikes/schema-generalization-evaluation/execution_manifest.py');
const CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function inputs() {
  const schema = (id: string, fingerprint: string) => ({
    schema_id: id,
    scope_snapshot_fingerprint: fingerprint.repeat(64),
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
        capabilities: [...CAPABILITIES],
      },
    ],
  });
  const fixture = {
    version: 2,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: [schema('schema-a', 'a'), schema('schema-b', 'b')],
  };
  const fixtureBytes = JSON.stringify(fixture);
  const artifactBytes = {
    runtime: 'runtime-bundle-v1',
    prompt: 'prompt-bundle-v1',
    configuration: 'configuration-bundle-v1',
  };
  const pipeline = {
    runtime: sha256(artifactBytes.runtime),
    prompt: sha256(artifactBytes.prompt),
    configuration: sha256(artifactBytes.configuration),
  };
  const plan = {
    version: 1,
    reviewed_fixture_sha256: sha256(fixtureBytes),
    pipeline,
    runs: fixture.schemas.flatMap(({ schema_id }) =>
      [1, 2, 3].map((number) => ({ schema_id, case_id: 'case-a', run_id: `run-${number}` })),
    ),
  };
  const authorization = {
    version: 1,
    schemas: [
      {
        schema_id: 'schema-a',
        datasets: ['project.dataset'],
        tables: ['project.dataset.table'],
      },
      {
        schema_id: 'schema-b',
        datasets: ['project.other_dataset'],
        tables: ['project.other_dataset.table'],
      },
    ],
  };
  return { fixture, fixtureBytes, plan, authorization, pipeline, artifactBytes };
}

function runBuilder(
  mutate: (value: ReturnType<typeof inputs>) => void = () => undefined,
  preexistingOutput = false,
  artifacts: 'all' | 'omit-arguments' | 'missing-runtime' = 'all',
  outputIsRuntimeArtifact = false,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'execution-manifest-'));
  try {
    const value = inputs();
    mutate(value);
    const fixturePath = path.join(directory, 'fixture.json');
    const planPath = path.join(directory, 'plan.json');
    const authorizationPath = path.join(directory, 'authorization.json');
    const artifactPaths = {
      runtime: path.join(directory, 'runtime.artifact'),
      prompt: path.join(directory, 'prompt.artifact'),
      configuration: path.join(directory, 'configuration.artifact'),
    };
    const outputPath = outputIsRuntimeArtifact
      ? artifactPaths.runtime
      : path.join(directory, 'manifest.json');
    writeFileSync(fixturePath, value.fixtureBytes);
    writeFileSync(planPath, JSON.stringify(value.plan));
    writeFileSync(authorizationPath, JSON.stringify(value.authorization));
    for (const name of ['runtime', 'prompt', 'configuration'] as const) {
      if (artifacts !== 'missing-runtime' || name !== 'runtime') {
        writeFileSync(artifactPaths[name], value.artifactBytes[name]);
      }
    }
    if (preexistingOutput) writeFileSync(outputPath, '{"preserved":true}');
    const artifactArguments = artifacts === 'omit-arguments' ? [] : Object.values(artifactPaths);
    const result = spawnSync(
      'python3',
      [BUILDER, fixturePath, planPath, authorizationPath, ...artifactArguments, outputPath],
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

function runWithFixture(mutate: (value: ReturnType<typeof inputs>) => void) {
  return runBuilder((value) => {
    mutate(value);
    value.fixtureBytes = JSON.stringify(value.fixture);
    value.plan.reviewed_fixture_sha256 = sha256(value.fixtureBytes);
  });
}

function runWithReference(mutate: (reference: Record<string, unknown>) => void) {
  return runWithFixture((value) => {
    const reference = value.fixture.schemas[0]!.cases[0]!.reference as Record<string, unknown>;
    reference.sql = 'SELECT sensitive_marker FROM private_table';
    reference.expected_rows = [{ value: 'private-row-marker' }];
    mutate(reference);
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
      {
        schema_id: 'schema-b',
        authorized_scope: {
          datasets: ['project.other_dataset'],
          tables: ['project.other_dataset.table'],
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
  assert.doesNotMatch(
    output!,
    /SELECT 1|expected_rows|capabilities|runtime-bundle-v1|prompt-bundle-v1|configuration-bundle-v1/,
  );
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

test('execution manifest rejects an incomplete evaluation fixture before output', () => {
  for (const [label, mutate, expected] of [
    [
      'one schema',
      (value: ReturnType<typeof inputs>) => {
        value.fixture.schemas.pop();
        value.authorization.schemas.pop();
        value.plan.runs = value.plan.runs.filter((run) => run.schema_id === 'schema-a');
      },
      /at least two distinct schemas/,
    ],
    [
      'same scope fingerprint',
      (value: ReturnType<typeof inputs>) => {
        value.fixture.schemas[1]!.scope_snapshot_fingerprint =
          value.fixture.schemas[0]!.scope_snapshot_fingerprint;
      },
      /at least two distinct schemas/,
    ],
    [
      'missing capability',
      (value: ReturnType<typeof inputs>) => {
        value.fixture.schemas[0]!.cases[0]!.capabilities.pop();
      },
      /each fixture schema must cover every required capability/,
    ],
    [
      'low match threshold',
      (value: ReturnType<typeof inputs>) => {
        value.fixture.thresholds.minimum_result_match_rate = 0.8;
      },
      /thresholds cannot be lower than the fixed acceptance policy/,
    ],
    [
      'low repeat threshold',
      (value: ReturnType<typeof inputs>) => {
        value.fixture.thresholds.minimum_runs_per_case = 2;
      },
      /thresholds cannot be lower than the fixed acceptance policy/,
    ],
    [
      'few repetitions',
      (value: ReturnType<typeof inputs>) => {
        value.plan.runs = value.plan.runs.filter(
          (run) => run.schema_id !== 'schema-a' || run.run_id !== 'run-3',
        );
      },
      /fixture minimum planned runs per case/,
    ],
  ] as const) {
    const { result, output } = runWithFixture(mutate);
    assert.equal(result.status, 2, `${label}: ${result.stderr}`);
    assert.match(result.stderr, expected, label);
    assert.equal(output, undefined, label);
    assert.doesNotMatch(result.stderr, /SELECT 1|project\.dataset/, label);
  }
});

test('execution manifest accepts a higher planned repetition threshold', () => {
  const { result, output } = runWithFixture((value) => {
    value.fixture.thresholds.minimum_runs_per_case = 4;
    for (const schema of value.fixture.schemas) {
      value.plan.runs.push({ schema_id: schema.schema_id, case_id: 'case-a', run_id: 'run-4' });
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(output!).schemas[0].cases[0].run_ids, [
    'run-1',
    'run-2',
    'run-3',
    'run-4',
  ]);
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

test('execution manifest requires pipeline artifact files before output', () => {
  const { result, output } = runBuilder(() => undefined, false, 'omit-arguments');

  assert.equal(result.status, 2);
  assert.equal(output, undefined);
});

test('execution manifest rejects missing, empty, or changed pipeline artifact bytes', () => {
  const cases = [
    {
      label: 'missing runtime',
      run: () => runBuilder(() => undefined, false, 'missing-runtime'),
      expected: /runtime artifact must be a non-empty regular file/,
    },
    {
      label: 'empty prompt',
      run: () =>
        runBuilder((value) => {
          value.artifactBytes.prompt = '';
        }),
      expected: /prompt artifact must be a non-empty regular file/,
    },
    {
      label: 'changed configuration',
      run: () =>
        runBuilder((value) => {
          value.artifactBytes.configuration = 'private-artifact-marker';
        }),
      expected: /evaluation plan must bind to the exact pipeline artifacts/,
    },
  ];

  for (const { label, run, expected } of cases) {
    const { result, output } = run();
    assert.equal(result.status, 2, `${label}: ${result.stderr}`);
    assert.match(result.stderr, expected, label);
    assert.equal(output, undefined, label);
    assert.doesNotMatch(result.stderr, /private-artifact-marker|execution-manifest-/, label);
  }
});

test('execution manifest never overwrites a pipeline artifact', () => {
  const { result, output, value } = runBuilder(() => undefined, false, 'all', true);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /manifest output must not overwrite an input/);
  assert.equal(output, value.artifactBytes.runtime);
});

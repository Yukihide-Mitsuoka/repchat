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
const RETRIEVED_AT = '2026-09-20T00:00:00+00:00';
const PIPELINE_ARTIFACTS = {
  runtime: 'generic-runtime-bundle-v1\n',
  prompt: 'generic-prompt-bundle-v1\n',
  configuration: 'generic-configuration-bundle-v1\n',
};

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function pipelineFingerprints(): Record<keyof typeof PIPELINE_ARTIFACTS, string> {
  return {
    runtime: sha256(PIPELINE_ARTIFACTS.runtime),
    prompt: sha256(PIPELINE_ARTIFACTS.prompt),
    configuration: sha256(PIPELINE_ARTIFACTS.configuration),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function scopeContent(schemaId: string) {
  const metadata = { version: 1, tables: [{ table: `project.dataset.${schemaId}`, fields: [] }] };
  const schemaFingerprint = createHash('sha256').update(canonicalJson(metadata)).digest('hex');
  return {
    version: 1,
    schema: { fingerprint: schemaFingerprint, metadata },
    tables: [],
    limits: {},
  };
}

function contractContent(schemaId: string) {
  const scope = scopeContent(schemaId);
  return {
    version: 1,
    schema: {
      fingerprint: scope.schema.fingerprint,
      retrieved_at: RETRIEVED_AT,
      metadata: scope.schema.metadata,
    },
    semantics: {
      grain: {},
      identifiers: {},
      dimensions: {},
      measures: {},
      metrics: {},
      relationships: [],
    },
    period: null,
    limits: { maximum_bytes_billed: 100, maximum_result_rows: 10 },
  };
}

function contractFingerprint(content: ReturnType<typeof contractContent>) {
  const identity = structuredClone(content);
  delete (identity.schema as { retrieved_at?: string }).retrieved_at;
  return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

function evidenceBundle() {
  const fingerprints = pipelineFingerprints();
  return {
    version: 6,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: ['scope-a', 'scope-b'].map((schemaId, schemaIndex) => {
      const encodedScope = canonicalJson(scopeContent(schemaId));
      const scopeFingerprint = createHash('sha256').update(encodedScope).digest('hex');
      const analysisContractFingerprint = contractFingerprint(contractContent(schemaId));
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
              ...fingerprints,
              runtime_input: {
                scope_snapshot_fingerprint: scopeFingerprint,
                analysis_contract_fingerprint: analysisContractFingerprint,
                question: '区分別の値を集計して',
              },
              generated_sql:
                'SELECT category, SUM(value) AS metric_value FROM authorized_table GROUP BY category',
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
  const plannedRuns = bundle.schemas.flatMap((schema) =>
    schema.cases.flatMap((evaluationCase) =>
      evaluationCase.runs.map((run) => ({
        schema_id: schema.schema_id,
        case_id: evaluationCase.case_id,
        run_id: run.run_id,
      })),
    ),
  );
  const evaluationPlan = {
    version: 1,
    reviewed_fixture_sha256: sha256(JSON.stringify(fixture)),
    pipeline: pipelineFingerprints(),
    runs: plannedRuns,
  };
  const recordings = {
    version: 7,
    evaluation_plan_sha256: sha256(JSON.stringify(evaluationPlan)),
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
      content_json: canonicalJson(scopeContent(schema.schema_id)),
      retrieved_at: RETRIEVED_AT,
    })),
  };
  const analysisContracts = {
    version: 1,
    contracts: bundle.schemas.flatMap((schema) =>
      schema.cases.map((evaluationCase) => ({
        schema_id: schema.schema_id,
        case_id: evaluationCase.case_id,
        content_json: canonicalJson(contractContent(schema.schema_id)),
      })),
    ),
  };
  return { bundle, fixture, evaluationPlan, recordings, scopeSnapshots, analysisContracts };
}

function assemble(
  fixture: object,
  recordings: object,
  scopeSnapshots: object,
  preexistingOutput = false,
  analysisContracts: object = separatedEvidence().analysisContracts,
  pipelineArtifacts: Record<keyof typeof PIPELINE_ARTIFACTS, string> = PIPELINE_ARTIFACTS,
  evaluationPlan: object = separatedEvidence().evaluationPlan,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'schema-fixture-'));
  const fixturePath = path.join(directory, 'fixture.json');
  const evaluationPlanPath = path.join(directory, 'evaluation-plan.json');
  const recordingsPath = path.join(directory, 'recordings.json');
  const scopeSnapshotsPath = path.join(directory, 'scope-snapshots.json');
  const analysisContractsPath = path.join(directory, 'analysis-contracts.json');
  const runtimeArtifactPath = path.join(directory, 'runtime.artifact');
  const promptArtifactPath = path.join(directory, 'prompt.artifact');
  const configurationArtifactPath = path.join(directory, 'configuration.artifact');
  const bundlePath = path.join(directory, 'evidence.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(evaluationPlanPath, JSON.stringify(evaluationPlan));
  writeFileSync(recordingsPath, JSON.stringify(recordings));
  writeFileSync(scopeSnapshotsPath, JSON.stringify(scopeSnapshots));
  writeFileSync(analysisContractsPath, JSON.stringify(analysisContracts));
  writeFileSync(runtimeArtifactPath, pipelineArtifacts.runtime);
  writeFileSync(promptArtifactPath, pipelineArtifacts.prompt);
  writeFileSync(configurationArtifactPath, pipelineArtifacts.configuration);
  if (preexistingOutput) writeFileSync(bundlePath, JSON.stringify({ preserved: true }));
  try {
    const result = spawnSync(
      'python3',
      [
        ASSEMBLER,
        fixturePath,
        evaluationPlanPath,
        recordingsPath,
        scopeSnapshotsPath,
        analysisContractsPath,
        runtimeArtifactPath,
        promptArtifactPath,
        configurationArtifactPath,
        bundlePath,
      ],
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

function assembleWithEvaluationPlan(
  fixture: object,
  evaluationPlan: object,
  recordings: object,
  scopeSnapshots: object,
) {
  return assemble(fixture, recordings, scopeSnapshots, false, undefined, undefined, evaluationPlan);
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
  assert.match(result.stderr, /recordings version must be 7/);
  assert.equal(result.stdout, '');
});

test('recorded runs cannot be assembled against a changed reviewed fixture', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  fixture.schemas[0]!.cases[0]!.reference.expected_rows = [
    { category: 'changed-after-review', metric_value: 999 },
  ];

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evaluation plan must bind to the exact reviewed fixture/);
  assert.equal(result.stdout, '');
});

test('reviewed fixture fingerprint must be a lowercase SHA-256 value', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.reviewed_fixture_sha256 = 'A'.repeat(64);
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

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

test('planned scope discovery failures assemble without invented snapshot or contract artifacts', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  for (const recorded of recordings.runs.filter((run) => run.schema_id === 'scope-a')) {
    recorded.run.failure_stage = 'scope_discovery';
    recorded.run.failure_code = 'metadata_request_failed';
    recorded.run.failure_kind = 'quality';
    recorded.run.runtime_input.scope_snapshot_fingerprint = null as unknown as string;
    recorded.run.runtime_input.analysis_contract_fingerprint = null as unknown as string;
    recorded.run.generated_sql = '';
    recorded.run.sql_execution_succeeded = false;
    recorded.run.actual_rows = [];
    recorded.run.render_succeeded = false;
  }
  scopeSnapshots.snapshots = scopeSnapshots.snapshots.filter(
    (snapshot) => snapshot.schema_id !== 'scope-a',
  );
  analysisContracts.contracts = analysisContracts.contracts.filter(
    (contract) => contract.schema_id !== 'scope-a',
  );

  const { result, bundle } = assemble(
    fixture,
    recordings,
    scopeSnapshots,
    false,
    analysisContracts,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    bundle.schemas[0].cases[0].runs.map((run: { failure_stage: string }) => run.failure_stage),
    ['scope_discovery', 'scope_discovery', 'scope_discovery'],
  );
});

test('planned contract generation failures require a snapshot but no contract artifact', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  for (const recorded of recordings.runs.filter((run) => run.schema_id === 'scope-a')) {
    recorded.run.failure_stage = 'analysis_contract_generation';
    recorded.run.failure_code = 'contract_response_invalid';
    recorded.run.failure_kind = 'quality';
    recorded.run.runtime_input.analysis_contract_fingerprint = null as unknown as string;
    recorded.run.generated_sql = '';
    recorded.run.sql_execution_succeeded = false;
    recorded.run.actual_rows = [];
    recorded.run.render_succeeded = false;
  }
  analysisContracts.contracts = analysisContracts.contracts.filter(
    (contract) => contract.schema_id !== 'scope-a',
  );

  const { result, bundle } = assemble(
    fixture,
    recordings,
    scopeSnapshots,
    false,
    analysisContracts,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    bundle.schemas[0].cases[0].runs.map((run: { failure_stage: string }) => run.failure_stage),
    [
      'analysis_contract_generation',
      'analysis_contract_generation',
      'analysis_contract_generation',
    ],
  );
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

test('scope snapshot schema metadata must match its declared fingerprint', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  const content = JSON.parse(scopeSnapshots.snapshots[0]!.content_json);
  content.schema.metadata.tables = [];
  scopeSnapshots.snapshots[0]!.content_json = canonicalJson(content);
  const scopeFingerprint = createHash('sha256')
    .update(scopeSnapshots.snapshots[0]!.content_json)
    .digest('hex');
  fixture.schemas[0]!.scope_snapshot_fingerprint = scopeFingerprint;
  for (const recorded of recordings.runs.filter((run) => run.schema_id === 'scope-a')) {
    recorded.run.runtime_input.scope_snapshot_fingerprint = scopeFingerprint;
  }
  evaluationPlan.reviewed_fixture_sha256 = sha256(JSON.stringify(fixture));
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /scope snapshot schema observation is invalid/);
  assert.equal(result.stdout, '');
});

test('analysis contract content must match every recorded run fingerprint', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  const content = JSON.parse(analysisContracts.contracts[0]!.content_json);
  content.limits.maximum_result_rows = 11;
  analysisContracts.contracts[0]!.content_json = canonicalJson(content);

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contract content must match recorded run fingerprint/);
  assert.equal(result.stdout, '');
});

test('every fixture case must have exactly one analysis contract artifact', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  analysisContracts.contracts.pop();

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contracts must match fixture cases exactly/);
  assert.equal(result.stdout, '');
});

test('analysis contract artifact version must be an integer', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  analysisContracts.version = true as unknown as number;

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contracts version must be 1/);
  assert.equal(result.stdout, '');
});

test('analysis contract content must preserve the canonical runtime representation', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  analysisContracts.contracts[0]!.content_json =
    analysisContracts.contracts[0]!.content_json.replace('"version":1', '"version": 1');

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contract content must be canonical JSON/);
  assert.equal(result.stdout, '');
});

test('analysis contract must bind to the same schema observation as its scope snapshot', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  const content = JSON.parse(analysisContracts.contracts[0]!.content_json);
  content.schema.retrieved_at = '2026-09-20T00:00:01+00:00';
  analysisContracts.contracts[0]!.content_json = canonicalJson(content);

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contract must match its scope snapshot observation/);
  assert.equal(result.stdout, '');
});

test('analysis contract schema metadata must match its declared fingerprint', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();
  const content = JSON.parse(analysisContracts.contracts[0]!.content_json);
  content.schema.metadata.tables = [];
  analysisContracts.contracts[0]!.content_json = canonicalJson(content);

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /analysis contract must match its scope snapshot observation/);
  assert.equal(result.stdout, '');
});

test('evaluation plan must bind to the exact local pipeline artifacts', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();

  for (const artifactName of Object.keys(PIPELINE_ARTIFACTS) as Array<
    keyof typeof PIPELINE_ARTIFACTS
  >) {
    const pipelineArtifacts = { ...PIPELINE_ARTIFACTS };
    pipelineArtifacts[artifactName] += 'changed-after-run\n';

    const { result } = assemble(
      fixture,
      recordings,
      scopeSnapshots,
      false,
      analysisContracts,
      pipelineArtifacts,
    );

    assert.equal(result.status, 2, `${artifactName}: ${result.stderr}`);
    assert.match(result.stderr, /evaluation plan must bind to the exact pipeline artifacts/);
    assert.equal(result.stdout, '');
  }
});

test('recorded run fingerprints must bind to the planned pipeline artifacts', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.runs[0]!.run.runtime = '0'.repeat(64);

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /recorded runs must bind to the exact runtime, prompt, and configuration artifacts/,
  );
  assert.equal(result.stdout, '');
});

test('pipeline artifacts must be non-empty regular files', () => {
  const { fixture, recordings, scopeSnapshots, analysisContracts } = separatedEvidence();

  const { result } = assemble(fixture, recordings, scopeSnapshots, false, analysisContracts, {
    ...PIPELINE_ARTIFACTS,
    runtime: '',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /runtime artifact must be a non-empty regular file/);
  assert.equal(result.stdout, '');
});

test('recordings must bind to the exact pre-run evaluation plan', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.runs[0]!.run_id = 'changed-after-run';

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recordings must bind to the exact evaluation plan/);
  assert.equal(result.stdout, '');
});

test('evaluation plan version must be an integer', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.version = true as unknown as number;
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evaluation plan version must be 1/);
  assert.equal(result.stdout, '');
});

test('evaluation plan fingerprint must be a lowercase SHA-256 value', () => {
  const { fixture, recordings, scopeSnapshots } = separatedEvidence();
  recordings.evaluation_plan_sha256 = 'A'.repeat(64);

  const { result } = assemble(fixture, recordings, scopeSnapshots);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evaluation plan fingerprint must be a lowercase SHA-256 value/);
  assert.equal(result.stdout, '');
});

test('evaluation plan must cover every fixture case', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.runs = evaluationPlan.runs.filter((run) => run.schema_id !== 'scope-a');
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evaluation plan must cover every fixture case/);
  assert.equal(result.stdout, '');
});

test('evaluation plan rejects duplicate run identities', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.runs.push(structuredClone(evaluationPlan.runs[0]!));
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evaluation plan must cover fixture cases with unique run IDs/);
  assert.equal(result.stdout, '');
});

test('evaluation plan run IDs must be non-empty strings', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  evaluationPlan.runs[0]!.run_id = '   ';
  recordings.evaluation_plan_sha256 = sha256(JSON.stringify(evaluationPlan));

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /planned run IDs must be non-empty strings/);
  assert.equal(result.stdout, '');
});

test('recorded runs must match planned run IDs exactly', () => {
  const { fixture, evaluationPlan, recordings, scopeSnapshots } = separatedEvidence();
  recordings.runs.pop();

  const { result } = assembleWithEvaluationPlan(
    fixture,
    evaluationPlan,
    recordings,
    scopeSnapshots,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /recorded runs must match planned runs exactly/);
  assert.equal(result.stdout, '');
});

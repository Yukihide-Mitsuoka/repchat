import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const VALIDATOR = path.join(
  ROOT,
  'spikes/schema-generalization-evaluation/contract_review_binding.py',
);
const RETRIEVED_AT = '2026-09-25T00:00:00+00:00';
const CAPABILITIES = [
  'nested_unnest',
  'multi_level_nesting',
  'join',
  'period_comparison',
  'window_function',
  'ordered_behavior',
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scopeContent(schemaId: string) {
  const metadata = { version: 1, tables: [{ table: `project.dataset.${schemaId}`, fields: [] }] };
  return {
    version: 1,
    schema: { fingerprint: sha256(canonical(metadata)), metadata },
    tables: [],
    limits: {},
  };
}

function contractContent(schemaId: string) {
  const scope = scopeContent(schemaId);
  return {
    version: 1,
    schema: { ...scope.schema, retrieved_at: RETRIEVED_AT },
    semantics: {},
    period: null,
    limits: { maximum_bytes_billed: 100, maximum_result_rows: 10 },
  };
}

function contractFingerprint(schemaId: string): string {
  const content = contractContent(schemaId);
  const identity = { ...content, schema: { ...content.schema } };
  delete (identity.schema as { retrieved_at?: string }).retrieved_at;
  return sha256(canonical(identity));
}

function fixtures() {
  const schemaIds = ['scope-a', 'scope-b'];
  const evidence = {
    version: 6,
    thresholds: { minimum_runs_per_case: 3, minimum_result_match_rate: 0.9 },
    schemas: schemaIds.map((schemaId, schemaIndex) => {
      const expectedRows = [{ metric_value: schemaIndex + 1 }];
      const scopeFingerprint = sha256(canonical(scopeContent(schemaId)));
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
              author_id: 'reference-author',
              reviewer_id: 'reference-reviewer',
              reviewed_at: RETRIEVED_AT,
            },
            runs: Array.from({ length: 3 }, (_, index) => ({
              run_id: `run-${index + 1}`,
              runtime: '1'.repeat(64),
              prompt: '2'.repeat(64),
              configuration: '3'.repeat(64),
              runtime_input: {
                scope_snapshot_fingerprint: scopeFingerprint,
                analysis_contract_fingerprint: contractFingerprint(schemaId),
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
  const snapshots = {
    version: 1,
    snapshots: schemaIds.map((schemaId) => ({
      schema_id: schemaId,
      content_json: canonical(scopeContent(schemaId)),
      retrieved_at: RETRIEVED_AT,
    })),
  };
  const contracts = {
    version: 1,
    contracts: schemaIds.map((schemaId) => ({
      schema_id: schemaId,
      case_id: 'case-1',
      content_json: canonical(contractContent(schemaId)),
    })),
  };
  const reviews = schemaIds.map((schemaId) => ({
    schema_id: schemaId,
    case_id: 'case-1',
    contract_fingerprint: contractFingerprint(schemaId),
    author_id: 'contract-author',
    reviewer_id: 'contract-reviewer',
    reviewed_at: '2026-09-25T01:00:00+00:00',
  }));
  return { evidence, snapshots, contracts, reviews };
}

function validate(
  input: ReturnType<typeof fixtures>,
  contractsSha?: string,
  snapshotsSha?: string,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'contract-review-binding-'));
  const paths = ['evidence.json', 'snapshots.json', 'contracts.json', 'review.json'].map((name) =>
    path.join(directory, name),
  );
  const evidenceBytes = JSON.stringify(input.evidence);
  const contractsBytes = JSON.stringify(input.contracts);
  const snapshotsBytes = JSON.stringify(input.snapshots);
  const review = {
    version: 2,
    scope_snapshots_sha256: snapshotsSha ?? sha256(snapshotsBytes),
    analysis_contracts_sha256: contractsSha ?? sha256(contractsBytes),
    reviews: input.reviews,
  };
  [evidenceBytes, snapshotsBytes, contractsBytes, JSON.stringify(review)].forEach(
    (content, index) => writeFileSync(paths[index]!, content),
  );
  try {
    return spawnSync('python3', [VALIDATOR, ...paths], { cwd: ROOT, encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('review records bind each diagnostic contract to evidence and scope', () => {
  const result = validate(fixtures());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, reviewed_contract_count: 2 });
  assert.doesNotMatch(result.stdout, /metric_value|SELECT|project\.dataset|値を集計して/);
});

test('different contract artifact bytes invalidate a pre-run review record', () => {
  const input = fixtures();
  assert.equal(validate(input, '0'.repeat(64)).status, 2);
});

test('different scope snapshot bytes invalidate a pre-run review record', () => {
  const input = fixtures();
  const originalSha = sha256(JSON.stringify(input.snapshots));
  input.snapshots.snapshots.reverse();
  assert.equal(validate(input, undefined, originalSha).status, 2);
});

test('diagnostic evidence must report the reviewed contract fingerprint', () => {
  const input = fixtures();
  input.evidence.schemas[0]!.cases[0]!.runs.forEach((run) => {
    run.runtime_input.analysis_contract_fingerprint = '0'.repeat(64);
  });
  assert.equal(validate(input).status, 2);
});

test('changed contract content cannot reuse a review', () => {
  const changedContract = fixtures();
  const content = JSON.parse(changedContract.contracts.contracts[0]!.content_json);
  content.limits.maximum_result_rows = 20;
  changedContract.contracts.contracts[0]!.content_json = canonical(content);
  assert.equal(validate(changedContract).status, 2);
});

test('missing, duplicate, or non-independent contract reviews are rejected', () => {
  const missing = fixtures();
  missing.reviews.pop();
  assert.equal(validate(missing).status, 2);

  const duplicate = fixtures();
  duplicate.reviews.push(duplicate.reviews[0]!);
  assert.equal(validate(duplicate).status, 2);

  const sameReviewer = fixtures();
  sameReviewer.reviews[0]!.reviewer_id = 'contract-author';
  assert.equal(validate(sameReviewer).status, 2);
});

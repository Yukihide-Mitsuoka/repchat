import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './live-demo-test-helpers.ts';

const RUNTIME_ROOT = path.join(ROOT, 'spikes/report-generation');
const RUNTIME_EXTENSIONS = new Set(['.js', '.json', '.py', '.toml', '.yaml', '.yml']);

const RULES = {
  knownSourceIdentity: {
    target: 'content',
    pattern: /\b(?:ga4|bitcoin)\b|ga4_obfuscated_sample_ecommerce|crypto_bitcoin/giu,
  },
  sourceProfileApi: {
    target: 'content',
    pattern:
      /\b(?:DataSourceProfile|data_source_profiles|profile_for|profile_keys|all_profiles|with_contract)\b|body\.get\(["']profile["']|["']profile["']\s*:|profile\s*:\s*str/gu,
  },
  fixedSchemaKnowledge: {
    target: 'content',
    pattern:
      /\b(?:SCHEMA_DDL|event_params|event_name|event_date|user_pseudo_id|ga_session_id|page_location|transaction_id|block_timestamp_month|output_count|input_count|purchase_revenue|first_visit|session_start|page_view|view_item|add_to_cart|ecommerce)\b/gu,
  },
  fixedMetricAsset: {
    target: 'content',
    pattern: /metrics\.json|\bmetrics_block\(/gu,
  },
  sourceSpecificSqlRepair: {
    target: 'content',
    pattern:
      /\b(?:quote_reserved_hash_identifiers|NET\.PARSE_URL|period_for_question|period_repair_guidance)\b/gu,
  },
  fixedDemoPeriod: {
    target: 'content',
    pattern: /\b2021(?:01|-[0-9]{2})\b|\b2024(?:01|-[0-9]{2})\b|2021年|2024年/gu,
  },
  fixedBusinessVocabulary: {
    target: 'content',
    pattern: /ECサイト|購入|売上|セッション|商品|Bitcoin取引/gu,
  },
  fixedDatasetConstant: {
    target: 'content',
    pattern: /\b(?:DATASET|TABLE)\s*=\s*(?:f)?["']/gu,
  },
  embeddedQuery: {
    target: 'content',
    pattern: /\bSELECT\b[^;\n]{0,400}\bFROM\b/giu,
  },
  embeddedSchema: {
    target: 'content',
    pattern: /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\b/giu,
  },
  qualifiedTableLiteral: {
    target: 'content',
    pattern: /`[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_*]+`/gu,
  },
  sourceSpecificModuleName: {
    target: 'path',
    pattern: /(?:^|\/)(?:data_source_profiles|[^/]+_profile)\.py$/gu,
  },
  runtimeConfigAsset: {
    target: 'path',
    pattern: /\.(?:json|toml|ya?ml)$/gu,
  },
} as const;

type RuleName = keyof typeof RULES;
type Inventory = Record<RuleName, Record<string, number>>;

const EXPECTED_LEGACY_INVENTORY: Inventory = {
  knownSourceIdentity: {
    'analysis_dashboard_plan.py': 2,
    'analysis_planner.py': 1,
    'analysis_workflows.py': 1,
    'bigquery_execution.py': 1,
    'bitcoin_profile.py': 10,
    'data_source_profiles.py': 6,
    'evidence_components.py': 1,
    'ga4_profile.py': 5,
    'metrics.json': 2,
    'sql_generation.py': 1,
    'sql_prompt_context.py': 3,
    'tenant_serve.py': 1,
  },
  sourceProfileApi: {
    'analysis_dashboard_plan.py': 2,
    'analysis_planner.py': 1,
    'analysis_workflows.py': 13,
    'dashboard_build.py': 2,
    'data_source_profiles.py': 10,
    'section_execution.py': 3,
  },
  fixedSchemaKnowledge: {
    'bitcoin_profile.py': 14,
    'ga4_profile.py': 2,
    'metrics.json': 18,
    'run_report.py': 1,
    'sql_prompt_context.py': 22,
    'tenant_serve.py': 5,
    'visualization_contracts.py': 9,
    'visualization_sections.py': 5,
  },
  fixedMetricAsset: {
    'sql_prompt_context.py': 1,
  },
  sourceSpecificSqlRepair: {
    'analysis_workflows.py': 4,
    'bitcoin_profile.py': 3,
    'dashboard_build.py': 2,
    'data_source_profiles.py': 11,
    'ga4_profile.py': 2,
    'section_execution.py': 1,
    'sql_generation.py': 1,
    'sql_prompt_context.py': 1,
  },
  fixedDemoPeriod: {
    'bitcoin_profile.py': 2,
    'ga4_profile.py': 3,
  },
  fixedBusinessVocabulary: {
    'data_source_profiles.py': 2,
    'metrics.json': 17,
    'sql_prompt_context.py': 6,
  },
  fixedDatasetConstant: {
    'bigquery_execution.py': 1,
    'bitcoin_profile.py': 2,
    'tenant_serve.py': 1,
  },
  embeddedQuery: {
    'analysis_consultation.py': 1,
    'analysis_dashboard_plan.py': 1,
    'evidence_components.py': 1,
    'metrics.json': 4,
    'sql_display.py': 1,
    'tenant_serve.py': 3,
  },
  embeddedSchema: {
    'bitcoin_profile.py': 1,
    'sql_prompt_context.py': 1,
  },
  qualifiedTableLiteral: {
    'sql_prompt_context.py': 1,
    'tenant_serve.py': 1,
  },
  sourceSpecificModuleName: {
    'bitcoin_profile.py': 1,
    'data_source_profiles.py': 1,
    'ga4_profile.py': 1,
  },
  runtimeConfigAsset: {
    'metrics.json': 1,
  },
};

function runtimeFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'assets') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...runtimeFiles(absolute));
    } else if (RUNTIME_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function inventoryEntries(entries: { relative: string; source: string }[]): Inventory {
  const observed = Object.fromEntries(Object.keys(RULES).map((rule) => [rule, {}])) as Inventory;

  for (const { relative, source } of entries) {
    for (const [rule, definition] of Object.entries(RULES) as [
      RuleName,
      (typeof RULES)[RuleName],
    ][]) {
      const inspected = definition.target === 'path' ? relative : source;
      const matches = countMatches(inspected, definition.pattern);
      if (matches > 0) observed[rule][relative] = matches;
    }
  }
  return observed;
}

function inventory(root: string): Inventory {
  return inventoryEntries(
    runtimeFiles(root).map((absolute) => ({
      relative: path.relative(root, absolute),
      source: readFileSync(absolute, 'utf8'),
    })),
  );
}

test('source-specific runtime debt cannot grow or move without shrinking the ratchet', () => {
  const observed = inventory(RUNTIME_ROOT);
  assert.deepEqual(
    observed,
    EXPECTED_LEGACY_INVENTORY,
    `Remove runtime debt and shrink this baseline in the same change; never add, move, or increase entries. Observed inventory:\n${JSON.stringify(observed, null, 2)}`,
  );
});

test('ratchet detects source-specific behavior in a new runtime file', () => {
  const observed = inventoryEntries([
    {
      relative: 'new_source_profile.py',
      source: [
        'profile: str = "ga4"',
        'DATASET = "vendor.customer"',
        'SCHEMA_DDL = "event_params ARRAY"',
        'load("metrics.json")',
        'period_for_question("2021年1月の購入")',
        'CREATE TABLE example (amount INT64)',
        'SELECT amount FROM `vendor.customer.orders`',
      ].join('\n'),
    },
    { relative: 'source_metrics.yaml', source: '{}' },
  ]);

  for (const matches of Object.values(observed)) {
    assert.ok(Object.keys(matches).length > 0);
  }
});

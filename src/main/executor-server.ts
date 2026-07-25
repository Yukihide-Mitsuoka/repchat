// Composition root for the executor HTTP service (ADR-0005 §7, MCP step).
//
// Wires the real adapters — Postgres for the binding/catalog, BigQuery for
// execution, per-tenant impersonation for the D1 connection identity — to
// createExecutorHandler, and serves it. Thin deploy-glue: all logic is in the
// tested handler/adapters.
//
// Secrets come from the environment and are NEVER logged (GR-001). Credentials
// for BigQuery come from ADC (an attached service account in the deploy, or
// `gcloud auth application-default login` locally), read by AdcTokenProvider.
import { ExecuteQuery } from '../modules/executor/application/execute.ts';
import { BigQueryRunner } from '../modules/executor/infrastructure/bigquery.ts';
import { AdcTokenProvider } from '../modules/executor/infrastructure/google-auth.ts';
import { ImpersonatingTokenProvider } from '../modules/executor/infrastructure/impersonation.ts';
import { createExecutorHandler } from '../modules/executor/interface/http.ts';
import { ControlPlaneDb } from '../modules/control-plane/infrastructure/pg.ts';
import {
  PgAuditSink,
  PgBindingResolver,
} from '../modules/control-plane/infrastructure/adapters.ts';
import type { QueryPolicy } from '../modules/executor/domain/types.ts';
import { optionalEnv, portFromEnv, requireEnv } from './env.ts';
import { serve } from './serve.ts';

/**
 * The table allowlist, from QUERY_POLICY (JSON). Fail closed: if it is unset or
 * malformed, no table is queryable and every request is refused — a service
 * that cannot prove its policy must not serve data (LOG-0039: the policy is
 * injected for Phase 1's single datasource shape; it becomes per-tenant data
 * when a second shape appears).
 */
function policyFromEnv(): QueryPolicy {
  const raw = optionalEnv('QUERY_POLICY');
  if (raw === undefined) return { tables: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('QUERY_POLICY is not valid JSON');
    process.exit(2);
  }
  const tables = (parsed as { tables?: unknown }).tables;
  if (
    !Array.isArray(tables) ||
    !tables.every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { name?: unknown }).name === 'string' &&
        (typeof (t as { scopeColumn?: unknown }).scopeColumn === 'string' ||
          (t as { scopeColumn?: unknown }).scopeColumn === null),
    )
  ) {
    console.error('QUERY_POLICY must be {"tables":[{"name":string,"scopeColumn":string|null}, …]}');
    process.exit(2);
  }
  return { tables: tables as QueryPolicy['tables'] };
}

async function main(): Promise<void> {
  const db = new ControlPlaneDb({
    databaseUrl: requireEnv('DATABASE_URL'),
    appPassword: requireEnv('APP_RUNTIME_PASSWORD'),
  });
  const bindings = new PgBindingResolver(db, policyFromEnv());
  const runner = new BigQueryRunner({
    tokens: new ImpersonatingTokenProvider({ source: new AdcTokenProvider() }),
  });
  const execute = new ExecuteQuery({ bindings, runner, audit: new PgAuditSink(db) });
  const handler = createExecutorHandler({
    execute,
    catalog: bindings,
    serviceToken: requireEnv('EXECUTOR_TOKEN'),
  });

  const port = portFromEnv(8787);
  const server = await serve(handler, port);
  console.log(`executor service listening on :${server.port}`);

  const shutdown = (): void => {
    void server
      .close()
      .then(() => db.end())
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('executor service failed to start:', e instanceof Error ? e.message : 'error');
  process.exit(1);
});

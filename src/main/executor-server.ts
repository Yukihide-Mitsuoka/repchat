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
import type { QueryPolicy } from '../modules/executor/domain/types.ts';
import { optionalEnv, portFromEnv, requireEnv } from './env.ts';

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
  // Reject invalid configuration before loading database, auth, and BigQuery
  // implementations. Concurrent coverage work can make that dependency graph
  // slow, but it must not delay a deterministic configuration refusal.
  const databaseUrl = requireEnv('DATABASE_URL');
  const appPassword = requireEnv('APP_RUNTIME_PASSWORD');
  const serviceToken = requireEnv('EXECUTOR_TOKEN');
  const policy = policyFromEnv();
  const port = portFromEnv(8787);

  const [application, bigquery, auth, impersonation, http, database, adapters, serving] =
    await Promise.all([
      import('../modules/executor/application/execute.ts'),
      import('../modules/executor/infrastructure/bigquery.ts'),
      import('../modules/executor/infrastructure/google-auth.ts'),
      import('../modules/executor/infrastructure/impersonation.ts'),
      import('../modules/executor/interface/http.ts'),
      import('../modules/control-plane/infrastructure/pg.ts'),
      import('../modules/control-plane/infrastructure/adapters.ts'),
      import('./serve.ts'),
    ]);

  const { ExecuteQuery } = application;
  const { BigQueryRunner } = bigquery;
  const { AdcTokenProvider } = auth;
  const { ImpersonatingTokenProvider } = impersonation;
  const { createExecutorHandler } = http;
  const { ControlPlaneDb } = database;
  const { PgAuditSink, PgBindingResolver } = adapters;
  const { serve } = serving;
  const db = new ControlPlaneDb({
    databaseUrl,
    appPassword,
  });
  const bindings = new PgBindingResolver(db, policy);
  const runner = new BigQueryRunner({
    // The SOURCE identity needs cloud-platform, not bigquery: its only job is
    // to call IAM Credentials generateAccessToken, and on Cloud Run the
    // metadata server issues a token limited to exactly the scopes asked for.
    // A bigquery-scoped source token is refused by IAM with 403 however
    // correct the tokenCreator grant is (LOG-0059). The token this mints for
    // the tenant is still bigquery-only — ImpersonatingTokenProvider sets that
    // in the request body, so the impersonated principal gains nothing wider.
    //
    // Local ADC is a user credential carrying cloud-platform already, which is
    // why LOG-0052's backstop passed on a laptop and failed once deployed.
    tokens: new ImpersonatingTokenProvider({
      source: new AdcTokenProvider(['https://www.googleapis.com/auth/cloud-platform']),
    }),
  });
  const execute = new ExecuteQuery({ bindings, runner, audit: new PgAuditSink(db) });
  const handler = createExecutorHandler({
    execute,
    catalog: bindings,
    serviceToken,
  });

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

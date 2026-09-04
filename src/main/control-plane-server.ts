// Composition root for the control-plane HTTP service (原則D read side).
//
// A thin Node process: it reads configuration from the environment, wires the
// real Postgres adapters to createControlPlaneHandler, and serves it. All logic
// lives in the tested handler/adapters — this file only assembles them, so it
// stays deploy-glue rather than something to unit-test.
//
// Secrets (DATABASE_URL, APP_RUNTIME_PASSWORD, CONTROL_PLANE_TOKEN) come from
// the environment and are NEVER logged (GR-001).
import { requireEnv, portFromEnv } from './env.ts';

async function main(): Promise<void> {
  // Validate the cheap, synchronous boundary before loading database and HTTP
  // implementations. A misconfigured process must fail closed even when the
  // runtime is under enough instrumentation load to make those imports slow.
  const databaseUrl = requireEnv('DATABASE_URL');
  const appPassword = requireEnv('APP_RUNTIME_PASSWORD');
  const serviceToken = requireEnv('CONTROL_PLANE_TOKEN');
  const port = portFromEnv(8788);

  const [database, adapters, http, serving] = await Promise.all([
    import('../modules/control-plane/infrastructure/pg.ts'),
    import('../modules/control-plane/infrastructure/adapters.ts'),
    import('../modules/control-plane/interface/http.ts'),
    import('./serve.ts'),
  ]);

  const { ControlPlaneDb } = database;
  const { PgAuditSink, PgControlPlaneReader } = adapters;
  const { createControlPlaneHandler } = http;
  const { serve } = serving;
  const db = new ControlPlaneDb({
    databaseUrl,
    appPassword,
  });
  const handler = createControlPlaneHandler({
    reader: new PgControlPlaneReader(db),
    audit: new PgAuditSink(db),
    serviceToken,
  });

  const server = await serve(handler, port);
  // Only non-secret facts are logged.
  console.log(`control-plane service listening on :${server.port}`);

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
  // Never echo the error body wholesale — it could carry a connection string.
  console.error('control-plane service failed to start:', e instanceof Error ? e.message : 'error');
  process.exit(1);
});

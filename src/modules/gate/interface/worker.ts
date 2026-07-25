// Cloudflare Workers entry — the composition root (ADR-0006). Wires the real
// edge adapters (Workers KV + WebCrypto) to the runtime-agnostic GateService,
// then delegates routing to createHandler.
//
// The two production SEAMs — control plane and executor — are reached over HTTP
// (their real adapters use Node-only drivers the Workers runtime cannot load).
// Each falls back to an in-memory stand-in only when its service is not
// configured, so `wrangler dev` serves real end-to-end responses today and a
// misconfigured deploy is obvious rather than silently serving fixture data.
import { GateService } from '../application/gate-service.ts';
import type {
  AuditSink,
  AuthzEntry,
  ControlPlaneReader,
  QueryExecutor,
  ResultPayload,
} from '../application/ports.ts';
import { MemoryControlPlane, MemoryExecutor } from '../infrastructure/memory.ts';
import {
  Es256TokenVerifier,
  SystemClock,
  WebCryptoHasher,
  type PublicJwk,
} from '../infrastructure/webcrypto.ts';
import { WorkersKvStore, type WorkersKvBinding } from '../infrastructure/workers-kv.ts';
import { HttpQueryExecutor } from '../infrastructure/http-executor.ts';
import { HttpControlPlane } from '../infrastructure/http-control-plane.ts';
import { createHandler } from './handler.ts';

export interface GateEnv {
  readonly RESULT_KV: WorkersKvBinding;
  readonly AUTHZ_KV: WorkersKvBinding;
  readonly DENYLIST_KV: WorkersKvBinding;
  readonly SHELL_KV: WorkersKvBinding;
  /** JSON object `{ "<kid>": <public-JWK> }` — vendor JWT verification keys. */
  readonly VENDOR_KEYS: string;
  /** Expected JWT `aud`. */
  readonly GATE_AUDIENCE: string;
  /** Executor service base URL. Absent → the in-memory fallback is used. */
  readonly EXECUTOR_URL?: string;
  /** Shared secret proving this gate to the executor service. Never logged. */
  readonly EXECUTOR_TOKEN?: string;
  /** Control-plane service base URL. Absent → the in-memory fixture is used. */
  readonly CONTROL_PLANE_URL?: string;
  /** Shared secret proving this gate to the control-plane service. Never logged. */
  readonly CONTROL_PLANE_TOKEN?: string;
}

// Fallback (control plane = Postgres): a one-tenant fixture for local
// `wrangler dev`, used only when the control-plane service is not configured.
function bootstrapControlPlane(): MemoryControlPlane {
  return new MemoryControlPlane({
    tenants: { t_demo: { authEpoch: 0 } },
    users: { u_demo: { tenantId: 't_demo', authEpoch: 0, roles: ['manager'] } },
    roles: { t_demo: { manager: { dataScope: { kind: 'all' }, reports: ['r_demo'] } } },
    reports: { t_demo: { r_demo: { reportVersion: 1 } } },
    dataVersions: { t_demo: 1 },
  });
}

// SEAM (executor): fallback stand-in, used only when EXECUTOR_URL/TOKEN are
// unset. Production wires HttpQueryExecutor (see executorFor); a Node
// composition root can inject the in-process executor instead (see
// spikes/gate-executor-slice/), which Workers cannot do because BigQuery
// credentials come from google-auth-library, a Node-only package.
function bootstrapExecutor(): MemoryExecutor {
  return new MemoryExecutor({
    t_demo: [
      { store_id: 's1', category: 'A', amount: 40_000 },
      { store_id: 's1', category: 'B', amount: 25_000 },
    ],
  });
}

function noopAudit(): AuditSink {
  return {
    async record(): Promise<void> {
      // Fallback audit sink, used with the in-memory control plane. Deliberately
      // never throws, so a request is not failed by an audit write — the same
      // contract HttpControlPlane.record keeps when the real sink is wired.
    },
  };
}

/**
 * Production topology (原則D): the Worker reaches the control plane over HTTP,
 * because PgControlPlaneReader uses a Node-only driver. One HttpControlPlane
 * instance serves both the read side and the audit sink. Falls back to the
 * in-memory fixture + no-op audit only when the service is not configured.
 */
function controlPlaneFor(env: GateEnv): { controlPlane: ControlPlaneReader; audit: AuditSink } {
  if (env.CONTROL_PLANE_URL === undefined || env.CONTROL_PLANE_TOKEN === undefined) {
    return { controlPlane: bootstrapControlPlane(), audit: noopAudit() };
  }
  const http = new HttpControlPlane({
    baseUrl: env.CONTROL_PLANE_URL,
    serviceToken: env.CONTROL_PLANE_TOKEN,
  });
  return { controlPlane: http, audit: http };
}

/**
 * Optional overrides for composition roots that supply real adapters directly —
 * e.g. a Node host that injects the in-process Postgres/executor adapters
 * instead of going over HTTP. An override wins over the env-based selection.
 */
export interface GateOverrides {
  readonly executor?: QueryExecutor;
  readonly controlPlane?: ControlPlaneReader;
  readonly audit?: AuditSink;
}

/**
 * Production topology (ADR-0005 §7): the Worker calls the executor service over
 * HTTP, because the in-process executor needs Node-only credentials. Falls back
 * to the in-memory stand-in only when the service is not configured, so a
 * misconfigured deploy is obvious rather than silently serving fixture data.
 */
function executorFor(env: GateEnv): QueryExecutor {
  if (env.EXECUTOR_URL === undefined || env.EXECUTOR_TOKEN === undefined) {
    return bootstrapExecutor();
  }
  return new HttpQueryExecutor({
    baseUrl: env.EXECUTOR_URL,
    serviceToken: env.EXECUTOR_TOKEN,
  });
}

export function buildGate(env: GateEnv, overrides: GateOverrides = {}): GateService {
  const clock = new SystemClock();
  const vendorKeys = new Map<string, PublicJwk>(
    Object.entries(JSON.parse(env.VENDOR_KEYS) as Record<string, PublicJwk>),
  );
  const cp = controlPlaneFor(env);
  return new GateService({
    verifier: new Es256TokenVerifier(vendorKeys, env.GATE_AUDIENCE),
    controlPlane: overrides.controlPlane ?? cp.controlPlane,
    authzCache: new WorkersKvStore<AuthzEntry>(env.AUTHZ_KV),
    resultCache: new WorkersKvStore<ResultPayload>(env.RESULT_KV),
    denylist: new WorkersKvStore<true>(env.DENYLIST_KV),
    shellCache: new WorkersKvStore<string>(env.SHELL_KV),
    executor: overrides.executor ?? executorFor(env),
    hasher: new WebCryptoHasher(),
    audit: overrides.audit ?? cp.audit,
    clock,
  });
}

export default {
  async fetch(request: Request, env: GateEnv, overrides?: GateOverrides): Promise<Response> {
    return createHandler(buildGate(env, overrides ?? {}))(request);
  },
};

// Inbound HTTP for the control-plane service (原則D read side over the wire).
//
// The Workers gate cannot use PgControlPlaneReader / PgAuditSink directly — the
// porsager driver needs TCP sockets, a Node-only capability — so it reaches the
// control plane over HTTP, exactly as it reaches the executor (#65). This is the
// Node side: it fronts the real Postgres adapters and authenticates the calling
// gate with a shared service secret before answering.
//
// TRUST BOUNDARY (narrower than the executor's): the gate only *asks* here — it
// reads authz facts and appends audit rows. It cannot assert a tenant boundary,
// because RLS inside the adapters resolves every read from app.tenant_id, not
// from anything on the wire. The secret is still required so that only our gate
// can enumerate tenants/users.
import type { AuditSink, ControlPlaneReader } from '../../gate/application/ports.ts';

export interface ControlPlaneHttpDeps {
  readonly reader: ControlPlaneReader;
  readonly audit: AuditSink;
  /** Shared secret proving the caller is the gate. Never logged or echoed. */
  readonly serviceToken: string;
}

/** Constant-time comparison — a length-or-prefix leak would weaken the secret. */
function secretsMatch(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const span = Math.max(left.length, right.length);
  for (let i = 0; i < span; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const json = (body: unknown, status: number): Response =>
  Response.json(body as Record<string, unknown>, { status });

/** Reads a required string field, or null if absent/wrong-typed (→ 400). */
function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' ? v : null;
}

/** Validates the audit event shape fail-closed; detail values must be strings. */
function parseAuditEvent(
  raw: unknown,
): { tenantId: string; action: string; detail: Record<string, string> } | null {
  if (!isRecord(raw)) return null;
  const tenantId = str(raw, 'tenantId');
  const action = str(raw, 'action');
  if (tenantId === null || action === null) return null;
  const detailRaw = raw['detail'] ?? {};
  if (!isRecord(detailRaw)) return null;
  const detail: Record<string, string> = {};
  for (const [k, v] of Object.entries(detailRaw)) {
    if (typeof v !== 'string') return null;
    detail[k] = v;
  }
  return { tenantId, action, detail };
}

/**
 * POST /v1/control  { op, ... }  → per-op JSON body.
 *   tenantEpoch  { tenantId }              → { epoch: number | null }
 *   user         { tenantId, userId }      → { user: {...} | null }
 *   reportVersion{ tenantId, reportId }    → { version: number | null }
 *   dataVersion  { tenantId }              → { version: number }
 *   audit        { event }                 → { ok: true }
 * A missing/malformed argument is a 400, never a coerced default.
 */
export function createControlPlaneHandler(
  deps: ControlPlaneHttpDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') return new Response('ok');
    if (req.method !== 'POST' || url.pathname !== '/v1/control')
      return json({ error: 'not found' }, 404);

    const presented = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (presented === undefined || !secretsMatch(presented, deps.serviceToken))
      return json({ error: 'unauthorized' }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad request' }, 400);
    }
    if (!isRecord(body)) return json({ error: 'bad request' }, 400);

    switch (body['op']) {
      case 'tenantEpoch': {
        const tenantId = str(body, 'tenantId');
        if (tenantId === null) return json({ error: 'bad request' }, 400);
        return json({ epoch: await deps.reader.getTenantEpoch(tenantId) }, 200);
      }
      case 'user': {
        const tenantId = str(body, 'tenantId');
        const userId = str(body, 'userId');
        if (tenantId === null || userId === null) return json({ error: 'bad request' }, 400);
        return json({ user: await deps.reader.getUser(tenantId, userId) }, 200);
      }
      case 'reportVersion': {
        const tenantId = str(body, 'tenantId');
        const reportId = str(body, 'reportId');
        if (tenantId === null || reportId === null) return json({ error: 'bad request' }, 400);
        return json({ version: await deps.reader.getReportVersion(tenantId, reportId) }, 200);
      }
      case 'dataVersion': {
        const tenantId = str(body, 'tenantId');
        if (tenantId === null) return json({ error: 'bad request' }, 400);
        return json({ version: await deps.reader.getDataVersion(tenantId) }, 200);
      }
      case 'audit': {
        const event = parseAuditEvent(body['event']);
        if (event === null) return json({ error: 'bad request' }, 400);
        await deps.audit.record(event);
        return json({ ok: true }, 200);
      }
      default:
        return json({ error: 'unknown op' }, 400);
    }
  };
}

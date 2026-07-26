// Satisfies the gate's ControlPlaneReader + AuditSink ports by calling the
// control-plane service over HTTP — the production Workers topology (原則D).
// fetch-based so it runs on Workers, where PgControlPlaneReader cannot (the
// porsager driver is Node-only, #65's problem for the read side).
//
// Failure modes are deliberately split so the gate fails CLOSED:
//   - reads THROW on a transport/HTTP error. A `null` result is reserved for a
//     successful "not found", which the gate maps to a denial; an unreachable
//     control plane is different (an operator fault) and surfaces as a 500 via
//     the handler's catch — never as a spurious "unknown-principal".
//   - audit.record SWALLOWS errors. An audit outage must not fail a request the
//     gate already served (matches the no-op sink's contract).
import type { DataScope, RoleGrant, TenantId } from '../domain/types.ts';
import type { AuditSink, ControlPlaneReader } from '../application/ports.ts';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface HttpControlPlaneOptions {
  /** Base URL of the control-plane service, e.g. https://control-plane.internal */
  readonly baseUrl: string;
  /** Shared secret proving we are the gate. Never logged. */
  readonly serviceToken: string;
  readonly fetchImpl?: FetchLike;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Re-validate a wire DataScope; an unknown shape is refused, never coerced. */
function parseScope(raw: unknown): DataScope | null {
  if (!isRecord(raw)) return null;
  if (raw['kind'] === 'all') return { kind: 'all' };
  if (raw['kind'] === 'stores') {
    const ids = raw['storeIds'];
    if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'string')) return null;
    return { kind: 'stores', storeIds: ids as string[] };
  }
  return null;
}

/** Reconstruct a user's grants defensively — a malformed grant is fatal, not open. */
function parseGrants(raw: unknown): readonly RoleGrant[] {
  if (!Array.isArray(raw)) throw new Error('control-plane: malformed grants');
  return raw.map((g) => {
    if (!isRecord(g)) throw new Error('control-plane: malformed grant');
    const dataScope = parseScope(g['dataScope']);
    const reports = g['reports'];
    if (
      dataScope === null ||
      !Array.isArray(reports) ||
      !reports.every((r) => typeof r === 'string')
    )
      throw new Error('control-plane: malformed grant');
    return { dataScope, reports: reports as string[] };
  });
}

export class HttpControlPlane implements ControlPlaneReader, AuditSink {
  readonly #o: HttpControlPlaneOptions;
  readonly #fetch: FetchLike;

  constructor(options: HttpControlPlaneOptions) {
    this.#o = options;
    // Bound to globalThis on purpose. Stored detached and then called as
    // `this.#fetch(...)`, the receiver would be this adapter, and the Workers
    // runtime rejects that with "Illegal invocation" — every call fails before
    // a request leaves the isolate, and #call's catch reports it as an
    // unreachable control plane (LOG-0059).
    this.#fetch = options.fetchImpl ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
  }

  /** One authenticated POST. Throws on transport failure or any non-200. */
  async #call(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let status: number;
    let raw: string;
    try {
      const res = await this.#fetch(`${this.#o.baseUrl.replace(/\/$/, '')}/v1/control`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#o.serviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      status = res.status;
      raw = await res.text();
    } catch {
      // Opaque on purpose — a transport message can carry internal hostnames.
      throw new Error('control-plane-unreachable');
    }
    if (status !== 200) throw new Error(`control-plane-error-${status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('control-plane-bad-response');
    }
    if (!isRecord(parsed)) throw new Error('control-plane-bad-response');
    return parsed;
  }

  async getTenantEpoch(tenantId: TenantId): Promise<number | null> {
    const body = await this.#call({ op: 'tenantEpoch', tenantId });
    const epoch = body['epoch'];
    if (epoch === null) return null;
    if (typeof epoch !== 'number') throw new Error('control-plane-bad-response');
    return epoch;
  }

  async getUser(
    tenantId: TenantId,
    userId: string,
  ): Promise<{
    readonly tenantId: TenantId;
    readonly authEpoch: number;
    readonly grants: readonly RoleGrant[];
  } | null> {
    const body = await this.#call({ op: 'user', tenantId, userId });
    const user = body['user'];
    if (user === null) return null;
    if (
      !isRecord(user) ||
      typeof user['authEpoch'] !== 'number' ||
      typeof user['tenantId'] !== 'string'
    )
      throw new Error('control-plane-bad-response');
    return {
      tenantId: user['tenantId'],
      authEpoch: user['authEpoch'],
      grants: parseGrants(user['grants']),
    };
  }

  async getReportVersion(tenantId: TenantId, reportId: string): Promise<number | null> {
    const body = await this.#call({ op: 'reportVersion', tenantId, reportId });
    const version = body['version'];
    if (version === null) return null;
    if (typeof version !== 'number') throw new Error('control-plane-bad-response');
    return version;
  }

  async getDataVersion(tenantId: TenantId): Promise<number> {
    const body = await this.#call({ op: 'dataVersion', tenantId });
    const version = body['version'];
    if (typeof version !== 'number') throw new Error('control-plane-bad-response');
    return version;
  }

  async record(event: {
    readonly tenantId: TenantId;
    readonly action: string;
    readonly detail: Readonly<Record<string, string>>;
  }): Promise<void> {
    try {
      await this.#call({ op: 'audit', event });
    } catch {
      // Best-effort: never fail a served request because the audit write failed.
    }
  }
}

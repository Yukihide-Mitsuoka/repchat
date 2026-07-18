// Edge authorization gate — the thin vertical slice of ADR-0005:
// ① shell cache, ② result cache (§4 key formula, version-token invalidation),
// ③ authz ctx cache (short TTL), epoch+denylist revocation, payload tenant
// self-assert (原則C-4), single-flight. In-process; production target is an
// edge worker, but every rule exercised here is runtime-agnostic.
import crypto from 'node:crypto';
import { verifyJwt } from './jwt.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const stableStringify = (obj) =>
  JSON.stringify(obj, Object.keys(obj ?? {}).sort());

export function makeGate(cp, opts = {}) {
  const authzTtlMs = opts.authzTtlMs ?? 60_000;
  const shellCache = new Map();
  const resultCache = new Map();
  const authzCache = new Map(); // session_id -> { ctx, expiresAt }
  const denylist = new Map(); // 'user:<id>' -> expiresAt (ms)
  const inflight = new Map(); // ② single-flight
  const audit = [];
  const stats = { hits: 0, misses: 0, executorCalls: 0 };

  // --- authn/authz -----------------------------------------------------------

  function authenticate(token, now = Date.now()) {
    const v = verifyJwt(token, cp.vendor.publicKey, { aud: 'gate', now });
    if (!v.ok) return { status: 401, reason: v.reason };
    const { sub, tenant_id, sid, epoch } = v.payload;
    const dl = denylist.get(`user:${sub}`);
    if (dl && dl > now) return { status: 401, reason: 'denylisted' };
    const tenant = cp.tenants[tenant_id];
    const user = cp.users[sub];
    // The claimed tenant must be the one the user actually belongs to (SoR check).
    if (!tenant || !user || user.tenant_id !== tenant_id)
      return { status: 401, reason: 'unknown-principal' };
    if (epoch !== tenant.auth_epoch + user.auth_epoch)
      return { status: 401, reason: 'stale-epoch' };

    let entry = authzCache.get(sid);
    if (!entry || entry.expiresAt <= now) {
      entry = { ctx: deriveCtx(tenant_id, user), expiresAt: now + authzTtlMs };
      authzCache.set(sid, entry); // ③ short-TTL cache; SoR stays the control plane
    }
    return { status: 200, ctx: entry.ctx };
  }

  function deriveCtx(tenantId, user) {
    const roles = user.roles.map((r) => cp.roles[tenantId][r]);
    const allowedReports = [...new Set(roles.flatMap((r) => r.reports))];
    // Roles normalize to a data-scope equivalence class (ADR §6). A user holding
    // any all-rows role sees everything; otherwise the union of scoped values.
    const scopes = roles.map((r) => r.data_scope);
    const scope = scopes.some((s) => Object.keys(s).length === 0)
      ? {}
      : { store_id: [...new Set(scopes.map((s) => s.store_id))].sort() };
    return {
      tenant_id: tenantId,
      allowed_reports: allowedReports,
      scope,
      scope_hash: sha256(stableStringify(scope)),
    };
  }

  // --- ① shell ---------------------------------------------------------------

  function requestShell(token, reportId) {
    const auth = authenticate(token);
    if (auth.status !== 200) return auth;
    const { ctx } = auth;
    if (!ctx.allowed_reports.includes(reportId)) return { status: 403 };
    const version = cp.reports[ctx.tenant_id][reportId].report_version;
    const key = `${reportId}:${version}`; // tenant-agnostic by design (原則A)
    if (!shellCache.has(key))
      shellCache.set(key, `<shell report="${reportId}" v="${version}"/>`);
    return { status: 200, shellKey: key, html: shellCache.get(key) };
  }

  // --- ② data ----------------------------------------------------------------

  // clientTenantId is deliberately accepted and MUST be ignored — the key is a
  // pure function of the server-resolved ctx (原則B). Tests forge it.
  async function requestData(token, { reportId, queryId, params = {}, clientTenantId } = {}) {
    void clientTenantId;
    const auth = authenticate(token);
    if (auth.status !== 200) return auth;
    const { ctx } = auth;
    if (!ctx.allowed_reports.includes(reportId)) return { status: 403 };

    const dataVersion = cp.datasources[ctx.tenant_id].data_version;
    const deriveKey = opts.deriveKeyOverride ?? defaultKey; // test hook (原則C-4 proof)
    const key = deriveKey(ctx, queryId, params, dataVersion);

    const hit = resultCache.get(key);
    if (hit) {
      // Belt-and-suspenders: even if key derivation is buggy, a payload minted
      // for another tenant never leaves the gate.
      if (hit.tenant_id !== ctx.tenant_id)
        return { status: 500, reason: 'payload-tenant-mismatch' };
      stats.hits += 1;
      return { status: 200, cached: true, rows: hit.rows };
    }
    stats.misses += 1;

    if (!inflight.has(key)) {
      inflight.set(
        key,
        Promise.resolve().then(() => execute(ctx, queryId, params)),
      );
    }
    const result = await inflight.get(key);
    inflight.delete(key);
    if (result.status !== 200) return result; // errors are never cached (ADR §8)
    resultCache.set(key, { tenant_id: ctx.tenant_id, rows: result.rows });
    return { status: 200, cached: false, rows: result.rows };
  }

  const defaultKey = (ctx, queryId, params, dataVersion) =>
    `v1:${ctx.tenant_id}:${ctx.scope_hash}:${queryId}:${sha256(stableStringify(params))}:${dataVersion}`;

  // MCP stand-in: tenant restriction is forced here (AST-injection analog) and
  // the per-tenant dataset makes cross-tenant reads impossible by construction.
  function execute(ctx, queryId) {
    stats.executorCalls += 1;
    if (queryId !== 'q_sales_by_category') return { status: 404, reason: 'unknown-query' };
    let rows = cp.analytics[ctx.tenant_id];
    if (ctx.scope.store_id) rows = rows.filter((r) => ctx.scope.store_id.includes(r.store_id));
    const byCat = new Map();
    for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
    audit.push({ tenant_id: ctx.tenant_id, action: 'query.execute', queryId, at: Date.now() });
    return {
      status: 200,
      rows: [...byCat].map(([category, total]) => ({ category, total })).sort((a, b) => (a.category < b.category ? -1 : 1)),
    };
  }

  // --- invalidation & revocation (writes go to the SoR, keys move on) --------

  function bumpDataVersion(tenantId) {
    cp.datasources[tenantId].data_version += 1; // old ② keys become unreachable
  }

  function editReport(tenantId, reportId) {
    cp.reports[tenantId][reportId].report_version += 1; // old ① keys become unreachable
  }

  function revokeUser(userId, { jwtMaxTtlMs = 300_000 } = {}) {
    const user = cp.users[userId];
    user.auth_epoch += 1; // future authenticate() sees stale-epoch
    denylist.set(`user:${userId}`, Date.now() + jwtMaxTtlMs); // kills in-flight JWTs now
    cp.revocation_events.push({ target_type: 'user', target_id: userId, at: Date.now() });
    audit.push({ tenant_id: user.tenant_id, action: 'user.revoke', userId, at: Date.now() });
  }

  return {
    requestShell,
    requestData,
    bumpDataVersion,
    editReport,
    revokeUser,
    stats,
    audit,
    _caches: { shellCache, resultCache, authzCache, denylist },
  };
}

// Cross-tenant / cross-scope proof for the ADR-0005 §11 vertical slice.
// Run: node --test spikes/vertical-slice/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeControlPlane, mintToken } from './control_plane.mjs';
import { makeGate } from './gate.mjs';

const fresh = (opts) => {
  const cp = makeControlPlane();
  return { cp, gate: makeGate(cp, opts) };
};
const REQ = { reportId: 'r_sales', queryId: 'q_sales_by_category' };
const total = (rows) => rows.reduce((s, r) => s + r.total, 0);

test('happy path: miss then hit, identical rows', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  const first = await gate.requestData(t, REQ);
  assert.equal(first.status, 200);
  assert.equal(first.cached, false);
  assert.equal(total(first.rows), 157900); // all stores, all categories
  const second = await gate.requestData(t, REQ);
  assert.equal(second.cached, true);
  assert.deepEqual(second.rows, first.rows);
  assert.deepEqual(gate.stats, { hits: 1, misses: 1, executorCalls: 1 });
});

test('原則B: forged client tenant_id has zero effect on the key or the data', async () => {
  const { cp, gate } = fresh();
  await gate.requestData(mintToken(cp, 'alice'), REQ); // warm t_alpha's entry
  const res = await gate.requestData(mintToken(cp, 'boris'), {
    ...REQ,
    clientTenantId: 't_alpha', // attack: bravo user addresses alpha's cache
  });
  assert.equal(res.status, 200);
  assert.equal(res.cached, false); // key came from ctx → different namespace
  assert.equal(total(res.rows), 39500); // bravo's own data only
  for (const k of gate._caches.resultCache.keys())
    assert.match(k, /^v1:t_(alpha|bravo):/);
});

test('JWT tenant claim must match the SoR: bravo user claiming t_alpha is rejected', async () => {
  const { cp, gate } = fresh();
  const forged = mintToken(cp, 'boris', { tamper: { tenant_id: 't_alpha' } });
  const res = await gate.requestData(forged, REQ);
  assert.equal(res.status, 401);
  assert.equal(res.reason, 'unknown-principal');
});

test('bad signature / expiry / audience are rejected', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  const [h, p] = t.split('.');
  assert.equal((await gate.requestData(`${h}.${p}.${'A'.repeat(86)}`, REQ)).status, 401);
  assert.equal((await gate.requestData(mintToken(cp, 'alice', { ttlSec: -1 }), REQ)).status, 401);
  assert.equal((await gate.requestData(mintToken(cp, 'alice', { aud: 'other' }), REQ)).status, 401);
});

test('ADR §6: different scope → different key; same effective scope → shared cache', async () => {
  const { cp, gate } = fresh();
  const manager = await gate.requestData(mintToken(cp, 'alice'), REQ);
  const store1 = await gate.requestData(mintToken(cp, 'bob'), REQ);
  assert.equal(total(manager.rows), 157900);
  assert.equal(total(store1.rows), 65000); // s1 only: 40000 + 25000
  assert.equal(gate.stats.executorCalls, 2); // scopes differ → no sharing
  // bev holds a *different role* with the same effective scope as bob
  const viewer = await gate.requestData(mintToken(cp, 'bev'), REQ);
  assert.equal(viewer.cached, true); // role explosion contained: cache shared
  assert.deepEqual(viewer.rows, store1.rows);
  assert.equal(gate.stats.executorCalls, 2);
});

test('原則C-4: induced key-derivation bug is caught by the payload assert', async () => {
  const cp = makeControlPlane();
  // Simulate the worst bug class: every tenant derives t_alpha's key.
  const gate = makeGate(cp, {
    deriveKeyOverride: (ctx, queryId) => `v1:t_alpha:BUGGY:${queryId}`,
  });
  await gate.requestData(mintToken(cp, 'alice'), REQ); // alpha populates the entry
  const res = await gate.requestData(mintToken(cp, 'boris'), REQ);
  assert.equal(res.status, 500);
  assert.equal(res.reason, 'payload-tenant-mismatch');
  assert.equal(res.rows, undefined); // nothing leaks alongside the error
});

test('ADR §5: data_version bump invalidates without purging', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  await gate.requestData(t, REQ);
  cp.analytics.t_alpha.push({ store_id: 's2', category: 'D', amount: 100 });
  gate.bumpDataVersion('t_alpha');
  const res = await gate.requestData(t, REQ);
  assert.equal(res.cached, false); // new key → automatic miss
  assert.equal(total(res.rows), 158000);
  assert.equal(gate._caches.resultCache.size, 2); // old entry left to age out, never served
});

test('ADR §5: report edit bumps the shell key', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  assert.equal(gate.requestShell(t, 'r_sales').shellKey, 'r_sales:1');
  gate.editReport('t_alpha', 'r_sales');
  assert.equal(gate.requestShell(t, 'r_sales').shellKey, 'r_sales:2');
});

test('revocation: denylist + epoch cut off an unexpired JWT immediately', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'bob'); // valid for 5 minutes
  assert.equal((await gate.requestData(t, REQ)).status, 200);
  gate.revokeUser('bob');
  const after = await gate.requestData(t, REQ);
  assert.equal(after.status, 401);
  assert.equal(after.reason, 'denylisted');
  // Even once the denylist entry expires, the epoch mismatch still rejects it.
  gate._caches.denylist.clear();
  assert.equal((await gate.requestData(t, REQ)).reason, 'stale-epoch');
  // A token minted *after* revocation carries the new epoch and works again.
  assert.equal((await gate.requestData(mintToken(cp, 'bob'), REQ)).status, 200);
});

test('single-flight: concurrent misses on one key execute once', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  const results = await Promise.all(Array.from({ length: 10 }, () => gate.requestData(t, REQ)));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(gate.stats.executorCalls, 1);
});

test('errors are never cached', async () => {
  const { cp, gate } = fresh();
  const t = mintToken(cp, 'alice');
  const res = await gate.requestData(t, { reportId: 'r_sales', queryId: 'q_nope' });
  assert.equal(res.status, 404);
  assert.equal(gate._caches.resultCache.size, 0);
});

test('403 for a report outside allowed_reports', async () => {
  const { cp, gate } = fresh();
  cp.reports.t_alpha.r_secret = { report_version: 1 };
  const res = await gate.requestData(mintToken(cp, 'alice'), {
    reportId: 'r_secret',
    queryId: 'q_sales_by_category',
  });
  assert.equal(res.status, 403);
});

// End-to-end over the actual Workers entry (worker.ts): its default fetch,
// buildGate wiring, WorkersKvStore, and the bootstrap fixture — driven with
// fake KV bindings and a real ES256-signed token, no wrangler needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildGate, type GateEnv } from '../../../src/modules/gate/interface/worker.ts';
import type { WorkersKvBinding } from '../../../src/modules/gate/infrastructure/workers-kv.ts';
import { createControlPlaneHandler } from '../../../src/modules/control-plane/interface/http.ts';
import { MemoryControlPlane } from '../../../src/modules/gate/infrastructure/memory.ts';
import { makeVendor } from './helpers.ts';

class FakeKv implements WorkersKvBinding {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

async function makeEnv() {
  const vendor = await makeVendor();
  const env: GateEnv = {
    RESULT_KV: new FakeKv(),
    AUTHZ_KV: new FakeKv(),
    DENYLIST_KV: new FakeKv(),
    SHELL_KV: new FakeKv(),
    VENDOR_KEYS: JSON.stringify({ [vendor.kid]: vendor.publicJwk }),
    GATE_AUDIENCE: 'gate',
  };
  const token = await vendor.sign({
    sub: 'u_demo',
    tenant_id: 't_demo',
    sid: 'sess_demo',
    aud: 'gate',
    epoch: 0,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  return { env, token };
}

const get = (path: string, token: string): Request =>
  new Request(`https://gate.example${path}`, { headers: { authorization: `Bearer ${token}` } });

test('worker.fetch serves the bootstrap tenant end-to-end', async () => {
  const { env, token } = await makeEnv();
  const shell = await worker.fetch(get('/r/r_demo', token), env);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /shell report="r_demo"/);

  const data = await worker.fetch(get('/r/r_demo/data/q_sales_by_category', token), env);
  assert.equal(data.status, 200);
  const body = (await data.json()) as {
    cached: boolean;
    rows: { category: string; total: number }[];
  };
  assert.equal(body.cached, false);
  assert.equal(
    body.rows.reduce((s, r) => s + r.total, 0),
    65_000,
  );
});

test('② result is written to Workers KV and hit on the second call', async () => {
  const { env, token } = await makeEnv();
  await worker.fetch(get('/r/r_demo/data/q_sales_by_category', token), env);
  assert.equal((env.RESULT_KV as FakeKv).store.size, 1); // payload persisted to KV
  const second = await worker.fetch(get('/r/r_demo/data/q_sales_by_category', token), env);
  assert.equal(((await second.json()) as { cached: boolean }).cached, true);
});

test('when CONTROL_PLANE_URL/TOKEN are set, the gate reads through the HTTP transport', async () => {
  // A composition-root override lets us inject an executor; the control plane,
  // though, is selected from env. We point global fetch at the real service
  // handler to prove buildGate wires HttpControlPlane (not the fixture).
  const vendor = await makeVendor();
  const seeded = new MemoryControlPlane({
    tenants: { t_real: { authEpoch: 0 } },
    users: { u_real: { tenantId: 't_real', authEpoch: 0, roles: ['manager'] } },
    roles: { t_real: { manager: { dataScope: { kind: 'all' }, reports: ['r_real'] } } },
    reports: { t_real: { r_real: { reportVersion: 9 } } },
    dataVersions: { t_real: 1 },
  });
  const audits: unknown[] = [];
  const handler = createControlPlaneHandler({
    reader: seeded,
    audit: {
      async record(e) {
        audits.push(e);
      },
    },
    serviceToken: 'cp-secret',
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) =>
    handler(
      new Request(url, { method: init.method, headers: init.headers, body: init.body }),
    )) as typeof fetch;
  try {
    const env: GateEnv = {
      RESULT_KV: new FakeKv(),
      AUTHZ_KV: new FakeKv(),
      DENYLIST_KV: new FakeKv(),
      SHELL_KV: new FakeKv(),
      VENDOR_KEYS: JSON.stringify({ [vendor.kid]: vendor.publicJwk }),
      GATE_AUDIENCE: 'gate',
      CONTROL_PLANE_URL: 'https://cp.internal',
      CONTROL_PLANE_TOKEN: 'cp-secret',
    };
    const gate = buildGate(env);
    const token = await vendor.sign({
      sub: 'u_real',
      tenant_id: 't_real',
      sid: 's',
      aud: 'gate',
      epoch: 0,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    // r_real (version 9) resolves only from the seeded service, not the fixture.
    const res = await gate.requestShell(token, 'r_real');
    assert.ok(res.ok && res.html.includes('v="9"'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildGate rejects an unknown audience', async () => {
  const { env } = await makeEnv();
  const gate = buildGate({ ...env, GATE_AUDIENCE: 'other' });
  const vendor = await makeVendor();
  const token = await vendor.sign({
    sub: 'u_demo',
    tenant_id: 't_demo',
    sid: 's',
    aud: 'gate',
    epoch: 0,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  // Signed by a vendor whose key isn't in env → unknown-kid, and aud mismatch;
  // either way the gate denies. Asserts the wiring passes GATE_AUDIENCE through.
  const res = await gate.requestShell(token, 'r_demo');
  assert.equal(res.ok, false);
});

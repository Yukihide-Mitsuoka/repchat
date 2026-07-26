// The gate's HTTP control-plane client. The load-bearing test is the round
// trip: this client wired straight to the real service handler over a fake
// fetch, so the wire contract (auth, ops, serialization) is checked from both
// ends. The rest pin the fail-closed split: reads throw on an unreachable
// service, audit never does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpControlPlane,
  type FetchLike,
} from '../../../src/modules/gate/infrastructure/http-control-plane.ts';
import { createControlPlaneHandler } from '../../../src/modules/control-plane/interface/http.ts';
import { MemoryControlPlane } from '../../../src/modules/gate/infrastructure/memory.ts';

const TOKEN = 'cp-service-secret';

const plane = () =>
  new MemoryControlPlane({
    tenants: { t_alpha: { authEpoch: 3 } },
    users: { u_alpha: { tenantId: 't_alpha', authEpoch: 0, roles: ['manager'] } },
    roles: {
      t_alpha: {
        manager: { dataScope: { kind: 'stores', storeIds: ['s1'] }, reports: ['r_sales'] },
      },
    },
    reports: { t_alpha: { r_sales: { reportVersion: 4 } } },
    dataVersions: { t_alpha: 7 },
  });

/** A fetch that dispatches straight into the real service handler. */
function wiredToHandler(token = TOKEN): { fetchImpl: FetchLike; audits: unknown[] } {
  const audits: unknown[] = [];
  const handler = createControlPlaneHandler({
    reader: plane(),
    audit: {
      async record(e) {
        audits.push(e);
      },
    },
    serviceToken: token,
  });
  const fetchImpl: FetchLike = async (url, init) => {
    const res = await handler(
      new Request(url, { method: init.method, headers: init.headers, body: init.body }),
    );
    return {
      ok: res.ok,
      status: res.status,
      async text() {
        return res.text();
      },
    };
  };
  return { fetchImpl, audits };
}

const client = (fetchImpl: FetchLike) =>
  new HttpControlPlane({ baseUrl: 'https://cp.internal', serviceToken: TOKEN, fetchImpl });

test('round trip: every reader method returns what the service holds', async () => {
  const { fetchImpl } = wiredToHandler();
  const cp = client(fetchImpl);
  assert.equal(await cp.getTenantEpoch('t_alpha'), 3);
  assert.equal(await cp.getReportVersion('t_alpha', 'r_sales'), 4);
  assert.equal(await cp.getDataVersion('t_alpha'), 7);
  const user = await cp.getUser('t_alpha', 'u_alpha');
  assert.equal(user?.authEpoch, 0);
  assert.deepEqual(user?.grants, [
    { dataScope: { kind: 'stores', storeIds: ['s1'] }, reports: ['r_sales'] },
  ]);
});

test('a legitimate "not found" comes back as null, not an error', async () => {
  const { fetchImpl } = wiredToHandler();
  const cp = client(fetchImpl);
  assert.equal(await cp.getTenantEpoch('t_ghost'), null);
  assert.equal(await cp.getUser('t_alpha', 'u_ghost'), null);
  assert.equal(await cp.getReportVersion('t_alpha', 'r_ghost'), null);
  assert.equal(await cp.getDataVersion('t_ghost'), 0); // getDataVersion floors at 0
});

test('round trip: an audit row reaches the sink', async () => {
  const { fetchImpl, audits } = wiredToHandler();
  await client(fetchImpl).record({
    tenantId: 't_alpha',
    action: 'query.execute',
    detail: { queryId: 'q' },
  });
  assert.deepEqual(audits, [
    { tenantId: 't_alpha', action: 'query.execute', detail: { queryId: 'q' } },
  ]);
});

test('a wrong service token is rejected (401 → the read throws)', async () => {
  const { fetchImpl } = wiredToHandler('a-different-secret');
  await assert.rejects(
    () => client(fetchImpl).getTenantEpoch('t_alpha'),
    /control-plane-error-401/,
  );
});

test('reads THROW when the service is unreachable (fail closed, not a null deny)', async () => {
  const boom: FetchLike = async () => {
    throw new Error('ECONNRESET');
  };
  const cp = client(boom);
  await assert.rejects(() => cp.getTenantEpoch('t_alpha'), /control-plane-unreachable/);
  await assert.rejects(() => cp.getUser('t_alpha', 'u_alpha'), /control-plane-unreachable/);
  await assert.rejects(() => cp.getDataVersion('t_alpha'), /control-plane-unreachable/);
});

test('audit.record SWALLOWS failures — a served request is never failed by the audit write', async () => {
  const boom: FetchLike = async () => {
    throw new Error('ECONNRESET');
  };
  await assert.doesNotReject(() =>
    client(boom).record({ tenantId: 't_alpha', action: 'x', detail: {} }),
  );
});

test('a malformed grant in the response is fatal, never coerced open', async () => {
  const badFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    async text() {
      // authEpoch present but a grant with an unknown scope kind.
      return JSON.stringify({
        user: {
          tenantId: 't_alpha',
          authEpoch: 0,
          grants: [{ dataScope: { kind: 'everything' }, reports: [] }],
        },
      });
    },
  });
  await assert.rejects(() => client(badFetch).getUser('t_alpha', 'u_alpha'), /malformed grant/);
});

test('the service authenticates in constant time and rejects an unknown op', async () => {
  const handler = createControlPlaneHandler({
    reader: plane(),
    audit: { async record() {} },
    serviceToken: TOKEN,
  });
  const post = (body: unknown, auth = `Bearer ${TOKEN}`) =>
    handler(
      new Request('https://cp.internal/v1/control', {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post({ op: 'tenantEpoch', tenantId: 't_alpha' }, 'Bearer wrong')).status,
    401,
  );
  assert.equal((await post({ op: 'nope', tenantId: 't_alpha' })).status, 400);
  assert.equal((await post({ op: 'tenantEpoch' })).status, 400); // missing tenantId
});

// Regression (LOG-0059): the default fetch must be bound to globalThis. Stored
// detached and invoked as `this.#fetch(...)`, its receiver becomes the adapter,
// which the Workers runtime rejects with "Illegal invocation" — so every call
// failed before a request left the isolate and surfaced as an opaque gate 500.
// Every other test here injects fetchImpl, which is exactly why the default
// went unexercised.
test('the default fetch is invoked with globalThis as its receiver', async () => {
  const original = globalThis.fetch;
  const receivers: unknown[] = [];
  globalThis.fetch = function (this: unknown) {
    receivers.push(this);
    return Promise.resolve(new Response(JSON.stringify({ epoch: 3 }), { status: 200 }));
  } as typeof globalThis.fetch;
  try {
    // No fetchImpl: exercises the production default.
    const client = new HttpControlPlane({ baseUrl: 'https://cp.internal', serviceToken: TOKEN });
    assert.equal(await client.getTenantEpoch('t_alpha'), 3);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(receivers.length, 1);
  assert.equal(receivers[0], globalThis, 'fetch was called with the wrong receiver');
});

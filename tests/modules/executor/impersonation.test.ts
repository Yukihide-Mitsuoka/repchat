// The impersonating token provider over a fake fetch — no network, no
// credentials. The assertions cover the request we send to IAM Credentials and
// the fail-closed paths: a null ref passes through, a non-SA ref is refused,
// and an IAM denial surfaces as a throw (which the runner maps to a 500).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImpersonatingTokenProvider } from '../../../src/modules/executor/infrastructure/impersonation.ts';
import type { FetchLike } from '../../../src/modules/executor/infrastructure/bigquery.ts';

const SA = 't-alpha-reader@example-project.iam.gserviceaccount.com';

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeIam(
  response: unknown,
  opts: { ok?: boolean; status?: number; raw?: string } = {},
): { fetchImpl: FetchLike; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    captured.push({
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
      headers: init.headers,
    });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      async text() {
        return opts.raw ?? JSON.stringify(response);
      },
    };
  };
  return { fetchImpl, captured };
}

/** A source provider that hands back a fixed runtime token for null. */
const source = {
  async getToken(ref: string | null) {
    assert.equal(ref, null, 'source is asked for the runtime identity, never a ref');
    return 'runtime-token';
  },
};

test('mints and returns the impersonated access token', async () => {
  const { fetchImpl } = fakeIam({
    accessToken: 'minted-tenant-token',
    expireTime: '2026-01-01T00:05:00Z',
  });
  const p = new ImpersonatingTokenProvider({ source, fetchImpl });
  assert.equal(await p.getToken(SA), 'minted-tenant-token');
});

test('calls generateAccessToken for the SA, authorized by the runtime token', async () => {
  const { fetchImpl, captured } = fakeIam({ accessToken: 't' });
  await new ImpersonatingTokenProvider({ source, fetchImpl }).getToken(SA);
  const call = captured[0];
  // The SA email is URL-encoded into the path (@ -> %40), so assert on the
  // encoded form rather than the literal.
  const url = call?.url ?? '';
  assert.ok(url.endsWith(`/serviceAccounts/${encodeURIComponent(SA)}:generateAccessToken`), url);
  assert.equal(call?.headers['authorization'], 'Bearer runtime-token'); // impersonation is authorized by OUR identity
  assert.deepEqual(call?.body['scope'], ['https://www.googleapis.com/auth/bigquery']);
  assert.equal(call?.body['lifetime'], '300s');
});

test('lifetime and scopes are configurable', async () => {
  const { fetchImpl, captured } = fakeIam({ accessToken: 't' });
  await new ImpersonatingTokenProvider({
    source,
    fetchImpl,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    lifetimeSeconds: 900,
  }).getToken(SA);
  assert.deepEqual(captured[0]?.body['scope'], ['https://www.googleapis.com/auth/cloud-platform']);
  assert.equal(captured[0]?.body['lifetime'], '900s');
});

test('a null ref passes straight through as the runtime identity — no IAM call', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return {
      ok: true,
      status: 200,
      async text() {
        return '{}';
      },
    };
  };
  const p = new ImpersonatingTokenProvider({ source, fetchImpl });
  assert.equal(await p.getToken(null), 'runtime-token');
  assert.equal(called, false); // the fallback path never mints
});

test('refuses to impersonate a ref that is not a service-account email', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return {
      ok: true,
      status: 200,
      async text() {
        return '{}';
      },
    };
  };
  const p = new ImpersonatingTokenProvider({ source, fetchImpl });
  await assert.rejects(() => p.getToken('user@example.com'), /non-service-account ref/);
  await assert.rejects(() => p.getToken('t_alpha'), /non-service-account ref/);
  assert.equal(called, false); // refused before any token was minted
});

test('an IAM denial (missing tokenCreator) surfaces as a throw', async () => {
  const { fetchImpl } = fakeIam(
    { error: { message: 'permission denied' } },
    { ok: false, status: 403 },
  );
  const p = new ImpersonatingTokenProvider({ source, fetchImpl });
  await assert.rejects(() => p.getToken(SA), /impersonation denied .*\(HTTP 403\)/);
});

test('an unparsable or empty response is an error, not a silent empty token', async () => {
  const bad = new ImpersonatingTokenProvider({
    source,
    ...fakeIam(null, { raw: '<html>502</html>', status: 502 }),
  });
  await assert.rejects(() => bad.getToken(SA), /unparsable response/);
  const empty = new ImpersonatingTokenProvider({ source, ...fakeIam({ expireTime: 'x' }) });
  await assert.rejects(() => empty.getToken(SA), /no accessToken/);
});

test('a transport failure is wrapped, not thrown raw', async () => {
  const boom: FetchLike = async () => {
    throw new Error('ECONNRESET');
  };
  const p = new ImpersonatingTokenProvider({ source, fetchImpl: boom });
  await assert.rejects(() => p.getToken(SA), /impersonation request failed .* ECONNRESET/);
});

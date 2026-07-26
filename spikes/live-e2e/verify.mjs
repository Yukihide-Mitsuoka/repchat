// Phase 2: drive the DEPLOYED gate over real HTTP with real signed tokens.
//
// Everything here crosses the actual wire — Cloudflare Workers -> Cloud Run ->
// Neon (and BigQuery for the data path). Nothing is stubbed. This is the live
// counterpart to the in-process vertical slice (LOG-0031) and the fixture-based
// slice (LOG-0035).
//
//   GATE_URL=https://gate.example.workers.dev node spikes/live-e2e/verify.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
// Importing setup.mjs also loads .env into process.env (it does that at module
// scope; it does NOT seed — that is gated on being the entry point).
import { ALPHA, BRAVO, KID, SUBJECT } from './setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = (process.env['GATE_URL'] ?? '').replace(/\/$/, '');
if (!GATE) {
  console.error('GATE_URL is not set, e.g. https://gate.<subdomain>.workers.dev');
  process.exit(2);
}

// The ② result cache lives in Cloudflare KV, which outlives anything done to
// GCP — a `make destroy` + `make deploy` leaves it fully warm. A warm cache
// makes assertion 8 pass while the executor and BigQuery are never touched,
// which is exactly how a broken ② path can look identical to a healthy one
// (LOG-0060). So start every run from a cold cache, using the same lever
// production uses: the result-cache key is a function of data_version.
//
// Deliberately NOT done in `make deploy`: data_version means "this tenant's
// data changed". Bumping it on deploy would invalidate every tenant's cache on
// every release — wrong semantics and a real cost.
async function coolTheResultCache() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    // Fail rather than run warm: a green run that proved nothing is worse than
    // no run at all.
    console.error('DATABASE_URL is not set (put it in .env) — cannot guarantee a cold ② cache');
    process.exit(2);
  }
  const sql = postgres(databaseUrl.replace('-pooler.', '.'), { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`
      update datasources d set data_version = d.data_version + 1
      from tenants t
      where t.id = d.tenant_id and t.id in (${ALPHA}, ${BRAVO})
      returning t.name as tenant, d.data_version`;
    if (rows.length !== 2) {
      console.error(`expected 2 demo datasources, found ${rows.length} — run setup.mjs first`);
      process.exit(2);
    }
    console.log(
      `cold ② cache: ${rows.map((r) => `${r.tenant}@v${r.data_version}`).join(', ')}\n`,
    );
  } finally {
    await sql.end();
  }
}

await coolTheResultCache();

const { privateJwk } = JSON.parse(readFileSync(join(HERE, '.vendor-key.json'), 'utf8'));
const signingKey = await crypto.subtle.importKey(
  'jwk',
  privateJwk,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
);

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const jsonB64 = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Sign a token the way the vendor's backend would (ADR-0005 §7). */
async function mint(tenantId, over = {}) {
  const payload = {
    sub: SUBJECT,
    tenant_id: tenantId,
    sid: `sess-${tenantId.slice(0, 8)}`,
    aud: 'gate',
    epoch: 0,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...over,
  };
  const input = `${jsonB64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${jsonB64(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

const get = async (path, token) => {
  const res = await fetch(`${GATE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await res.text();
  return { status: res.status, body };
};

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

const alphaToken = await mint(ALPHA);
const bravoToken = await mint(BRAVO);

// --- ① shell: proves JWT verification, the control-plane HTTP transport, and
//     authz resolution out of Postgres under RLS.
const shell = await get('/r/r_e2e', alphaToken);
check('alpha gets the report shell', shell.status === 200, `[${shell.status}] ${shell.body.slice(0, 60)}`);

const shell2 = await get('/r/r_e2e', alphaToken);
check('shell is served again (① cache path)', shell2.status === 200, `[${shell2.status}]`);

// --- authorization denials
const forbidden = await get('/r/r_not_granted', alphaToken);
check('a report the role does not grant is refused', forbidden.status === 403 || forbidden.status === 404,
  `[${forbidden.status}]`);

const noToken = await get('/r/r_e2e');
check('no token is refused', noToken.status === 401, `[${noToken.status}]`);

const wrongAud = await get('/r/r_e2e', await mint(ALPHA, { aud: 'not-gate' }));
check('a token for another audience is refused', wrongAud.status === 401, `[${wrongAud.status}]`);

const expired = await get('/r/r_e2e', await mint(ALPHA, { exp: Math.floor(Date.now() / 1000) - 60 }));
check('an expired token is refused', expired.status === 401, `[${expired.status}]`);

// A token whose tenant claim does not match a real tenant must not resolve.
const ghost = await get('/r/r_e2e', await mint('00000000-0000-4000-8000-0000000000ff'));
check('an unknown tenant is refused', ghost.status === 401, `[${ghost.status}]`);

/** `cached` as the gate reported it, or null when the body is not what we expect. */
const cachedFlag = (res) => {
  try {
    const v = JSON.parse(res.body).cached;
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
};

// --- ② data: adds the executor and BigQuery to the path.
//
// `cached === false` is load-bearing, not cosmetic. Without it this assertion
// passes on a KV hit, claiming a path it never touched (LOG-0060).
const data = await get('/r/r_e2e/data/q_e2e', alphaToken);
const dataOk = data.status === 200 && cachedFlag(data) === false;
check('alpha gets query results (② path really reaches executor -> BigQuery)', dataOk,
  `[${data.status}] ${data.body.slice(0, 120)}`);

if (dataOk) {
  const second = await get('/r/r_e2e/data/q_e2e', alphaToken);
  // Now meaningful: the request above is known to have been a miss, so this
  // pins the miss→hit transition rather than two hits in a row.
  check('the second identical request is a ② cache hit', cachedFlag(second) === true,
    `[${second.status}]`);

  // The load-bearing one: same URL, same query, different tenant token.
  const bravoData = await get('/r/r_e2e/data/q_e2e', bravoToken);
  const differs = bravoData.status !== 200 || bravoData.body !== data.body;
  check('bravo never receives alpha rows (no cross-tenant leak)', differs,
    `[${bravoData.status}] ${bravoData.body.slice(0, 80)}`);
} else if (data.status !== 200) {
  console.log('\n  ② skipped its follow-ups: the data path did not return 200.');
  console.log('  Usual causes — QUERY_POLICY is still {"tables":[]} (fail-closed by design),');
  console.log('  or executor-run lacks tokenCreator on the tenant service accounts.');
  console.log('  The exact reason is in the audit log: select action, detail from audit_logs');
  console.log('  where action like \'query.%\' order by created_at desc.');
  console.log('  See spikes/live-e2e/README.md.');
} else {
  console.log('\n  ② returned 200 but from CACHE, so it proved nothing about the live path.');
  console.log('  data_version was bumped at start-up, so a hit here means the gate is not');
  console.log('  seeing the new value — check the control plane, not the executor.');
}

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

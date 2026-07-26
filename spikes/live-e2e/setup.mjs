// Phase 1 of the live end-to-end check: mint a vendor key pair and seed two
// demo tenants into the real control plane.
//
// Two phases are unavoidable: the gate can only verify a JWT once its public
// key is deployed in VENDOR_KEYS, so this prints the key for you to install
// before verify.mjs can sign anything.
//
//   node spikes/live-e2e/setup.mjs            # generate + seed
//   node spikes/live-e2e/setup.mjs --teardown # remove the seeded rows
//
// The PRIVATE key is written to a gitignored file next to this script. It only
// signs test tokens for these demo tenants, but it is still a signing key, so
// it never enters the repository (GR-001).
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(HERE, '.vendor-key.json');

// Fixed ids so re-running is idempotent and teardown is exact. Hex only —
// these go into a Postgres `uuid` column, so a mnemonic like "a1pha" does not
// parse.
export const ALPHA = 'e2e0a1fa-0000-4000-8000-000000000001';
export const BRAVO = 'e2e0b4a0-0000-4000-8000-000000000002';
export const KID = 'e2e-vendor';
export const SUBJECT = 'e2e-user';

for (const line of (() => {
  try {
    return readFileSync(join(HERE, '..', '..', '.env'), 'utf8').split('\n');
  } catch {
    return [];
  }
})()) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// Seeding is an owner operation: RLS deliberately stops app_runtime writing
// tenant rows, so the migration/ownership credential is the right one here.
// Opened lazily, because verify.mjs imports this module only for the ids and
// must not need a database to do so.
let pool;
function owner() {
  if (pool) return pool;
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set (put it in .env)');
    process.exit(2);
  }
  pool = postgres(url.replace('-pooler.', '.'), { max: 1, onnotice: () => {} });
  return pool;
}

/** Children first — the composite FKs refuse a tenant delete otherwise. */
async function cleanup() {
  for (const t of [
    'audit_logs',
    'revocation_events',
    'report_queries',
    'role_reports',
    'user_roles',
    'datasources',
    'reports',
    'roles',
    'users',
  ]) {
    await owner().unsafe(`delete from ${t} where tenant_id in ($1, $2)`, [ALPHA, BRAVO]);
  }
  await owner()`delete from tenants where id in (${ALPHA}, ${BRAVO})`;
  await owner()`delete from vendors where name = 'e2e-live'`;
}

async function seed() {
  await cleanup();
  const [v] = await owner()`insert into vendors (name) values ('e2e-live') returning id`;

  // Each tenant sees ONLY its own dataset, and only its own store. Bravo exists
  // purely so the cross-tenant assertions in verify.mjs have something to fail
  // against.
  for (const [id, slug, store] of [
    [ALPHA, 'alpha', 's1'],
    [BRAVO, 'bravo', 's9'],
  ]) {
    await owner()`insert into tenants (id, vendor_id, name, auth_epoch)
                values (${id}, ${v.id}, ${`e2e-${slug}`}, 0)`;
    const [u] = await owner()`insert into users (tenant_id, external_subject, auth_epoch)
                            values (${id}, ${SUBJECT}, 0) returning id`;
    const [r] = await owner()`insert into roles (tenant_id, name, data_scope)
                            values (${id}, 'manager', ${owner().json({ store_ids: [store] })})
                            returning id`;
    await owner()`insert into user_roles (tenant_id, user_id, role_id) values (${id}, ${u.id}, ${r.id})`;
    const [rep] = await owner()`insert into reports (tenant_id, slug, title, definition_ref, report_version)
                              values (${id}, 'r_e2e', 'E2E', 'ref', 1) returning id`;
    await owner()`insert into role_reports (tenant_id, role_id, report_id) values (${id}, ${r.id}, ${rep.id})`;
    await owner()`insert into report_queries (tenant_id, report_id, query_id, sql_text)
                values (${id}, ${rep.id}, 'q_e2e', 'SELECT category, SUM(amount) AS total FROM orders GROUP BY category')`;
    // Points at the LOG-0052 fixtures: dataset t_alpha / t_bravo, read as the
    // per-tenant service account (the D1 connection principal).
    await owner()`insert into datasources (tenant_id, type, dataset, project_id, connection_ref, data_version, status)
                values (${id}, 'bigquery', ${`t_${slug}`}, ${process.env['GOOGLE_CLOUD_PROJECT'] ?? 'unset'},
                        ${`t-${slug}-reader@${process.env['GOOGLE_CLOUD_PROJECT'] ?? 'unset'}.iam.gserviceaccount.com`},
                        1, 'active')`;
  }
}

async function makeVendorKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  writeFileSync(KEY_FILE, JSON.stringify({ kid: KID, publicJwk, privateJwk }), { mode: 0o600 });
  return publicJwk;
}

async function main() {
  if (process.argv.includes('--teardown')) {
    await cleanup();
    if (existsSync(KEY_FILE)) rmSync(KEY_FILE);
    console.log('torn down: demo tenants removed, vendor key deleted');
    return;
  }

  await seed();
  const publicJwk = await makeVendorKey();
  console.log('seeded: 2 demo tenants (e2e-alpha, e2e-bravo)\n');
  console.log('Set this as VENDOR_KEYS in wrangler.toml [vars], then `npx wrangler deploy`.');
  console.log('It is a PUBLIC key — safe to commit (GR-001 allows public keys):\n');
  console.log(`VENDOR_KEYS = '${JSON.stringify({ [KID]: publicJwk })}'\n`);
  console.log('Then: node spikes/live-e2e/verify.mjs');
}

// verify.mjs imports the ids and the kid from here, so seeding must NOT happen
// on import: it would re-mint the vendor key and invalidate the public half
// already deployed in VENDOR_KEYS. Only seed when run as the entry point.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((e) => {
      console.error('setup failed:', e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    })
    .finally(() => pool?.end());
}

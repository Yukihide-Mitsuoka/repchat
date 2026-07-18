// In-memory stand-in for the two data stores of 原則D:
//  - control plane (production: Postgres+RLS) — tenants/users/roles/reports/datasources
//  - analytics data (production: BigQuery per-tenant datasets) — cp.analytics[tenant]
// Shapes follow docs/system-design.md §3. Fixture: 2 tenants, t_alpha with an
// all-stores manager role + two store-1-scoped roles (to prove scope_hash sharing).
import { generateVendorKeyPair, signJwt } from './jwt.mjs';

export function makeControlPlane() {
  const { publicKey, privateKey } = generateVendorKeyPair();
  return {
    vendor: { id: 'v_1', kid: 'k1', publicKey },
    // The private key lives on the vendor's backend in production; kept here so
    // tests/bench can mint tokens the way the vendor would.
    vendorPrivateKey: privateKey,
    tenants: {
      t_alpha: { auth_epoch: 0 },
      t_bravo: { auth_epoch: 0 },
    },
    users: {
      alice: { tenant_id: 't_alpha', roles: ['manager'], auth_epoch: 0 },
      bob: { tenant_id: 't_alpha', roles: ['store1_staff'], auth_epoch: 0 },
      bev: { tenant_id: 't_alpha', roles: ['store1_viewer'], auth_epoch: 0 },
      boris: { tenant_id: 't_bravo', roles: ['manager'], auth_epoch: 0 },
    },
    roles: {
      t_alpha: {
        manager: { data_scope: {}, reports: ['r_sales'] },
        store1_staff: { data_scope: { store_id: 's1' }, reports: ['r_sales'] },
        // Different role, same effective data scope → must share cache (ADR §6)
        store1_viewer: { data_scope: { store_id: 's1' }, reports: ['r_sales'] },
      },
      t_bravo: {
        manager: { data_scope: {}, reports: ['r_sales'] },
      },
    },
    reports: {
      t_alpha: { r_sales: { report_version: 1 } },
      t_bravo: { r_sales: { report_version: 1 } },
    },
    datasources: {
      t_alpha: { data_version: 1 },
      t_bravo: { data_version: 1 },
    },
    // Per-tenant datasets — reaching into another tenant's rows is impossible by
    // construction, mirroring BigQuery per-tenant dataset isolation (原則C-3).
    analytics: {
      t_alpha: [
        { store_id: 's1', category: 'A', amount: 40000 },
        { store_id: 's1', category: 'B', amount: 25000 },
        { store_id: 's2', category: 'A', amount: 52900 },
        { store_id: 's2', category: 'C', amount: 30000 },
        { store_id: 's2', category: 'D', amount: 10000 },
      ],
      t_bravo: [
        { store_id: 's9', category: 'X', amount: 20000 },
        { store_id: 's9', category: 'Y', amount: 12000 },
        { store_id: 's9', category: 'Z', amount: 7500 },
      ],
    },
    revocation_events: [],
  };
}

// What the vendor backend does at embed time: mint a short-lived signed token.
// epoch snapshots tenant+user epochs so any later bump invalidates the token.
export function mintToken(cp, userId, { ttlSec = 300, aud = 'gate', tamper = {} } = {}) {
  const user = cp.users[userId];
  const payload = {
    sub: userId,
    tenant_id: user.tenant_id,
    sid: `sess_${userId}`,
    aud,
    epoch: cp.tenants[user.tenant_id].auth_epoch + user.auth_epoch,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    ...tamper,
  };
  return signJwt(payload, cp.vendorPrivateKey, { kid: cp.vendor.kid });
}

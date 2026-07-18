// Minimal ES256 JWT for the spike — stands in for the vendor-backend-signed
// short-lived embed token (ADR-0005 §7). Node built-ins only; production would
// use a vetted library (jose) — signing/verification semantics are identical.
import crypto from 'node:crypto';

const b64u = (input) =>
  Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString('base64url');

export function generateVendorKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

export function signJwt(payload, privateKey, { kid }) {
  const signingInput = `${b64u({ alg: 'ES256', typ: 'JWT', kid })}.${b64u(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${sig.toString('base64url')}`;
}

export function verifyJwt(token, publicKey, { aud, now = Date.now() }) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts;
  const valid = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(s, 'base64url'),
  );
  if (!valid) return { ok: false, reason: 'bad-signature' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now)
    return { ok: false, reason: 'expired' };
  if (aud && payload.aud !== aud) return { ok: false, reason: 'bad-aud' };
  return { ok: true, payload };
}

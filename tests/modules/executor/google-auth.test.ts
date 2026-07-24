// The ADC token provider is the dev/fallback identity, not an impersonator.
// Only its refusal path is unit-tested here: it throws before any network call,
// so no credentials are needed. The happy path resolves real ADC and is
// exercised by the live spikes, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdcTokenProvider } from '../../../src/modules/executor/infrastructure/google-auth.ts';

test('refuses a per-tenant credentialRef instead of silently using its own identity', async () => {
  // A non-null ref reaching this provider means the wiring failed to select the
  // impersonating provider. Serving the query under the runtime's own identity
  // would erase the D1 backstop, so it must fail closed (ADR-0010 D1/D6).
  const provider = new AdcTokenProvider();
  await assert.rejects(
    () => provider.getToken('t-alpha-reader@kotonoha-bi-dev.iam.gserviceaccount.com'),
    /cannot impersonate/,
  );
});

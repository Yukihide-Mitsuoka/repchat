// Per-tenant impersonation for the D1 connection principal (ADR-0010 D1).
//
// The runtime authenticates as its OWN identity (the `source` provider), then
// asks the IAM Credentials API for a short-lived token that acts AS the
// tenant's service account. No key material is ever downloaded or stored — the
// runtime only needs `roles/iam.serviceAccountTokenCreator` on each tenant SA
// (GR-001).
//
// This is what finally puts a data-layer backstop behind the ① tenant boundary
// for BigQuery: the minted token can read only what that SA was granted (its
// own dataset), so a bound query that somehow named another tenant's dataset is
// denied by BigQuery itself — not merely by our AST rewrite. It plays for the
// connected/hosted warehouse the role RLS plays for the control plane
// (ADR-0005 §9.2, and the gap LOG-0040 named).
//
// Fetch-based against one REST endpoint, deliberately, for the same reason the
// BigQuery runner is: pulling the full auth client for one call would be the
// wrong dependency to own here.
import type { AccessTokenProvider, FetchLike } from './bigquery.ts';

const IAM_CREDENTIALS = 'https://iamcredentials.googleapis.com/v1';
const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery';
/** A GCP service-account email — the only shape we will impersonate. */
const SA_EMAIL = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

export interface ImpersonatingTokenProviderOptions {
  /** Mints the runtime's own token — the identity permitted to impersonate. */
  readonly source: AccessTokenProvider;
  readonly fetchImpl?: FetchLike;
  readonly scopes?: readonly string[];
  /** Lifetime of the minted token in seconds; IAM caps this at 3600. */
  readonly lifetimeSeconds?: number;
}

interface GenerateAccessTokenResponse {
  accessToken?: string;
  expireTime?: string;
}

/**
 * `AccessTokenProvider` that impersonates a per-tenant service account. Wraps a
 * `source` provider (typically `AdcTokenProvider`) and can stand in for it: a
 * `null` credentialRef is passed straight through as the runtime's own identity
 * (the dev/fallback path), so this is the single provider to wire in
 * production.
 */
export class ImpersonatingTokenProvider implements AccessTokenProvider {
  readonly #source: AccessTokenProvider;
  readonly #fetch: FetchLike;
  readonly #scopes: readonly string[];
  readonly #lifetime: number;

  constructor(o: ImpersonatingTokenProviderOptions) {
    this.#source = o.source;
    // Bound for the same reason as the gate's HTTP adapters (LOG-0059). Node
    // tolerates a detached fetch, so this is not a live defect here — it keeps
    // the pattern uniform so the Workers-fatal version cannot reappear.
    this.#fetch = o.fetchImpl ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
    this.#scopes = o.scopes ?? [BIGQUERY_SCOPE];
    this.#lifetime = o.lifetimeSeconds ?? 300;
  }

  async getToken(credentialRef: string | null): Promise<string> {
    // null = the runtime's own identity (dev/fallback). No impersonation, and
    // therefore no per-tenant backstop — the caller opted into that by passing
    // null, and TenantDataset makes that an explicit choice, never a default.
    if (credentialRef === null) return this.#source.getToken(null);
    // Refuse to impersonate anything that is not a service-account email. The
    // ref is server-resolved, but a corrupt control-plane value must fail
    // closed, not become an attempt to mint a token for an arbitrary principal.
    if (!SA_EMAIL.test(credentialRef))
      throw new Error(`refusing to impersonate a non-service-account ref: ${credentialRef}`);

    const sourceToken = await this.#source.getToken(null);
    const url = `${IAM_CREDENTIALS}/projects/-/serviceAccounts/${encodeURIComponent(
      credentialRef,
    )}:generateAccessToken`;

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.#fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sourceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scope: [...this.#scopes], lifetime: `${this.#lifetime}s` }),
      });
    } catch (e) {
      throw new Error(
        `impersonation request failed for ${credentialRef}: ${
          e instanceof Error ? e.message : 'unknown error'
        }`,
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      // The runtime lacks tokenCreator on this SA, or the SA does not exist.
      // An operator problem — the BigQuery runner maps a getToken throw to a
      // 500 with an opaque reason, keeping this off the end user.
      throw new Error(`impersonation denied for ${credentialRef} (HTTP ${res.status})`);
    }

    let parsed: GenerateAccessTokenResponse;
    try {
      parsed = JSON.parse(raw) as GenerateAccessTokenResponse;
    } catch {
      throw new Error(`impersonation returned an unparsable response (HTTP ${res.status})`);
    }
    if (!parsed.accessToken)
      throw new Error(`impersonation returned no accessToken for ${credentialRef}`);
    return parsed.accessToken;
  }
}

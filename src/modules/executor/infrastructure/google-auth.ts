// Application Default Credentials token source for the BigQuery runner.
// Isolated in its own file so the runner itself stays dependency-free and
// testable with an injected token provider.
import { GoogleAuth } from 'google-auth-library';
import type { AccessTokenProvider } from './bigquery.ts';

const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery';

/**
 * Resolves credentials the standard GCP way: `gcloud auth
 * application-default login` locally, the attached service account in Cloud
 * Run. Nothing is read from the repo (GR-001).
 */
export class AdcTokenProvider implements AccessTokenProvider {
  readonly #auth: GoogleAuth;

  constructor(scopes: readonly string[] = [BIGQUERY_SCOPE]) {
    this.#auth = new GoogleAuth({ scopes: [...scopes] });
  }

  /**
   * Returns the runtime's own ADC token. `credentialRef` is ignored: this
   * provider does not impersonate — it is the dev/fallback identity. Per-tenant
   * impersonation (D1) is a separate adapter (ImpersonatingTokenProvider), so a
   * non-null ref reaching here means the wiring forgot to select it. Refuse,
   * rather than silently serving every tenant under one identity.
   */
  async getToken(credentialRef: string | null): Promise<string> {
    if (credentialRef !== null)
      throw new Error(
        `AdcTokenProvider cannot impersonate ${credentialRef}; wire the impersonating provider`,
      );
    const client = await this.#auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('no access token returned by ADC');
    return token;
  }

  /** The project ADC resolved to — handy for wiring, not used for authz. */
  async projectId(): Promise<string> {
    return this.#auth.getProjectId();
  }
}

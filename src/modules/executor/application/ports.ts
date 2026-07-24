// Ports the executor needs from outside (ARC-002: dependencies point inward).
// Two implementations are expected (ARC-005): the BigQuery adapter and the
// in-memory adapter that backs tests and local runs.
import type { QueryPolicy, TenantId } from '../domain/types.ts';

/** A named query parameter value. Values are never interpolated into SQL. */
export type ParamValue = string | number | boolean;

/**
 * Runs already-bound SQL. Implementations MUST pass `params` as native query
 * parameters — string interpolation here would undo the AST binding.
 */
export interface QueryRunner {
  run(
    sql: string,
    params: Readonly<Record<string, ParamValue>>,
    identity: QueryIdentity,
  ): Promise<
    | { readonly ok: true; readonly rows: readonly unknown[] }
    | { readonly ok: false; readonly reason: string }
  >;
}

/**
 * Who the query runs AS and where — the ADR-0010 D1 connection principal. Both
 * fields are resolved server-side from tenantId (they ride in TenantDataset),
 * never from the caller, exactly like the dataset (原則E). This is what makes
 * the source-side backstop possible: even if bindQuery breaks and names another
 * tenant's dataset, a per-tenant `credentialRef` has no access to it, so the
 * warehouse denies the query (the ③ role that per-tenant datasets/RLS play for
 * the control plane — ADR-0005 §9.2).
 */
export interface QueryIdentity {
  /** The GCP project the query bills to and runs in. */
  readonly projectId: string;
  /**
   * The per-tenant identity to authenticate as, interpreted by the token
   * provider (for impersonation: the service account to impersonate). `null`
   * means "the provider's own identity" — the dev/fallback path, NOT a
   * per-tenant principal, so it carries no source-side backstop.
   */
  readonly credentialRef: string | null;
}

/**
 * Where a tenant's data physically lives — the ① tenant boundary (原則E①) — and
 * who reaches it (D1 connection principal). Infrastructure facts only: no row
 * scope here, because that is authorization (原則E②) and is supplied per call by
 * the layer that derived it from roles. `projectId`/`credentialRef` are
 * required, not optional: an omitted identity must be a compile error, never a
 * silent fall-back to a shared credential (the ADR-0010 D6 discipline, same as
 * TableRule.scopeColumn). Hosted vs connected is which values these hold, not
 * code (ADR-0005 §9.2).
 */
export interface TenantDataset {
  readonly tenantId: TenantId;
  readonly dataset: string;
  readonly projectId: string;
  readonly credentialRef: string | null;
}

/** Where a tenant's queryable surface comes from (control plane, 原則D). */
export interface BindingResolver {
  resolve(tenantId: TenantId): Promise<TenantDataset | null>;
  policyFor(tenantId: TenantId): Promise<QueryPolicy>;
}

/**
 * Resolves a report's query id to its SQL text (control plane, ADR-0005 §5).
 * The caller never supplies SQL: both transports pass a queryId, so the stored
 * report definition is the only source of the statement that gets bound.
 */
export interface QueryCatalog {
  sqlFor(tenantId: TenantId, queryId: string): Promise<string | null>;
}

export interface AuditSink {
  record(event: {
    readonly tenantId: TenantId;
    readonly action: string;
    readonly detail: Readonly<Record<string, string>>;
  }): Promise<void>;
}

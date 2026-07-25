-- D1 connection identity on the datasource (ADR-0010 D1, wiring PR-3).
--
-- The executor's QueryIdentity has two fields, both resolved server-side from
-- the tenant's datasource row (never the caller): the GCP project the query
-- runs in, and the per-tenant credential to run AS. Before this, project_id was
-- injected as one host-wide value (COD-051, fine while there was one datasource
-- shape) and connection_ref was an unused Secret Manager reference.
--
-- Under impersonation (ADR-0010 D1, PR-2) there is no stored secret, so
-- connection_ref changes meaning: it holds the service-account email to
-- impersonate, and NULL means "the runtime's own identity" (the dev/hosted
-- fallback with no per-tenant SA). That fallback is why it must become nullable.

-- project_id: added in three safe steps so it works whether or not dev rows
-- already exist. New rows must specify it (no default) — an omitted project is
-- a write error, not a silent fall-back (the ADR-0010 D6 discipline).
alter table datasources add column project_id text;
update datasources set project_id = 'example-project' where project_id is null;
alter table datasources alter column project_id set not null;

-- connection_ref: no longer a required Secret Manager ref. NULL = own identity.
alter table datasources alter column connection_ref drop not null;

comment on column datasources.project_id is
  'D1 QueryIdentity.projectId — the GCP project the query runs in.';
comment on column datasources.connection_ref is
  'D1 QueryIdentity.credentialRef — for BigQuery impersonation, the service-account '
  'email to impersonate; NULL = the runtime''s own identity (dev/hosted fallback).';

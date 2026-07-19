-- RLS policies + the app connection role (system-design.md §3.3).
--
-- app_runtime is a NON-superuser, NON-owner login role, because superusers and
-- the table owner bypass RLS by default. FORCE ROW LEVEL SECURITY additionally
-- subjects the owner; the true test principal is still app_runtime. No password
-- here (GR-001) — the spike container runs with trust auth on localhost only.

create role app_runtime login;

do $$
declare
  t   text;
  col text;
begin
  foreach t in array array['tenants', 'users', 'roles', 'user_roles'] loop
    col := case when t = 'tenants' then 'id' else 'tenant_id' end;
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- USING filters reads; WITH CHECK blocks writing a row into another tenant.
    -- current_setting(..., true) returns NULL when unset → fail-closed (no rows).
    execute format(
      $p$create policy tenant_isolation on %I
           using (%I = current_setting('app.tenant_id', true)::uuid)
           with check (%I = current_setting('app.tenant_id', true)::uuid)$p$,
      t, col, col
    );
    execute format('grant select, insert, update, delete on %I to app_runtime', t);
  end loop;
end $$;

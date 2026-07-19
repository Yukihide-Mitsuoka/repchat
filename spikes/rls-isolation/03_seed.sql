-- Two tenants, one user + one role each. Seeded as the superuser (bypasses RLS),
-- so both tenants' rows land; the app_runtime checks in run.sh then prove a
-- tenant can only ever see/write its own. Fixed UUIDs keep assertions exact.

insert into tenants (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'alpha'),
  ('22222222-2222-2222-2222-222222222222', 'bravo');

insert into users (id, tenant_id, email) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a@alpha'),
  ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b@bravo');

insert into roles (id, tenant_id, name) values
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('d2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'manager');

insert into user_roles (tenant_id, user_id, role_id) values
  ('11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'd2222222-2222-2222-2222-222222222222');

-- RLS isolation spike — a representative control-plane subset from
-- docs/system-design.md §3.2. NOT the production migration (that ships with the
-- control-plane module against Neon); this exists only to prove the ADR-0005
-- §3 "RLS is the last-resort backstop" claim empirically on a real Postgres.
--
-- Composite (tenant_id, id) uniques + FKs make a cross-tenant reference
-- unrepresentable at the DB level (system-design §3 rule 2); the RLS policies
-- (02_rls.sql) make a forgotten WHERE clause non-leaking (rule 1).

create table tenants (
  id         uuid primary key,
  name       text not null,
  auth_epoch bigint not null default 0
);

create table users (
  id        uuid primary key,
  tenant_id uuid not null references tenants (id),
  email     text,
  unique (tenant_id, id)
);

create table roles (
  id        uuid primary key,
  tenant_id uuid not null references tenants (id),
  name      text not null,
  unique (tenant_id, id)
);

create table user_roles (
  tenant_id uuid not null,
  user_id   uuid not null,
  role_id   uuid not null,
  primary key (user_id, role_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id),
  foreign key (tenant_id, role_id) references roles (tenant_id, id)
);

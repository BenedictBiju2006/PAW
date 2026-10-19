-- Local integration database only: minimal Supabase auth contract for RLS tests.
create role service_role nologin bypassrls;
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'local-paw-test-only';
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to service_role;
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

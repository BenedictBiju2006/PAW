-- Local browser test backend only. Supabase Auth owns and migrates auth.users.
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'local-paw-test-only';
create role supabase_auth_admin login password 'local-paw-auth-test-only' noinherit createrole;
grant anon, authenticated to authenticator;
create schema auth authorization supabase_auth_admin;
create schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
alter role supabase_auth_admin set search_path = auth, public, extensions;
grant usage on schema public, extensions to supabase_auth_admin;
grant all on schema auth to supabase_auth_admin;
grant usage on schema public, auth to anon, authenticated;

-- Match hosted Supabase's auth.uid() for modern PostgREST JWT claim settings.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

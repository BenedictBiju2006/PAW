-- Forward only: retain existing ciphertext and its OpenAI authenticated data.
begin;
alter table public.provider_settings drop constraint provider_settings_pkey;
alter table public.provider_settings drop constraint provider_settings_provider_check;
alter table public.provider_settings add primary key(user_id,provider);
alter table public.provider_settings add check(provider in ('openai','google','groq'));
create table public.ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check(provider in ('openai','google','groq')),
  model text not null
);
alter table public.ai_preferences enable row level security;
revoke all on public.ai_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.ai_preferences to service_role;
insert into public.ai_preferences(user_id,provider,model)
  select user_id,provider,model from public.provider_settings;
-- No credential FK: removing an active key must not trigger a silent fallback.
alter table public.agent_turns add column model_requests integer not null default 0 check(model_requests >= 0);
alter table public.agent_turns add column tool_calls integer not null default 0 check(tool_calls >= 0);
alter table public.agent_turns add column cached_input_tokens integer check(cached_input_tokens >= 0);
create function public.record_turn_diagnostics(actor uuid, turn uuid, requests integer, calls integer, cached integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
 update public.agent_turns t set model_requests = requests,tool_calls = calls,cached_input_tokens = cached
 where t.id = turn and t.user_id = actor and exists(select 1 from public.workspaces w where w.id = t.workspace_id and w.user_id = actor);
end;
$$;
revoke all on function public.record_turn_diagnostics(uuid,uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.record_turn_diagnostics(uuid,uuid,integer,integer,integer) to service_role;
commit;

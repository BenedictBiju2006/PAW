-- Forward-only Milestone 3: credentials, idempotent turns and trusted messages.
create table public.provider_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check(provider = 'openai'),
  model text not null,
  credential jsonb not null,
  token_warning integer not null default 100000 check(token_warning between 1000 and 100000000),
  updated_at timestamptz not null default now()
);
alter table public.provider_settings enable row level security;
revoke all on public.provider_settings from public,anon,authenticated;
grant select,insert,update,delete on public.provider_settings to service_role;

create table public.agent_turns (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  conversation_id uuid not null,
  request_hash text not null,
  status text not null default 'running' check(status in ('running','completed','failed','cancelled','limited','interrupted')),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check(input_tokens >= 0),
  output_tokens integer not null default 0 check(output_tokens >= 0),
  notice text,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id) on delete cascade
);
create unique index agent_one_active_turn on public.agent_turns(conversation_id) where status = 'running';
create index agent_turns_owner on public.agent_turns(user_id,created_at desc);
alter table public.agent_turns enable row level security;
create policy turn_read on public.agent_turns for select to authenticated using(user_id = (select auth.uid()) and public.owns_workspace(workspace_id));
revoke all on public.agent_turns from public,anon,authenticated;
grant select on public.agent_turns to authenticated;
grant select,update on public.agent_turns to service_role;

alter table public.messages add column turn_id uuid references public.agent_turns(id) on delete cascade;
alter table public.messages add column event_key text;
alter table public.messages add column trusted boolean not null default false;
create unique index message_turn_event on public.messages(turn_id,event_key) where turn_id is not null;
-- Existing transcripts remain intact but are never trusted as instructions.
drop policy message_append on public.messages;
create policy message_append_user on public.messages for insert to authenticated with check(
  public.owns_workspace(workspace_id) and role = 'user' and not trusted
  and turn_id is null and event_key is null and metadata = '{}'::jsonb
  and jsonb_array_length(content) = 1 and content->0->>'type' = 'text'
);
-- A privileged client cannot accidentally bypass the narrow RPC persistence path.
revoke insert,update,delete on public.messages from service_role;

create function public.start_agent_turn(actor uuid, turn uuid, workspace uuid, conversation uuid, request_hash text, user_text text, model_provider text, model_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.agent_turns; result public.agent_turns;
begin
  if not exists(select 1 from public.workspaces where id = workspace and user_id = actor) then raise exception 'Workspace not found'; end if;
  perform 1 from public.conversations where id = conversation and workspace_id = workspace for update;
  if not found then raise exception 'Conversation not found'; end if;
  select * into existing from public.agent_turns where id = turn;
  if found then
    if existing.user_id <> actor or existing.workspace_id <> workspace or existing.conversation_id <> conversation or existing.request_hash <> start_agent_turn.request_hash then raise exception 'Turn identifier conflict'; end if;
    return jsonb_build_object('started',false,'turn',to_jsonb(existing));
  end if;
  if length(user_text) not between 1 and 50000 then raise exception 'Invalid user message'; end if;
  update public.agent_turns set status = 'interrupted',finished_at = now(),notice = 'Execution was interrupted. Completed operations are preserved; this turn will not be replayed.' where conversation_id = conversation and status = 'running' and created_at < now() - interval '10 minutes';
  if exists(select 1 from public.agent_turns where conversation_id = conversation and status = 'running') then raise exception 'A response is already running in this conversation'; end if;
  insert into public.agent_turns(id,user_id,workspace_id,conversation_id,request_hash,provider,model) values(turn,actor,workspace,conversation,start_agent_turn.request_hash,model_provider,model_id) returning * into result;
  insert into public.messages(workspace_id,conversation_id,role,content,turn_id,event_key,trusted)
    values(workspace,conversation,'user',jsonb_build_array(jsonb_build_object('type','text','text',user_text)),turn,'user',true);
  return jsonb_build_object('started',true,'turn',to_jsonb(result));
end;
$$;
create function public.append_agent_event(actor uuid, turn uuid, event text, message_role text, blocks jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare target public.agent_turns; inserted integer;
begin
  select t.* into target from public.agent_turns t join public.workspaces w on w.id = t.workspace_id where t.id = turn and t.user_id = actor and w.user_id = actor for update of t;
  if not found then raise exception 'Turn not found'; end if;
  if target.status <> 'running' or message_role not in ('assistant','tool') or length(event) > 200 then raise exception 'Invalid agent event'; end if;
  insert into public.messages(workspace_id,conversation_id,role,content,metadata,turn_id,event_key,trusted)
    values(target.workspace_id,target.conversation_id,message_role,blocks,jsonb_build_object('provider',target.provider,'model',target.model),turn,event,true)
    on conflict(turn_id,event_key) where turn_id is not null do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;
create function public.finish_agent_turn(actor uuid, turn uuid, final_status text, input_count integer, output_count integer, explanation text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if final_status not in ('completed','failed','cancelled','limited') then raise exception 'Invalid turn status'; end if;
  update public.agent_turns t set status = final_status, input_tokens = input_count,output_tokens = output_count,notice = left(explanation,2000),finished_at = now()
    where t.id = turn and t.user_id = actor and t.status = 'running' and exists(select 1 from public.workspaces w where w.id = t.workspace_id and w.user_id = actor);
end;
$$;
revoke all on function public.start_agent_turn(uuid,uuid,uuid,uuid,text,text,text,text),public.append_agent_event(uuid,uuid,text,text,jsonb),public.finish_agent_turn(uuid,uuid,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.start_agent_turn(uuid,uuid,uuid,uuid,text,text,text,text),public.append_agent_event(uuid,uuid,text,text,jsonb),public.finish_agent_turn(uuid,uuid,text,integer,integer,text) to service_role;

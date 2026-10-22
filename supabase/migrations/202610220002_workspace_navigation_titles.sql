-- Milestone 3.2. Historical conversations keep their titles and timestamps.
begin;
alter table public.conversations
  add column title_origin text not null default 'manual' check (title_origin in ('default','generated','fallback','manual')),
  add column title_attempted boolean not null default true,
  add column title_revision bigint not null default 0;
alter table public.conversations alter column title_origin set default 'default';
alter table public.conversations alter column title_attempted set default false;
create index conversations_recent_activity on public.conversations(workspace_id,updated_at desc,id);

create function public.guard_conversation_title() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres','service_role') then
    if tg_op = 'INSERT' then
      new.title_origin := case when new.title = 'New conversation' then 'default' else 'manual' end;
      new.title_attempted := new.title_origin <> 'default';
      new.title_revision := 0;
    else
      -- This trigger runs only when a title column is targeted, including a
      -- manual rename to the same text. Message activity does not mark it manual.
      new.title_origin := 'manual';
      new.title_attempted := true;
      new.title_revision := old.title_revision + 1;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_conversation_title_insert before insert on public.conversations
  for each row execute function public.guard_conversation_title();
create trigger guard_conversation_title_update before update of title,title_origin,title_attempted,title_revision on public.conversations
  for each row execute function public.guard_conversation_title();

create function public.claim_conversation_title(actor uuid, workspace uuid, conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.conversations; first_text text;
begin
  if not exists(select 1 from public.workspaces where id=workspace and user_id=actor) then raise exception 'Workspace not found'; end if;
  select * into target from public.conversations where id=conversation and workspace_id=workspace for update;
  if not found then raise exception 'Conversation not found'; end if;
  if target.title_origin <> 'default' or target.title_attempted then return null; end if;
  select left(content->0->>'text',1200) into first_text from public.messages
    where workspace_id=workspace and conversation_id=conversation and role='user'
      and length(btrim(content->0->>'text')) > 0 order by sequence limit 1;
  if first_text is null then return null; end if;
  update public.conversations set title_attempted=true where id=conversation and workspace_id=workspace;
  return jsonb_build_object('text',first_text,'revision',target.title_revision);
end;
$$;
create function public.complete_conversation_title(actor uuid, workspace uuid, conversation uuid, expected_revision bigint, new_title text, generated boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result public.conversations;
begin
  if not exists(select 1 from public.workspaces where id=workspace and user_id=actor) then raise exception 'Workspace not found'; end if;
  if length(btrim(new_title)) not between 1 and 100 then raise exception 'Invalid title'; end if;
  update public.conversations set title=btrim(new_title), title_origin=case when generated then 'generated' else 'fallback' end, title_revision=title_revision+1
    where id=conversation and workspace_id=workspace and title_origin='default' and title_attempted and title_revision=expected_revision returning * into result;
  if not found then return null; end if;
  return to_jsonb(result);
end;
$$;
revoke all on function public.claim_conversation_title(uuid,uuid,uuid),public.complete_conversation_title(uuid,uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_conversation_title(uuid,uuid,uuid),public.complete_conversation_title(uuid,uuid,uuid,bigint,text,boolean) to service_role;
commit;

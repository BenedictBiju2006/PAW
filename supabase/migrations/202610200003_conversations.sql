grant select,insert on public.messages to authenticated;
grant usage,select on sequence public.messages_sequence_seq to authenticated;
create function public.guard_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.created_at <> old.created_at then
    raise exception 'Conversation identity is immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger guard_conversation before update on public.conversations for each row execute function public.guard_conversation();
create function public.touch_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.conversations set updated_at = clock_timestamp() where id = new.conversation_id and workspace_id = new.workspace_id;
  return new;
end;
$$;
create trigger touch_conversation after insert on public.messages for each row execute function public.touch_conversation();

-- Keep malformed direct client inserts from corrupting renderable history.
create function public.validate_message() returns trigger
language plpgsql set search_path = '' as $$
declare block jsonb; kind text; prop text;
begin
  for block in select value from jsonb_array_elements(new.content) loop
    if jsonb_typeof(block) is distinct from 'object' then raise exception 'Invalid message block'; end if;
    kind := block->>'type';
    if kind = 'text' then
      if jsonb_typeof(block->'text') is distinct from 'string' or length(block->>'text') not between 1 and 50000
        or exists(select 1 from jsonb_object_keys(block) k where k not in ('type','text')) then raise exception 'Invalid text block'; end if;
    elsif kind in ('tool_call','tool_result') then
      if jsonb_typeof(block->'toolId') is distinct from 'string' or length(block->>'toolId') not between 1 and 100
        or jsonb_typeof(block->'invocationId') is distinct from 'string' or length(block->>'invocationId') not between 1 and 100 then raise exception 'Invalid tool reference'; end if;
      if kind = 'tool_call' then
        if jsonb_typeof(block->'arguments') is distinct from 'object' or block->>'status' is null
          or block->>'status' not in ('pending','running','completed','failed','awaiting_confirmation')
          or exists(select 1 from jsonb_object_keys(block) k where k not in ('type','toolId','invocationId','arguments','status')) then raise exception 'Invalid tool call'; end if;
      else
        if not (block ? 'result') or jsonb_typeof(block->'isError') is distinct from 'boolean'
          or exists(select 1 from jsonb_object_keys(block) k where k not in ('type','toolId','invocationId','result','isError')) then raise exception 'Invalid tool result'; end if;
      end if;
    else raise exception 'Unsupported message block'; end if;
  end loop;
  for prop in select jsonb_object_keys(new.metadata) loop
    if prop not in ('provider','model','invocationId') or jsonb_typeof(new.metadata->prop) <> 'string'
      or length(new.metadata->>prop) > (case when prop = 'model' then 200 else 100 end) then raise exception 'Invalid message metadata'; end if;
  end loop;
  return new;
end;
$$;
create trigger validate_message before insert on public.messages for each row execute function public.validate_message();

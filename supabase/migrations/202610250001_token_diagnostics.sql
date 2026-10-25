-- Numeric diagnostics only; preserve all turns and the original execution journal.
begin;
alter table public.agent_turns add column request_diagnostics jsonb not null default '[]'::jsonb
  check (jsonb_typeof(request_diagnostics) = 'array' and jsonb_array_length(request_diagnostics) <= 40);
create function public.record_model_request(
  actor uuid, turn uuid, request_no integer, request_status text,
  input_count integer, output_count integer, cached_count integer,
  cumulative_input integer, cumulative_output integer,
  system_chars integer, history_chars integer, tools_chars integer, exchange_chars integer
) returns void language plpgsql security definer set search_path = '' as $$
declare target public.agent_turns;
begin
  select t.* into target from public.agent_turns t join public.workspaces w on w.id = t.workspace_id
    where t.id = turn and t.user_id = actor and w.user_id = actor for update of t;
  if not found then raise exception 'Turn not found'; end if;
  if target.status <> 'running' or request_no is null or request_no not between 1 and 40
    or request_no > jsonb_array_length(target.request_diagnostics) + 1
    or request_status is null or request_status not in ('completed','incomplete')
    or input_count < 0 or output_count < 0 or cached_count < 0
    or cumulative_input is null or cumulative_input < 0 or cumulative_output is null or cumulative_output < 0
    or system_chars is null or system_chars < 0 or history_chars is null or history_chars < 0
    or tools_chars is null or tools_chars < 0 or exchange_chars is null or exchange_chars < 0
  then raise exception 'Invalid model request diagnostic'; end if;
  update public.agent_turns set request_diagnostics = jsonb_set(target.request_diagnostics,
    array[(request_no - 1)::text], jsonb_build_object(
      'request', request_no, 'provider', target.provider, 'model', target.model,
      'status', request_status, 'inputTokens', input_count, 'outputTokens', output_count,
      'cachedInputTokens', cached_count, 'cumulativeInputTokens', cumulative_input,
      'cumulativeOutputTokens', cumulative_output,
      'contextCharacters', jsonb_build_object('system',system_chars,'history',history_chars,'tools',tools_chars,'exchanges',exchange_chars)
    ), true) where id = turn;
end;
$$;
revoke all on function public.record_model_request(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.record_model_request(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,integer,integer,integer) to service_role;
commit;

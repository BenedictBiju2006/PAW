-- Additive numeric diagnostics; original messages and existing RPC remain intact.
begin;
create function public.record_model_request_compaction(
  actor uuid, turn uuid, request_no integer, request_status text,
  input_count integer, output_count integer, cached_count integer,
  cumulative_input integer, cumulative_output integer,
  system_chars integer, history_chars integer, tools_chars integer, exchange_chars integer,
  raw_exchange_chars integer, sent_exchange_chars integer, exchanges_compacted integer, characters_saved integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if raw_exchange_chars is null or sent_exchange_chars is null or exchanges_compacted is null or characters_saved is null
    or raw_exchange_chars < 0 or sent_exchange_chars < 0 or exchanges_compacted < 0 or characters_saved < 0
    or sent_exchange_chars > raw_exchange_chars or characters_saved <> raw_exchange_chars - sent_exchange_chars
  then raise exception 'Invalid compaction diagnostic'; end if;
  perform public.record_model_request(actor,turn,request_no,request_status,input_count,output_count,cached_count,
    cumulative_input,cumulative_output,system_chars,history_chars,tools_chars,exchange_chars);
  -- The existing function checks actor/ownership, running status and locks the row.
  update public.agent_turns set request_diagnostics = jsonb_set(request_diagnostics,
    array[(request_no - 1)::text,'compaction'],jsonb_build_object(
      'rawExchangeCharacters',raw_exchange_chars,'sentExchangeCharacters',sent_exchange_chars,
      'exchangesCompacted',exchanges_compacted,'charactersSaved',characters_saved),true)
    where id = turn and user_id = actor;
end;
$$;
revoke all on function public.record_model_request_compaction(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.record_model_request_compaction(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer) to service_role;
commit;

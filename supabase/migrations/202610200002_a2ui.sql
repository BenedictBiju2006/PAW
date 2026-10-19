-- Forward-only A2UI support. The original migration and revision JSON are untouched.
alter function public.validate_interface(jsonb, uuid) rename to validate_legacy_interface;

create function public.a2ui_dynamic(value jsonb, kind text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(value) = kind or
    (jsonb_typeof(value) = 'object' and value ? 'path' and jsonb_typeof(value->'path') = 'string'
      and (select count(*) from jsonb_object_keys(value)) = 1), false);
$$;
create function public.a2ui_children(component jsonb) returns setof text
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if component ? 'child' then return next component->>'child'; end if;
  if jsonb_typeof(component->'children') = 'array' then
    for item in select value from jsonb_array_elements(component->'children') loop return next item #>> '{}'; end loop;
  elsif jsonb_typeof(component->'children') = 'object' then
    return next component->'children'->>'componentId';
  end if;
  if component ? 'tabs' then
    for item in select value from jsonb_array_elements(component->'tabs') loop return next item->>'child'; end loop;
  end if;
end;
$$;

create function public.validate_a2ui_component(c jsonb, target uuid) returns void
language plpgsql set search_path = '' as $$
declare kind text := c->>'component'; allowed text[]; required text[]; prop text; tab jsonb; field_list jsonb; child jsonb;
begin
  if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'id') is distinct from 'string'
    or (c->>'id') !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' then raise exception 'Invalid A2UI component ID'; end if;
  case kind
    when 'Text' then allowed := array['text','variant']; required := array['text'];
    when 'Row', 'Column' then allowed := array['children','align','justify']; required := array['children'];
    when 'List' then allowed := array['children','align','direction']; required := array['children'];
    when 'Card' then allowed := array['child']; required := array['child'];
    when 'Button' then allowed := array['child','variant','action','checks']; required := array['child','action'];
    when 'TextField' then allowed := array['label','value','variant','checks','validationRegexp']; required := array['label'];
    when 'CheckBox' then allowed := array['label','value','checks']; required := array['label','value'];
    when 'Tabs' then allowed := array['tabs']; required := array['tabs'];
    when 'Divider' then allowed := array['axis']; required := '{}';
    when 'CollectionForm' then allowed := array['collectionId','title']; required := array['collectionId'];
    when 'DataTable' then allowed := array['collectionId','title','presentation']; required := array['collectionId'];
    when 'CollectionChart' then allowed := array['collectionId','title','field']; required := array['collectionId','field'];
    else raise exception 'Unsupported PAW catalog component';
  end case;
  if kind not in ('CollectionForm','DataTable','CollectionChart') then allowed := allowed || array['weight','accessibility']; end if;
  allowed := allowed || array['id','component','metadata','accessibility'];
  if not (c ?& required) or exists(select 1 from jsonb_object_keys(c) k where not (k = any(allowed))) then raise exception 'Invalid A2UI component properties'; end if;
  foreach prop in array array['text','title','label'] loop
    if c ? prop and not public.a2ui_dynamic(c->prop,'string') then raise exception 'Invalid dynamic string'; end if;
  end loop;
  if c ? 'value' and not public.a2ui_dynamic(c->'value',case when kind = 'CheckBox' then 'boolean' else 'string' end) then raise exception 'Invalid input binding'; end if;
  if c ? 'weight' and jsonb_typeof(c->'weight') <> 'number' then raise exception 'Invalid weight'; end if;
  if c ? 'accessibility' and jsonb_typeof(c->'accessibility') <> 'object' then raise exception 'Invalid accessibility'; end if;
  if c ? 'metadata' and jsonb_typeof(c->'metadata') <> 'object' then raise exception 'Invalid metadata'; end if;
  if c ? 'align' and (jsonb_typeof(c->'align') <> 'string' or c->>'align' not in ('start','center','end','stretch')) then raise exception 'Invalid alignment'; end if;
  if c ? 'justify' and (jsonb_typeof(c->'justify') <> 'string' or c->>'justify' not in ('start','center','end','stretch','spaceAround','spaceBetween','spaceEvenly')) then raise exception 'Invalid justification'; end if;
  if c ? 'direction' and (jsonb_typeof(c->'direction') <> 'string' or c->>'direction' not in ('vertical','horizontal')) then raise exception 'Invalid list direction'; end if;
  if c ? 'axis' and (jsonb_typeof(c->'axis') <> 'string' or c->>'axis' not in ('vertical','horizontal')) then raise exception 'Invalid divider axis'; end if;
  if c ? 'presentation' and (jsonb_typeof(c->'presentation') <> 'string' or c->>'presentation' not in ('table','list')) then raise exception 'Invalid presentation'; end if;
  if c ? 'variant' and (jsonb_typeof(c->'variant') <> 'string' or
    (kind = 'Text' and c->>'variant' not in ('h1','h2','h3','h4','h5','caption','body')) or
    (kind = 'Button' and c->>'variant' not in ('default','primary','borderless')) or
    (kind = 'TextField' and c->>'variant' not in ('shortText','longText','number','obscured'))) then raise exception 'Invalid variant'; end if;
  if c ? 'child' and jsonb_typeof(c->'child') <> 'string' then raise exception 'Invalid child'; end if;
  if c ? 'children' then
    child := c->'children';
    if jsonb_typeof(child) = 'array' then
      if jsonb_array_length(child) > 200 or exists(select 1 from jsonb_array_elements(child) x where jsonb_typeof(x) <> 'string') then raise exception 'Invalid children'; end if;
    elsif jsonb_typeof(child) = 'object' then
      if not (child ?& array['componentId','path']) or jsonb_typeof(child->'componentId') <> 'string' or jsonb_typeof(child->'path') <> 'string'
        or (select count(*) from jsonb_object_keys(child)) <> 2 then raise exception 'Invalid child template'; end if;
    else raise exception 'Invalid children'; end if;
  end if;
  if c ? 'tabs' then
    if jsonb_typeof(c->'tabs') <> 'array' or jsonb_array_length(c->'tabs') not between 1 and 50 then raise exception 'Invalid tabs'; end if;
    for tab in select value from jsonb_array_elements(c->'tabs') loop
      if not (tab ?& array['child','title']) or jsonb_typeof(tab->'child') <> 'string' or not public.a2ui_dynamic(tab->'title','string') then raise exception 'Invalid tab'; end if;
    end loop;
  end if;
  if c ? 'action' then
    child := c->'action'->'event';
    if jsonb_typeof(c->'action') <> 'object' or jsonb_typeof(child) is distinct from 'object'
      or jsonb_typeof(child->'name') is distinct from 'string' or child->>'name' not in ('paw.refresh','paw.createRecord')
      or exists(select 1 from jsonb_object_keys(c->'action') k where k <> 'event')
      or (child ? 'context' and jsonb_typeof(child->'context') <> 'object') then raise exception 'Unsupported PAW action'; end if;
    if jsonb_typeof(child->'context'->'collectionId') = 'string' and not exists(select 1 from public.collections where id = (child->'context'->>'collectionId')::uuid and workspace_id = target) then raise exception 'Invalid action collection'; end if;
  end if;
  if c ? 'checks' then
    if jsonb_typeof(c->'checks') <> 'array' or jsonb_array_length(c->'checks') > 100 then raise exception 'Invalid checks'; end if;
    for tab in select value from jsonb_array_elements(c->'checks') loop
      if jsonb_typeof(tab) <> 'object' or not (tab ?& array['condition','message'])
        or not public.a2ui_dynamic(tab->'condition','boolean') or jsonb_typeof(tab->'message') <> 'string'
        or exists(select 1 from jsonb_object_keys(tab) k where k not in ('condition','message')) then raise exception 'Invalid check'; end if;
    end loop;
  end if;
  if c ? 'collectionId' then
    if jsonb_typeof(c->'collectionId') <> 'string' then raise exception 'Collection bindings must be static'; end if;
    select fields into field_list from public.collections where id = (c->>'collectionId')::uuid and workspace_id = target;
    if field_list is null then raise exception 'Invalid collection binding'; end if;
    if c ? 'field' and (jsonb_typeof(c->'field') <> 'string' or not exists(select 1 from jsonb_array_elements(field_list) f where f->>'key' = c->>'field')) then raise exception 'Invalid field binding'; end if;
  end if;
end;
$$;

create function public.validate_interface(definition jsonb, target uuid) returns void
language plpgsql set search_path = '' as $$
declare msg jsonb; payload jsonb; sid text; op text; surfaces jsonb := '{}'; components jsonb; c jsonb; old_component jsonb; component_count integer; entry record; child text; graph_count integer; graph_invalid boolean; remaining jsonb; leaves text[]; layers integer;
begin
  -- Allow an unchanged legacy interface during unrelated workspace updates only.
  -- Saves/restores through PAW convert to A2UI; original history stays recoverable.
  if definition->'version' = '1'::jsonb then
    if not exists(select 1 from public.workspaces where id = target and interface = definition) then raise exception 'Legacy interfaces must be upgraded to A2UI before saving'; end if;
    perform public.validate_legacy_interface(definition, target); return;
  end if;
  if jsonb_typeof(definition) <> 'object' or not (definition ? 'messages') or jsonb_typeof(definition->'messages') <> 'array'
    or (select count(*) from jsonb_object_keys(definition)) <> 1 or jsonb_array_length(definition->'messages') not between 2 and 200
    or octet_length(definition::text) > 300000 then raise exception 'Invalid A2UI document'; end if;
  for msg in select value from jsonb_array_elements(definition->'messages') loop
    if jsonb_typeof(msg) <> 'object' or msg->>'version' is distinct from 'v0.9.1'
      or (select count(*) from jsonb_object_keys(msg)) <> 2 then raise exception 'Invalid A2UI message'; end if;
    select k into op from jsonb_object_keys(msg) k where k <> 'version';
    if op not in ('createSurface','updateComponents','updateDataModel','deleteSurface') then raise exception 'Unsupported A2UI message'; end if;
    payload := msg->op; sid := payload->>'surfaceId';
    if jsonb_typeof(payload) <> 'object' or jsonb_typeof(payload->'surfaceId') is distinct from 'string' or sid !~ '^[A-Za-z_][A-Za-z0-9_-]{0,63}$' then raise exception 'Invalid surface'; end if;
    if op = 'createSurface' then
      if surfaces ? sid or payload->>'catalogId' is distinct from 'https://paw.local/catalogs/workspace-v1.json'
        or exists(select 1 from jsonb_object_keys(payload) k where k not in ('surfaceId','catalogId','sendDataModel'))
        or (payload ? 'sendDataModel' and jsonb_typeof(payload->'sendDataModel') <> 'boolean') then raise exception 'Invalid surface initialization'; end if;
      surfaces := surfaces || jsonb_build_object(sid, '{}'::jsonb);
      if (select count(*) from jsonb_object_keys(surfaces)) > 8 then raise exception 'Too many surfaces'; end if;
    else
      if not (surfaces ? sid) then raise exception 'Surface must be initialized first'; end if;
      if op = 'deleteSurface' then
        if (select count(*) from jsonb_object_keys(payload)) <> 1 then raise exception 'Invalid surface deletion'; end if;
        surfaces := surfaces - sid;
      elsif op = 'updateDataModel' then
        if exists(select 1 from jsonb_object_keys(payload) k where k not in ('surfaceId','path','value')) or (payload ? 'path' and jsonb_typeof(payload->'path') <> 'string') then raise exception 'Invalid data-model update'; end if;
      else
        if exists(select 1 from jsonb_object_keys(payload) k where k not in ('surfaceId','components')) or jsonb_typeof(payload->'components') is distinct from 'array' or jsonb_array_length(payload->'components') > 200 then raise exception 'Invalid component update'; end if;
        if (select count(*) from jsonb_array_elements(payload->'components')) <> (select count(distinct value->>'id') from jsonb_array_elements(payload->'components')) then raise exception 'Duplicate component IDs in update'; end if;
        components := surfaces->sid;
        for c in select value from jsonb_array_elements(payload->'components') loop
          if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'id') is distinct from 'string' then raise exception 'Invalid component update'; end if;
          old_component := coalesce(components->(c->>'id'), '{}'::jsonb);
          c := old_component || c;
          perform public.validate_a2ui_component(c, target);
          components := components || jsonb_build_object(c->>'id', c);
        end loop;
        component_count := (select count(*) from jsonb_object_keys(components));
        if component_count > 200 then raise exception 'Too many components'; end if;
        surfaces := surfaces || jsonb_build_object(sid, components);
      end if;
    end if;
  end loop;
  if surfaces = '{}'::jsonb then raise exception 'An active surface is required'; end if;
  for entry in select value from jsonb_each(surfaces) loop
    components := entry.value;
    if not (components ? 'root') then raise exception 'Surface needs a root component'; end if;
    for c in select value from jsonb_each(components) loop
      for child in select * from public.a2ui_children(c) loop
        if child is null or not (components ? child) then raise exception 'Dangling A2UI component reference'; end if;
      end loop;
    end loop;
    -- UNION tracks reachable IDs once even in a shared-child DAG. Enumerating
    -- every path with UNION ALL can expand exponentially on valid A2UI graphs.
    with recursive reachable(id) as (
      select 'root'::text
      union
      select refs.child_id from reachable
        cross join lateral public.a2ui_children(components->reachable.id) refs(child_id)
    ) select count(*) into graph_count from reachable;
    if graph_count <> (select count(*) from jsonb_object_keys(components)) then raise exception 'Orphaned A2UI component'; end if;
    remaining := components; layers := 0;
    while remaining <> '{}'::jsonb loop
      select array_agg(nodes.key) into leaves from jsonb_each(remaining) nodes
        where not exists(select 1 from public.a2ui_children(nodes.value) refs(child_id) where remaining ? refs.child_id);
      if leaves is null then raise exception 'Cyclic A2UI component graph'; end if;
      layers := layers + 1;
      if layers > 16 then raise exception 'Excessive-depth A2UI graph'; end if;
      remaining := remaining - leaves;
    end loop;
  end loop;
end;
$$;

alter table public.workspaces alter column interface set default '{"messages":[{"version":"v0.9.1","createSurface":{"surfaceId":"workspace","catalogId":"https://paw.local/catalogs/workspace-v1.json"}},{"version":"v0.9.1","updateComponents":{"surfaceId":"workspace","components":[{"id":"root","component":"Column","children":[]}]}}]}';
-- The existing ownership policies, optimistic revision trigger, immutable history,
-- record validators and composite scope foreign keys are intentionally unchanged.

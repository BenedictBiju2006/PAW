-- PAW milestone 1. Run through Supabase migrations, never with a browser key.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  interface jsonb not null default '{"version":1,"nodes":[]}',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_owner on public.workspaces(user_id);
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  fields jsonb not null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index collections_workspace on public.collections(workspace_id);
create table public.records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (collection_id, workspace_id) references public.collections(id, workspace_id) on delete cascade
);
create index records_collection on public.records(workspace_id, collection_id, created_at desc, id);
create table public.interface_revisions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision integer not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id, revision)
);

-- Security invoker: ownership lookup itself respects workspaces RLS.
create function public.owns_workspace(target uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.workspaces where id = target and user_id = (select auth.uid()));
$$;
alter table public.workspaces enable row level security;
alter table public.collections enable row level security;
alter table public.records enable row level security;
alter table public.interface_revisions enable row level security;
create policy workspace_owner on public.workspaces for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy collection_owner on public.collections for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy record_owner on public.records for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy revision_owner on public.interface_revisions for select to authenticated
  using (public.owns_workspace(workspace_id));
revoke all on public.workspaces, public.collections, public.records, public.interface_revisions from anon;
revoke all on public.workspaces, public.collections, public.records, public.interface_revisions from authenticated;
grant select, insert, update, delete on public.workspaces, public.collections, public.records to authenticated;
grant select on public.interface_revisions to authenticated;

create function public.validate_collection() returns trigger
language plpgsql set search_path = '' as $$
declare f jsonb; keys text[] := '{}'; option_count integer;
begin
  if TG_OP = 'UPDATE' and (new.fields <> old.fields or new.workspace_id <> old.workspace_id or new.id <> old.id) then
    raise exception 'Collection schema and scope are immutable; create a new collection to change fields.';
  end if;
  if jsonb_typeof(new.fields) <> 'array' or jsonb_array_length(new.fields) not between 1 and 30 then raise exception 'Invalid fields'; end if;
  for f in select value from jsonb_array_elements(new.fields) loop
    if jsonb_typeof(f) <> 'object' or not (f ?& array['key','label','type','required'])
      or jsonb_typeof(f->'key') <> 'string' or jsonb_typeof(f->'label') <> 'string' or jsonb_typeof(f->'type') <> 'string'
      or (f->>'key') !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
      or length(btrim(f->>'label')) not between 1 and 100
      or (f->>'type') not in ('string','number','boolean','date','enum')
      or jsonb_typeof(f->'required') <> 'boolean'
      or (f->>'key') = any(keys) then raise exception 'Invalid or duplicate field'; end if;
    keys := array_append(keys, f->>'key');
    if f->>'type' = 'enum' then
      if jsonb_typeof(f->'options') <> 'array' or not (f ? 'options') then raise exception 'Enum needs options'; end if;
      select count(distinct value) into option_count from jsonb_array_elements(f->'options');
      if option_count <> jsonb_array_length(f->'options') or option_count not between 1 and 50
        or exists(select 1 from jsonb_array_elements(f->'options') o where jsonb_typeof(o) <> 'string' or length(o #>> '{}') not between 1 and 100)
      then raise exception 'Invalid enum options'; end if;
    end if;
  end loop;
  return new;
end;
$$;
create trigger collection_validation before insert or update on public.collections for each row execute function public.validate_collection();

create function public.validate_record() returns trigger
language plpgsql set search_path = '' as $$
declare schema_fields jsonb; f jsonb; v jsonb; keys text[] := '{}'; date_value date;
begin
  if TG_OP = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.collection_id <> old.collection_id or new.id <> old.id) then raise exception 'Record scope is immutable'; end if;
  select fields into schema_fields from public.collections where id = new.collection_id and workspace_id = new.workspace_id;
  if schema_fields is null then raise exception 'Collection not found'; end if;
  for f in select value from jsonb_array_elements(schema_fields) loop
    keys := array_append(keys, f->>'key'); v := new.data->(f->>'key');
    if v is null or v = 'null'::jsonb then
      if (f->>'required')::boolean then raise exception 'Required field missing'; end if;
      continue;
    end if;
    case f->>'type'
      when 'number' then if jsonb_typeof(v) <> 'number' then raise exception 'Expected number'; end if;
      when 'boolean' then if jsonb_typeof(v) <> 'boolean' then raise exception 'Expected boolean'; end if;
      when 'enum' then if jsonb_typeof(v) <> 'string' or not ((f->'options') @> jsonb_build_array(v)) then raise exception 'Invalid enum value'; end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
        date_value := (v #>> '{}')::date;
      else
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 10000 or ((f->>'required')::boolean and length(v #>> '{}') = 0) then raise exception 'Invalid string'; end if;
    end case;
  end loop;
  if exists(select 1 from jsonb_object_keys(new.data) k where not (k = any(keys))) then raise exception 'Unknown field'; end if;
  new.updated_at := now(); return new;
end;
$$;
create trigger record_validation before insert or update on public.records for each row execute function public.validate_record();

create function public.validate_interface(definition jsonb, target uuid) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; item_depth integer; ids text[] := '{}'; field_list jsonb;
begin
  if jsonb_typeof(definition) <> 'object' or definition->'version' is distinct from '1'::jsonb
    or not (definition ? 'nodes') or jsonb_typeof(definition->'nodes') <> 'array'
    or jsonb_array_length(definition->'nodes') > 50
    or octet_length(definition::text) > 250000 then raise exception 'Invalid interface'; end if;
  for item, item_depth in
    with recursive nodes(node, depth) as (
      select value, 1 from jsonb_array_elements(definition->'nodes')
      union all
      select child.value, nodes.depth + 1 from nodes cross join lateral
        jsonb_array_elements(case when jsonb_typeof(nodes.node->'children') = 'array' then nodes.node->'children' else '[]'::jsonb end) child
      where nodes.depth < 9
    ) select node, depth from nodes
  loop
    if item_depth > 8 or cardinality(ids) >= 200 or not (item ?& array['id','type'])
      or jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') <> 'string' or jsonb_typeof(item->'type') <> 'string'
      or (item ? 'text' and (jsonb_typeof(item->'text') <> 'string' or length(item->>'text') > 1000))
      or (item ? 'collectionId' and jsonb_typeof(item->'collectionId') <> 'string')
      or (item ? 'field' and (jsonb_typeof(item->'field') <> 'string' or (item->>'field') !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'))
      or (item->>'id') !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
      or (item->>'id') = any(ids)
      or (item->>'type') not in ('container','heading','text','form','table','list','chart','tabs','button')
      or (item ? 'children' and (jsonb_typeof(item->'children') <> 'array' or item->>'type' not in ('container','tabs') or jsonb_array_length(item->'children') > 50))
    then raise exception 'Invalid component'; end if;
    ids := array_append(ids, item->>'id');
    if item->>'type' in ('form','table','list','chart') and not (item ? 'collectionId') then raise exception 'Missing collection binding'; end if;
    if item ? 'collectionId' then
      select fields into field_list from public.collections where id = (item->>'collectionId')::uuid and workspace_id = target;
      if field_list is null then raise exception 'Invalid collection binding'; end if;
      if item ? 'field' and not exists(select 1 from jsonb_array_elements(field_list) f where f->>'key' = item->>'field') then raise exception 'Invalid field binding'; end if;
    end if;
    if item->>'type' = 'chart' and not (item ? 'field') then raise exception 'Chart requires a field'; end if;
  end loop;
end;
$$;
create function public.prepare_workspace() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id then raise exception 'Workspace owner and identity are immutable'; end if;
    new.revision := old.revision + case when new.interface <> old.interface then 1 else 0 end;
  else new.revision := 1;
  end if;
  perform public.validate_interface(new.interface, new.id);
  new.updated_at := now(); return new;
end;
$$;
create trigger workspace_validation before insert or update on public.workspaces for each row execute function public.prepare_workspace();
-- Only this fixed, non-callable trigger can append immutable revision history.
create function public.capture_interface_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' or new.interface <> old.interface then
    insert into public.interface_revisions(workspace_id, revision, definition) values (new.id, new.revision, new.interface);
  end if;
  return new;
end;
$$;
revoke all on function public.capture_interface_revision() from public, anon, authenticated;
create trigger workspace_revision after insert or update on public.workspaces for each row execute function public.capture_interface_revision();
-- Prevent dropping a bound collection through direct API access.
create function public.protect_collection_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.workspaces where id = old.workspace_id and interface::text like '%' || old.id::text || '%') then
    raise exception 'Remove interface bindings before deleting a collection';
  end if;
  return old;
end;
$$;
create trigger collection_delete before delete on public.collections for each row execute function public.protect_collection_delete();

-- Bounded aggregation across the collection, under the caller's RLS context.
create function public.aggregate_records(target_workspace uuid, target_collection uuid, field_key text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare field_type text; buckets jsonb; summary jsonb;
begin
  if not public.owns_workspace(target_workspace) then raise exception 'Workspace not found'; end if;
  select f->>'type' into field_type from public.collections c,
    lateral jsonb_array_elements(c.fields) f
    where c.id = target_collection and c.workspace_id = target_workspace and f->>'key' = field_key;
  if field_type is null then raise exception 'Field not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count)), '[]'::jsonb)
    into buckets from (
      select data->field_key as value, count(*) as count from public.records
      where workspace_id = target_workspace and collection_id = target_collection
      group by data->field_key order by count(*) desc, (data->field_key)::text limit 100
    ) grouped;
  select jsonb_build_object('count', count(*), 'distinctValues', count(distinct data->field_key))
    into summary from public.records where workspace_id = target_workspace and collection_id = target_collection;
  if field_type = 'number' then
    select summary || jsonb_build_object('sum', sum((data->>field_key)::numeric), 'average', avg((data->>field_key)::numeric),
      'min', min((data->>field_key)::numeric), 'max', max((data->>field_key)::numeric)) into summary
      from public.records where workspace_id = target_workspace and collection_id = target_collection;
  end if;
  return summary || jsonb_build_object('buckets', buckets, 'bucketLimit', 100);
end;
$$;
revoke all on function public.aggregate_records(uuid, uuid, text) from public, anon;
grant execute on function public.aggregate_records(uuid, uuid, text) to authenticated;

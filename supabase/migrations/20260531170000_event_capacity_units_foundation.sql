-- Event capacity units foundation.
-- Models named capacity buckets that participation options can consume.

create table if not exists public.event_capacity_units (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  key text not null,
  title text not null,
  description text,
  capacity integer,

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_capacity_units_event_key_unique
    unique (event_id, key),

  constraint event_capacity_units_id_event_id_unique
    unique (id, event_id),

  constraint event_capacity_units_key_not_empty
    check (btrim(key) <> ''),

  constraint event_capacity_units_title_not_empty
    check (btrim(title) <> ''),

  constraint event_capacity_units_capacity_check
    check (capacity is null or capacity > 0)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_participation_options_id_event_id_unique'
      and conrelid = to_regclass('public.event_participation_options')
  ) then
    alter table public.event_participation_options
      add constraint event_participation_options_id_event_id_unique
      unique (id, event_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_capacity_units_id_event_id_unique'
      and conrelid = to_regclass('public.event_capacity_units')
  ) then
    alter table public.event_capacity_units
      add constraint event_capacity_units_id_event_id_unique
      unique (id, event_id);
  end if;
end $$;

create table if not exists public.event_participation_option_capacity_units (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  option_id uuid not null,
  capacity_unit_id uuid not null,
  seats_per_quantity integer not null default 1,
  created_at timestamptz not null default now(),

  constraint event_option_capacity_units_option_event_fkey
    foreign key (option_id, event_id)
    references public.event_participation_options(id, event_id)
    on delete cascade,

  constraint event_option_capacity_units_unit_event_fkey
    foreign key (capacity_unit_id, event_id)
    references public.event_capacity_units(id, event_id)
    on delete cascade,

  constraint event_option_capacity_units_option_unit_unique
    unique (option_id, capacity_unit_id),

  constraint event_option_capacity_units_seats_per_quantity_check
    check (seats_per_quantity > 0)
);

create index if not exists event_capacity_units_event_active_sort_idx
  on public.event_capacity_units(event_id, is_active, sort_order);

create index if not exists event_option_capacity_units_event_id_idx
  on public.event_participation_option_capacity_units(event_id);

create index if not exists event_option_capacity_units_option_id_idx
  on public.event_participation_option_capacity_units(option_id);

create index if not exists event_option_capacity_units_capacity_unit_id_idx
  on public.event_participation_option_capacity_units(capacity_unit_id);

drop trigger if exists set_event_capacity_units_updated_at
  on public.event_capacity_units;

create trigger set_event_capacity_units_updated_at
before update on public.event_capacity_units
for each row execute function public.set_updated_at();

alter table public.event_capacity_units enable row level security;
alter table public.event_participation_option_capacity_units enable row level security;

drop policy if exists "event_capacity_units_select_by_manager"
  on public.event_capacity_units;

create policy "event_capacity_units_select_by_manager"
on public.event_capacity_units
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_capacity_units_manage_by_manager"
  on public.event_capacity_units;

create policy "event_capacity_units_manage_by_manager"
on public.event_capacity_units
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_option_capacity_units_select_by_manager"
  on public.event_participation_option_capacity_units;

create policy "event_option_capacity_units_select_by_manager"
on public.event_participation_option_capacity_units
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_option_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_option_capacity_units_manage_by_manager"
  on public.event_participation_option_capacity_units;

create policy "event_option_capacity_units_manage_by_manager"
on public.event_participation_option_capacity_units
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_option_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_option_capacity_units.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

grant select, insert, update, delete
  on public.event_capacity_units
  to authenticated;

grant select, insert, update, delete
  on public.event_participation_option_capacity_units
  to authenticated;

create or replace function public.admin_list_event_capacity_units(p_event_id uuid)
returns setof public.event_capacity_units
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return query
  select ecu.*
  from public.event_capacity_units ecu
  where ecu.event_id = p_event_id
  order by ecu.sort_order asc, ecu.created_at asc;
end;
$$;

revoke all on function public.admin_list_event_capacity_units(uuid) from public;
grant execute on function public.admin_list_event_capacity_units(uuid) to authenticated;

create or replace function public.admin_replace_event_capacity_units(
  p_event_id uuid,
  p_units jsonb
)
returns setof public.event_capacity_units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_unit jsonb;
  v_index integer := 0;
  v_seen_ids uuid[] := array[]::uuid[];
  v_seen_keys text[] := array[]::text[];

  v_id uuid;
  v_existing_event_id uuid;
  v_key text;
  v_title text;
  v_description text;
  v_capacity integer;
  v_sort_order integer;
  v_is_active boolean;

  v_text text;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'p_units must be a JSON array' using errcode = '22023';
  end if;

  perform 1
  from public.event_capacity_units ecu
  where ecu.event_id = p_event_id
  for update;

  for v_unit in
    select value
    from jsonb_array_elements(p_units) as t(value)
  loop
    if jsonb_typeof(v_unit) <> 'object' then
      raise exception 'Capacity unit must be a JSON object'
        using errcode = '22023';
    end if;

    v_text := nullif(btrim(v_unit ->> 'id'), '');
    if v_text is null then
      v_id := null;
    else
      begin
        v_id := v_text::uuid;
      exception when others then
        raise exception 'id is invalid' using errcode = '22023';
      end;

      if v_id = any(v_seen_ids) then
        raise exception 'Duplicate capacity unit id in payload'
          using errcode = '22023';
      end if;

      select ecu.event_id
      into v_existing_event_id
      from public.event_capacity_units ecu
      where ecu.id = v_id
      for update;

      if not found then
        raise exception 'Capacity unit not found' using errcode = 'P0002';
      end if;

      if v_existing_event_id <> p_event_id then
        raise exception 'Capacity unit does not belong to event'
          using errcode = '42501';
      end if;
    end if;

    v_key := nullif(btrim(v_unit ->> 'key'), '');
    if v_key is null then
      raise exception 'Capacity unit key is required' using errcode = '22023';
    end if;

    if v_key = any(v_seen_keys) then
      raise exception 'Duplicate capacity unit key in payload'
        using errcode = '22023';
    end if;

    v_title := nullif(btrim(v_unit ->> 'title'), '');
    if v_title is null then
      raise exception 'Capacity unit title is required' using errcode = '22023';
    end if;

    v_description := nullif(btrim(v_unit ->> 'description'), '');

    v_text := nullif(btrim(v_unit ->> 'capacity'), '');
    if v_text is null then
      v_capacity := null;
    else
      begin
        v_capacity := v_text::integer;
      exception when others then
        raise exception 'capacity is invalid' using errcode = '22023';
      end;

      if v_capacity <= 0 then
        raise exception 'capacity must be greater than 0'
          using errcode = '22023';
      end if;
    end if;

    v_text := nullif(btrim(coalesce(
      v_unit ->> 'sortOrder',
      v_unit ->> 'sort_order'
    )), '');
    if v_text is null then
      v_sort_order := v_index;
    else
      begin
        v_sort_order := v_text::integer;
      exception when others then
        raise exception 'sortOrder is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_unit ->> 'isActive',
      v_unit ->> 'is_active'
    )), '');
    if v_text is null then
      v_is_active := true;
    else
      begin
        v_is_active := v_text::boolean;
      exception when others then
        raise exception 'isActive is invalid' using errcode = '22023';
      end;
    end if;

    if v_id is null then
      insert into public.event_capacity_units (
        event_id,
        key,
        title,
        description,
        capacity,
        sort_order,
        is_active
      ) values (
        p_event_id,
        v_key,
        v_title,
        v_description,
        v_capacity,
        v_sort_order,
        v_is_active
      )
      returning id into v_id;
    else
      update public.event_capacity_units
      set
        key = v_key,
        title = v_title,
        description = v_description,
        capacity = v_capacity,
        sort_order = v_sort_order,
        is_active = v_is_active
      where id = v_id;
    end if;

    v_seen_ids := array_append(v_seen_ids, v_id);
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_index := v_index + 1;
  end loop;

  delete from public.event_capacity_units ecu
  where ecu.event_id = p_event_id
    and not (ecu.id = any(v_seen_ids));

  return query
  select ecu.*
  from public.event_capacity_units ecu
  where ecu.event_id = p_event_id
  order by ecu.sort_order asc, ecu.created_at asc;
end;
$$;

revoke all on function public.admin_replace_event_capacity_units(uuid, jsonb) from public;
grant execute on function public.admin_replace_event_capacity_units(uuid, jsonb) to authenticated;

create or replace function public.admin_replace_option_capacity_units(
  p_event_id uuid,
  p_mappings jsonb
)
returns setof public.event_participation_option_capacity_units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_mapping jsonb;
  v_option public.event_participation_options;
  v_option_id uuid;
  v_capacity_unit_id uuid;
  v_seats_per_quantity integer;
  v_pair_key text;
  v_seen_pairs text[] := array[]::text[];

  v_text text;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'p_mappings must be a JSON array' using errcode = '22023';
  end if;

  perform 1
  from public.event_participation_option_capacity_units epocu
  where epocu.event_id = p_event_id
  for update;

  delete from public.event_participation_option_capacity_units epocu
  where epocu.event_id = p_event_id;

  for v_mapping in
    select value
    from jsonb_array_elements(p_mappings) as t(value)
  loop
    if jsonb_typeof(v_mapping) <> 'object' then
      raise exception 'Capacity unit mapping must be a JSON object'
        using errcode = '22023';
    end if;

    v_text := nullif(btrim(coalesce(
      v_mapping ->> 'optionId',
      v_mapping ->> 'option_id'
    )), '');
    if v_text is null then
      raise exception 'optionId is required' using errcode = '22023';
    end if;

    begin
      v_option_id := v_text::uuid;
    exception when others then
      raise exception 'optionId is invalid' using errcode = '22023';
    end;

    v_text := nullif(btrim(coalesce(
      v_mapping ->> 'capacityUnitId',
      v_mapping ->> 'capacity_unit_id'
    )), '');
    if v_text is null then
      raise exception 'capacityUnitId is required' using errcode = '22023';
    end if;

    begin
      v_capacity_unit_id := v_text::uuid;
    exception when others then
      raise exception 'capacityUnitId is invalid' using errcode = '22023';
    end;

    v_pair_key := v_option_id::text || ':' || v_capacity_unit_id::text;
    if v_pair_key = any(v_seen_pairs) then
      raise exception 'Duplicate option capacity unit mapping in payload'
        using errcode = '22023';
    end if;

    select *
    into v_option
    from public.event_participation_options epo
    where epo.id = v_option_id
      and epo.event_id = p_event_id;

    if not found then
      raise exception 'Option does not belong to event'
        using errcode = '42501';
    end if;

    if v_option.is_donation or not v_option.counts_toward_capacity then
      raise exception 'Donation and non-capacity options cannot use capacity units'
        using errcode = '22023';
    end if;

    perform 1
    from public.event_capacity_units ecu
    where ecu.id = v_capacity_unit_id
      and ecu.event_id = p_event_id;

    if not found then
      raise exception 'Capacity unit does not belong to event'
        using errcode = '42501';
    end if;

    v_text := nullif(btrim(coalesce(
      v_mapping ->> 'seatsPerQuantity',
      v_mapping ->> 'seats_per_quantity'
    )), '');
    if v_text is null then
      v_seats_per_quantity := 1;
    else
      begin
        v_seats_per_quantity := v_text::integer;
      exception when others then
        raise exception 'seatsPerQuantity is invalid'
          using errcode = '22023';
      end;
    end if;

    if v_seats_per_quantity <= 0 then
      raise exception 'seatsPerQuantity must be greater than 0'
        using errcode = '22023';
    end if;

    insert into public.event_participation_option_capacity_units (
      event_id,
      option_id,
      capacity_unit_id,
      seats_per_quantity
    ) values (
      p_event_id,
      v_option_id,
      v_capacity_unit_id,
      v_seats_per_quantity
    );

    v_seen_pairs := array_append(v_seen_pairs, v_pair_key);
  end loop;

  return query
  select epocu.*
  from public.event_participation_option_capacity_units epocu
  where epocu.event_id = p_event_id
  order by epocu.created_at asc;
end;
$$;

revoke all on function public.admin_replace_option_capacity_units(uuid, jsonb) from public;
grant execute on function public.admin_replace_option_capacity_units(uuid, jsonb) to authenticated;

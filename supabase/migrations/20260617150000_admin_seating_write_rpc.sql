-- Admin seating write RPC (block B, PR 8).
--
-- This is the security-critical mutation layer for seating. Everything here is
-- reachable only through SECURITY DEFINER RPC: there are intentionally NO direct
-- write grants and NO "for all" RLS policies on the seating tables. The browser
-- admin client cannot insert/update/delete seating rows directly; it must go
-- through these validated functions. That keeps the validation layer (role,
-- single-community scope, exactly-one-rabbi-table, capacity untouched, ...) the
-- only write path and impossible to bypass with a hand-crafted PostgREST call.
--
-- No service role, no Admin API, auth.users is never touched. Every function is
-- SECURITY DEFINER with `set search_path = public` and gates on auth.uid() plus
-- public.has_community_role(community_id, array['admin', 'event_manager']).
--
-- Payload contract (v15, see docs/admin-seating.md) for the save RPC:
--   { layout, customTables[], tableConnections[], selectedTableId, seatingDone,
--     activeTemplateId, reserveIds[], capacity, chairs[], pool[] }
-- plus the routing keys eventId / occurrenceId / capacityUnitId that identify the
-- capacity slot (the prototype carried the slot in the localStorage key, not the
-- body).
--
-- The real registration limit `event_capacity_units.capacity` is NEVER written
-- by anything in this file. `event_seating_layouts.capacity_limit_snapshot` is a
-- non-authoritative display snapshot and is always derived server-side from the
-- current capacity unit, so a payload can neither contain nor change the limit.

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to clients; only the definer RPC below call
-- them, where they run with the definer's privileges).
-- ---------------------------------------------------------------------------

-- Validate the geometry of a tables[] json array (prototype customTables[] /
-- template snapshot tables[]). Enforces the cross-row invariants that table
-- CHECK constraints cannot: exactly one rabbi table, plus friendly errors for
-- angle / long_side_seats before the row-level constraints fire.
create or replace function public.seating_assert_valid_tables(p_tables jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $func$
declare
  v_table jsonb;
  v_id text;
  v_angle integer;
  v_seats integer;
  v_rabbi_count integer := 0;
begin
  if p_tables is null or jsonb_typeof(p_tables) <> 'array' then
    raise exception 'tables must be a json array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_tables) = 0 then
    raise exception 'A seating layout needs at least one table' using errcode = '22023';
  end if;

  for v_table in select value from jsonb_array_elements(p_tables)
  loop
    v_id := nullif(btrim(coalesce(v_table ->> 'id', '')), '');
    if v_id is null then
      raise exception 'Every table needs a non-empty id' using errcode = '22023';
    end if;

    begin
      v_angle := (v_table ->> 'angle')::integer;
    exception when others then
      raise exception 'table % has an invalid angle', v_id using errcode = '22023';
    end;
    if v_angle is null or v_angle not in (0, 90, 180, 270) then
      raise exception 'table % angle must be one of 0/90/180/270', v_id using errcode = '22023';
    end if;

    begin
      v_seats := coalesce(
        (v_table ->> 'sideSeats')::integer,
        (v_table ->> 'long_side_seats')::integer
      );
    exception when others then
      raise exception 'table % has invalid long_side_seats', v_id using errcode = '22023';
    end;
    if v_seats is null or v_seats not in (2, 3) then
      raise exception 'table % long_side_seats must be 2 or 3', v_id using errcode = '22023';
    end if;

    if coalesce((v_table ->> 'isRabbiTable')::boolean, false) then
      v_rabbi_count := v_rabbi_count + 1;
    end if;
  end loop;

  if v_rabbi_count <> 1 then
    raise exception
      'A seating layout must have exactly one rabbi table (found %)', v_rabbi_count
      using errcode = '22023';
  end if;
end;
$func$;

revoke all on function public.seating_assert_valid_tables(jsonb) from public;

-- Resolve and validate a capacity slot. Confirms event/occurrence/capacity_unit
-- all hang off the same event (hence the same community) and returns that
-- community id. Raises on any cross-event mismatch.
create or replace function public.seating_slot_community(
  p_event_id uuid,
  p_occurrence_id uuid,
  p_capacity_unit_id uuid
)
returns uuid
language plpgsql
stable
set search_path = public
as $func$
declare
  v_community_id uuid;
begin
  if p_event_id is null then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  if p_capacity_unit_id is null then
    raise exception 'capacity_unit_id is required' using errcode = '22023';
  end if;

  select e.community_id
  into v_community_id
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if p_occurrence_id is not null
     and not exists (
       select 1
       from public.event_occurrences o
       where o.id = p_occurrence_id
         and o.event_id = p_event_id
     ) then
    raise exception 'Occurrence does not belong to event' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.event_capacity_units u
    where u.id = p_capacity_unit_id
      and u.event_id = p_event_id
  ) then
    raise exception 'Capacity unit does not belong to event' using errcode = '22023';
  end if;

  return v_community_id;
end;
$func$;

revoke all on function public.seating_slot_community(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- admin_save_seating_layout(payload jsonb)
--
-- Saves geometry only: the layout row for the slot (upsert), its tables and its
-- connections, plus template_id and a server-derived capacity_limit_snapshot.
-- Assignments are NOT touched here (see admin_save_seating_assignments).
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_seating_layout(payload jsonb)
returns public.event_seating_layouts
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_occurrence_id uuid;
  v_unit_id uuid;
  v_community_id uuid;
  v_tables jsonb := coalesce(v_payload -> 'customTables', '[]'::jsonb);
  v_connections jsonb := coalesce(v_payload -> 'tableConnections', '[]'::jsonb);
  v_template_text text;
  v_template_id uuid;
  v_seating_done boolean := coalesce((v_payload ->> 'seatingDone')::boolean, false);
  v_capacity_snapshot integer;
  v_layout public.event_seating_layouts;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  v_event_id := nullif(btrim(coalesce(v_payload ->> 'eventId', v_payload ->> 'event_id')), '')::uuid;
  v_unit_id := nullif(btrim(coalesce(v_payload ->> 'capacityUnitId', v_payload ->> 'capacity_unit_id')), '')::uuid;
  v_occurrence_id := nullif(btrim(coalesce(v_payload ->> 'occurrenceId', v_payload ->> 'occurrence_id')), '')::uuid;

  v_community_id := public.seating_slot_community(v_event_id, v_occurrence_id, v_unit_id);

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  -- Geometry validation (single-rabbi, angles, seats). Connections must be an
  -- array; an absent/empty list is fine.
  perform public.seating_assert_valid_tables(v_tables);

  if jsonb_typeof(v_connections) <> 'array' then
    raise exception 'tableConnections must be a json array' using errcode = '22023';
  end if;

  -- activeTemplateId is only honoured when it points at a real, same-community
  -- template. Builtin/grid/blank choices (non-uuid client ids) stay null.
  v_template_text := nullif(btrim(v_payload ->> 'activeTemplateId'), '');
  if v_template_text is not null then
    begin
      v_template_id := v_template_text::uuid;
    exception when others then
      v_template_id := null;
    end;
    if v_template_id is not null
       and not exists (
         select 1
         from public.event_seating_layout_templates t
         where t.id = v_template_id
           and t.community_id = v_community_id
       ) then
      v_template_id := null;
    end if;
  end if;

  -- The snapshot is derived server-side from the real capacity unit; the payload
  -- can neither set the limit nor change event_capacity_units.capacity.
  select u.capacity
  into v_capacity_snapshot
  from public.event_capacity_units u
  where u.id = v_unit_id;

  -- Upsert the layout row for this slot.
  insert into public.event_seating_layouts (
    community_id,
    event_id,
    occurrence_id,
    capacity_unit_id,
    template_id,
    capacity_limit_snapshot,
    seating_done,
    created_by
  )
  values (
    v_community_id,
    v_event_id,
    v_occurrence_id,
    v_unit_id,
    v_template_id,
    v_capacity_snapshot,
    v_seating_done,
    v_user_id
  )
  on conflict (event_id, occurrence_id, capacity_unit_id) do update
    set template_id = excluded.template_id,
        capacity_limit_snapshot = excluded.capacity_limit_snapshot,
        seating_done = excluded.seating_done,
        updated_at = now()
  returning * into v_layout;

  -- Replace geometry. Assignments are left untouched.
  delete from public.event_seating_tables where layout_id = v_layout.id;
  delete from public.event_seating_table_connections where layout_id = v_layout.id;

  insert into public.event_seating_tables (
    layout_id,
    client_table_id,
    cx, cy, w, h,
    angle,
    long_side_seats,
    is_rabbi_table
  )
  select
    v_layout.id,
    nullif(btrim(t.value ->> 'id'), ''),
    (t.value ->> 'cx')::numeric,
    (t.value ->> 'cy')::numeric,
    (t.value ->> 'w')::numeric,
    (t.value ->> 'h')::numeric,
    coalesce((t.value ->> 'angle')::integer, 0),
    coalesce((t.value ->> 'sideSeats')::integer, (t.value ->> 'long_side_seats')::integer, 3),
    coalesce((t.value ->> 'isRabbiTable')::boolean, false)
  from jsonb_array_elements(v_tables) as t;

  insert into public.event_seating_table_connections (
    layout_id,
    from_client_table_id,
    from_end,
    to_client_table_id,
    to_end,
    anchor_x,
    anchor_y
  )
  select
    v_layout.id,
    nullif(btrim(c.value ->> 'aTableId'), ''),
    nullif(c.value ->> 'aEnd', ''),
    nullif(btrim(c.value ->> 'bTableId'), ''),
    nullif(c.value ->> 'bEnd', ''),
    nullif(c.value ->> 'x', '')::numeric,
    nullif(c.value ->> 'y', '')::numeric
  from jsonb_array_elements(v_connections) as c;

  return v_layout;
end;
$func$;

revoke all on function public.admin_save_seating_layout(jsonb) from public;
grant execute on function public.admin_save_seating_layout(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_save_seating_assignments(payload jsonb)
--
-- Saves guest / reserve assignments derived from chairs[] (placed) and pool[]
-- (unplaced). reserveIds[] is accepted for parity; reserves are the chairs/pool
-- entries with type='reserve'. The layout for the slot must already exist.
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_seating_assignments(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_occurrence_id uuid;
  v_unit_id uuid;
  v_community_id uuid;
  v_layout_id uuid;
  v_chairs jsonb := coalesce(v_payload -> 'chairs', '[]'::jsonb);
  v_pool jsonb := coalesce(v_payload -> 'pool', '[]'::jsonb);
  v_entry jsonb;
  v_seat_key text;
  v_type text;
  v_registration_id uuid;
  v_placed_count integer := 0;
  v_pooled_count integer := 0;
  v_reserve_count integer := 0;
  v_placed jsonb;
  v_pooled jsonb;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  v_event_id := nullif(btrim(coalesce(v_payload ->> 'eventId', v_payload ->> 'event_id')), '')::uuid;
  v_unit_id := nullif(btrim(coalesce(v_payload ->> 'capacityUnitId', v_payload ->> 'capacity_unit_id')), '')::uuid;
  v_occurrence_id := nullif(btrim(coalesce(v_payload ->> 'occurrenceId', v_payload ->> 'occurrence_id')), '')::uuid;

  v_community_id := public.seating_slot_community(v_event_id, v_occurrence_id, v_unit_id);

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if jsonb_typeof(v_chairs) <> 'array' then
    raise exception 'chairs must be a json array' using errcode = '22023';
  end if;
  if jsonb_typeof(v_pool) <> 'array' then
    raise exception 'pool must be a json array' using errcode = '22023';
  end if;

  select l.id
  into v_layout_id
  from public.event_seating_layouts l
  where l.event_id = v_event_id
    and l.capacity_unit_id = v_unit_id
    and l.occurrence_id is not distinct from v_occurrence_id;

  if v_layout_id is null then
    raise exception 'No seating layout for this slot; save the layout first'
      using errcode = 'P0002';
  end if;

  -- Replace the whole assignment set for the layout.
  delete from public.event_seating_assignments where layout_id = v_layout_id;

  -- Placed entries (chairs[]) require a seat_key; unplaced entries (pool[]) have
  -- a null seat_key.
  for v_entry, v_seat_key in
    select value, nullif(btrim(value ->> 'seatKey'), '') from jsonb_array_elements(v_chairs)
    union all
    select value, null::text from jsonb_array_elements(v_pool)
  loop
    v_type := lower(coalesce(nullif(btrim(v_entry ->> 'type'), ''), 'guest'));
    if v_type not in ('guest', 'reserve') then
      raise exception 'assignment_type must be guest or reserve (got %)', v_type
        using errcode = '22023';
    end if;

    v_registration_id := null;
    begin
      v_registration_id := nullif(btrim(coalesce(
        v_entry ->> 'registrationId',
        v_entry ->> 'registration_id'
      )), '')::uuid;
    exception when others then
      raise exception 'registrationId must be a uuid' using errcode = '22023';
    end;

    if v_type = 'reserve' and v_registration_id is not null then
      raise exception 'A reserve assignment must not carry a registration_id'
        using errcode = '22023';
    end if;

    if v_type = 'guest' then
      if v_registration_id is null then
        raise exception 'A guest assignment requires a registration_id'
          using errcode = '22023';
      end if;
      -- The registration must actually belong to THIS slot.
      if not exists (
        select 1
        from public.event_registration_capacity_reservations r
        where r.registration_id = v_registration_id
          and r.event_id = v_event_id
          and r.capacity_unit_id = v_unit_id
          and r.occurrence_id is not distinct from v_occurrence_id
      ) then
        raise exception
          'Registration % does not belong to this event/occurrence/capacity unit',
          v_registration_id
          using errcode = '22023';
      end if;
    end if;

    insert into public.event_seating_assignments (
      layout_id,
      registration_id,
      seat_key,
      guest_label,
      guest_initials,
      assignment_type
    )
    values (
      v_layout_id,
      v_registration_id,
      v_seat_key,
      nullif(btrim(v_entry ->> 'name'), ''),
      nullif(btrim(v_entry ->> 'initials'), ''),
      v_type
    );

    if v_seat_key is not null then
      v_placed_count := v_placed_count + 1;
    else
      v_pooled_count := v_pooled_count + 1;
    end if;
    if v_type = 'reserve' then
      v_reserve_count := v_reserve_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'layoutId', v_layout_id,
    'placedCount', v_placed_count,
    'pooledCount', v_pooled_count,
    'reserveCount', v_reserve_count
  );
end;
$func$;

revoke all on function public.admin_save_seating_assignments(jsonb) from public;
grant execute on function public.admin_save_seating_assignments(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_seating_template_from_layout(layout_id, title)
--
-- Copies geometry only (tables + connections) from a layout into a fresh
-- community-scoped template snapshot. Guests / assignments are never copied.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_seating_template_from_layout(
  p_layout_id uuid,
  p_title text
)
returns public.event_seating_layout_templates
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_user_id uuid := auth.uid();
  v_layout public.event_seating_layouts;
  v_title text := nullif(btrim(p_title), '');
  v_tables jsonb;
  v_connections jsonb;
  v_snapshot jsonb;
  v_template public.event_seating_layout_templates;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_layout_id is null then
    raise exception 'layout_id is required' using errcode = '22023';
  end if;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  select *
  into v_layout
  from public.event_seating_layouts l
  where l.id = p_layout_id;

  if not found then
    raise exception 'Seating layout not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_layout.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', st.client_table_id,
        'cx', st.cx,
        'cy', st.cy,
        'w', st.w,
        'h', st.h,
        'angle', st.angle,
        'sideSeats', st.long_side_seats,
        'isRabbiTable', st.is_rabbi_table
      )
      order by st.created_at asc, st.client_table_id asc
    ),
    '[]'::jsonb
  )
  into v_tables
  from public.event_seating_tables st
  where st.layout_id = v_layout.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'aTableId', c.from_client_table_id,
        'aEnd', c.from_end,
        'bTableId', c.to_client_table_id,
        'bEnd', c.to_end,
        'x', c.anchor_x,
        'y', c.anchor_y
      )
      order by c.created_at asc, c.id asc
    ),
    '[]'::jsonb
  )
  into v_connections
  from public.event_seating_table_connections c
  where c.layout_id = v_layout.id;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'canvas', jsonb_build_object('width', 980, 'height', 640),
    'tables', v_tables,
    'connections', v_connections
  );

  insert into public.event_seating_layout_templates (
    community_id,
    title,
    snapshot,
    is_builtin,
    is_active,
    created_by
  )
  values (
    v_layout.community_id,
    v_title,
    v_snapshot,
    false,
    true,
    v_user_id
  )
  returning * into v_template;

  return v_template;
end;
$func$;

revoke all on function public.admin_create_seating_template_from_layout(uuid, text) from public;
grant execute on function public.admin_create_seating_template_from_layout(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_delete_seating_template(template_id)
--
-- Soft delete (is_active = false). Built-in templates cannot be deleted.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_seating_template(p_template_id uuid)
returns public.event_seating_layout_templates
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_user_id uuid := auth.uid();
  v_template public.event_seating_layout_templates;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_template_id is null then
    raise exception 'template_id is required' using errcode = '22023';
  end if;

  select *
  into v_template
  from public.event_seating_layout_templates t
  where t.id = p_template_id;

  if not found then
    raise exception 'Seating template not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_template.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if v_template.is_builtin then
    raise exception 'Built-in seating templates cannot be deleted'
      using errcode = '42501';
  end if;

  update public.event_seating_layout_templates
  set is_active = false
  where id = p_template_id
  returning * into v_template;

  return v_template;
end;
$func$;

revoke all on function public.admin_delete_seating_template(uuid) from public;
grant execute on function public.admin_delete_seating_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_seating_layout_from_template(event, occurrence, unit, template)
--
-- Forks a NEW layout instance for the slot from a template snapshot: copies
-- tables / connections, snapshots the real current limit, copies NO assignments.
-- Raises if the slot already has a layout (load / delete it first).
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_seating_layout_from_template(
  p_event_id uuid,
  p_occurrence_id uuid,
  p_capacity_unit_id uuid,
  p_template_id uuid
)
returns public.event_seating_layouts
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_user_id uuid := auth.uid();
  v_community_id uuid;
  v_template public.event_seating_layout_templates;
  v_tables jsonb;
  v_connections jsonb;
  v_capacity_snapshot integer;
  v_layout public.event_seating_layouts;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_template_id is null then
    raise exception 'template_id is required' using errcode = '22023';
  end if;

  v_community_id := public.seating_slot_community(p_event_id, p_occurrence_id, p_capacity_unit_id);

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select *
  into v_template
  from public.event_seating_layout_templates t
  where t.id = p_template_id
    and t.is_active = true;

  if not found then
    raise exception 'Seating template not found' using errcode = 'P0002';
  end if;

  -- Template must live in the same community as the slot.
  if v_template.community_id <> v_community_id then
    raise exception 'Template belongs to another community' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.event_seating_layouts l
    where l.event_id = p_event_id
      and l.capacity_unit_id = p_capacity_unit_id
      and l.occurrence_id is not distinct from p_occurrence_id
  ) then
    raise exception 'A seating layout already exists for this slot'
      using errcode = '23505';
  end if;

  v_tables := coalesce(v_template.snapshot -> 'tables', '[]'::jsonb);
  v_connections := coalesce(v_template.snapshot -> 'connections', '[]'::jsonb);

  -- Defensive: a stored snapshot must still satisfy the geometry invariants.
  perform public.seating_assert_valid_tables(v_tables);

  if jsonb_typeof(v_connections) <> 'array' then
    raise exception 'Template snapshot connections must be a json array'
      using errcode = '22023';
  end if;

  select u.capacity
  into v_capacity_snapshot
  from public.event_capacity_units u
  where u.id = p_capacity_unit_id;

  insert into public.event_seating_layouts (
    community_id,
    event_id,
    occurrence_id,
    capacity_unit_id,
    template_id,
    capacity_limit_snapshot,
    seating_done,
    created_by
  )
  values (
    v_community_id,
    p_event_id,
    p_occurrence_id,
    p_capacity_unit_id,
    v_template.id,
    v_capacity_snapshot,
    false,
    v_user_id
  )
  returning * into v_layout;

  insert into public.event_seating_tables (
    layout_id,
    client_table_id,
    cx, cy, w, h,
    angle,
    long_side_seats,
    is_rabbi_table
  )
  select
    v_layout.id,
    nullif(btrim(t.value ->> 'id'), ''),
    (t.value ->> 'cx')::numeric,
    (t.value ->> 'cy')::numeric,
    (t.value ->> 'w')::numeric,
    (t.value ->> 'h')::numeric,
    coalesce((t.value ->> 'angle')::integer, 0),
    coalesce((t.value ->> 'sideSeats')::integer, (t.value ->> 'long_side_seats')::integer, 3),
    coalesce((t.value ->> 'isRabbiTable')::boolean, false)
  from jsonb_array_elements(v_tables) as t;

  insert into public.event_seating_table_connections (
    layout_id,
    from_client_table_id,
    from_end,
    to_client_table_id,
    to_end,
    anchor_x,
    anchor_y
  )
  select
    v_layout.id,
    nullif(btrim(c.value ->> 'aTableId'), ''),
    nullif(c.value ->> 'aEnd', ''),
    nullif(btrim(c.value ->> 'bTableId'), ''),
    nullif(c.value ->> 'bEnd', ''),
    nullif(c.value ->> 'x', '')::numeric,
    nullif(c.value ->> 'y', '')::numeric
  from jsonb_array_elements(v_connections) as c;

  return v_layout;
end;
$func$;

revoke all on function public.admin_create_seating_layout_from_template(uuid, uuid, uuid, uuid) from public;
grant execute on function public.admin_create_seating_layout_from_template(uuid, uuid, uuid, uuid) to authenticated;

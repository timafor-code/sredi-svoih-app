-- PR 14 fix: seating assignment validation must match the bucket-level seat
-- obligations used by registration capacity analytics and the seating guest
-- pool. Older registrations may have active option->capacity mappings without
-- durable event_registration_capacity_reservations rows, so mapped options are
-- accepted here as read-only obligations. Donation-only and inactive
-- registrations are still rejected.

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

  delete from public.event_seating_assignments where layout_id = v_layout_id;

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

      if not exists (
        select 1
        from public.event_registrations r
        where r.id = v_registration_id
          and r.event_id = v_event_id
          and r.occurrence_id is not distinct from v_occurrence_id
          and r.status in ('confirmed', 'pending', 'attended')
          and (
            exists (
              select 1
              from public.event_registration_capacity_reservations cr
              where cr.registration_id = r.id
                and cr.event_id = v_event_id
                and cr.capacity_unit_id = v_unit_id
                and cr.occurrence_id is not distinct from v_occurrence_id
            )
            or exists (
              select 1
              from public.event_registration_option_selections eros
              join public.event_participation_option_capacity_units map
                on map.option_id = eros.option_id
               and map.event_id = v_event_id
               and map.capacity_unit_id = v_unit_id
              where eros.registration_id = r.id
                and eros.option_id is not null
                and eros.quantity > 0
                and eros.is_donation is not true
                and eros.counts_toward_capacity is true
            )
          )
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

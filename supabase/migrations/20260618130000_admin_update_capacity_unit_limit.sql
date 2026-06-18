-- PR 19: explicit admin action to update the registration business limit for a
-- capacity unit. Seating geometry never syncs this automatically.

create or replace function public.admin_update_capacity_unit_limit(
  capacity_unit_id uuid,
  new_capacity integer
)
returns public.event_capacity_units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_capacity_unit_id uuid := capacity_unit_id;
  v_new_capacity integer := new_capacity;
  v_unit public.event_capacity_units;
  v_community_id uuid;
  v_occupied_seats integer := 0;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_capacity_unit_id is null then
    raise exception 'capacity_unit_id is required' using errcode = '22023';
  end if;

  if v_new_capacity is not null and v_new_capacity <= 0 then
    raise exception 'new_capacity must be greater than 0'
      using errcode = '22023';
  end if;

  select ecu.*
  into v_unit
  from public.event_capacity_units ecu
  where ecu.id = v_capacity_unit_id
  for update;

  if not found then
    raise exception 'Capacity unit not found' using errcode = 'P0002';
  end if;

  select e.community_id
  into v_community_id
  from public.events e
  where e.id = v_unit.event_id;

  if not public.has_community_role(
    v_community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  -- The capacity unit limit applies per event/occurrence registration scope. The
  -- RPC receives only the unit id, so lowering is allowed only if the new limit
  -- can hold the most-occupied active scope for this unit.
  select coalesce(max(scope_occupied), 0)
  into v_occupied_seats
  from (
    select coalesce(sum(ecr.seats_count), 0)::integer as scope_occupied
    from public.event_registration_capacity_reservations ecr
    join public.event_registrations r
      on r.id = ecr.registration_id
     and r.event_id = ecr.event_id
    where ecr.event_id = v_unit.event_id
      and ecr.capacity_unit_id = v_capacity_unit_id
      and r.status in ('confirmed', 'pending', 'attended', 'no_show')
    group by ecr.occurrence_id
  ) occupied_by_scope;

  if v_new_capacity is not null and v_new_capacity < v_occupied_seats then
    raise exception 'Capacity cannot be lower than occupied seats'
      using
        errcode = 'P0001',
        detail = format(
          'new_capacity=%s occupied_seats=%s capacity_unit_id=%s',
          v_new_capacity,
          v_occupied_seats,
          v_capacity_unit_id
        );
  end if;

  update public.event_capacity_units ecu
  set capacity = v_new_capacity
  where ecu.id = v_capacity_unit_id
  returning ecu.* into v_unit;

  return v_unit;
end;
$$;

revoke all on function public.admin_update_capacity_unit_limit(uuid, integer) from public;
grant execute on function public.admin_update_capacity_unit_limit(uuid, integer) to authenticated;

-- Registration capacity reservations.
-- Adds durable seat reservations for mapped event capacity units and keeps
-- legacy event/occurrence capacity behavior for unmapped options.

create table if not exists public.event_registration_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_id uuid references public.event_occurrences(id) on delete cascade,
  capacity_unit_id uuid not null references public.event_capacity_units(id) on delete restrict,
  option_id uuid references public.event_participation_options(id) on delete set null,

  capacity_unit_key_snapshot text not null,
  capacity_unit_title_snapshot text not null,
  option_title_snapshot text,

  quantity integer not null default 1,
  seats_per_quantity integer not null default 1,
  seats_count integer not null,

  created_at timestamptz not null default now(),

  constraint event_registration_capacity_reservations_quantity_check
    check (quantity > 0),

  constraint event_registration_capacity_reservations_seats_per_quantity_check
    check (seats_per_quantity > 0),

  constraint event_registration_capacity_reservations_seats_count_check
    check (seats_count > 0),

  constraint event_registration_capacity_reservations_unit_key_not_empty
    check (btrim(capacity_unit_key_snapshot) <> ''),

  constraint event_registration_capacity_reservations_unit_title_not_empty
    check (btrim(capacity_unit_title_snapshot) <> '')
);

create index if not exists event_registration_capacity_reservations_registration_id_idx
  on public.event_registration_capacity_reservations(registration_id);

create index if not exists event_registration_capacity_reservations_event_occurrence_idx
  on public.event_registration_capacity_reservations(event_id, occurrence_id);

create index if not exists event_registration_capacity_reservations_capacity_unit_idx
  on public.event_registration_capacity_reservations(capacity_unit_id);

create index if not exists event_registration_capacity_reservations_event_unit_occurrence_idx
  on public.event_registration_capacity_reservations(event_id, capacity_unit_id, occurrence_id);

alter table public.event_registration_capacity_reservations enable row level security;

drop policy if exists "event_registration_capacity_reservations_select_own"
  on public.event_registration_capacity_reservations;

create policy "event_registration_capacity_reservations_select_own"
on public.event_registration_capacity_reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.event_registrations r
    where r.id = event_registration_capacity_reservations.registration_id
      and r.user_id = auth.uid()
  )
);

drop policy if exists "event_registration_capacity_reservations_select_by_manager"
  on public.event_registration_capacity_reservations;

create policy "event_registration_capacity_reservations_select_by_manager"
on public.event_registration_capacity_reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_registration_capacity_reservations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_registration_capacity_reservations_manage_by_manager"
  on public.event_registration_capacity_reservations;

create policy "event_registration_capacity_reservations_manage_by_manager"
on public.event_registration_capacity_reservations
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_registration_capacity_reservations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_registration_capacity_reservations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

grant select on public.event_registration_capacity_reservations to authenticated;
grant insert, update, delete on public.event_registration_capacity_reservations to authenticated;

create or replace function public.register_for_event_occurrence_with_options(
  p_event_id uuid,
  p_occurrence_id uuid,
  p_option_selections jsonb default '[]'::jsonb,
  p_comment text default null
)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_occurrence public.event_occurrences;
  v_registration public.event_registrations;
  v_existing_registration public.event_registrations;
  v_option public.event_participation_options;
  v_option_selections jsonb := coalesce(p_option_selections, '[]'::jsonb);
  v_selection jsonb;
  v_seen_option_ids uuid[] := array[]::uuid[];
  v_option_id uuid;
  v_option_id_text text;
  v_quantity integer;
  v_quantity_text text;
  v_option_seats integer;
  v_line_total integer;
  v_registration_seats_count integer := 0;
  v_legacy_seats_count integer := 0;
  v_taken_seats integer := 0;
  v_effective_capacity integer;
  v_status text;
  v_payment_status text;
  v_has_non_donation_selection boolean := false;
  v_now timestamptz := now();
  v_capacity_reservations jsonb := '[]'::jsonb;
  v_mapping record;
  v_has_capacity_mappings boolean;
  v_unit_request record;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_event_id is null then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  if p_occurrence_id is null then
    raise exception 'occurrence_id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(v_option_selections) <> 'array' then
    raise exception 'option_selections must be a JSON array' using errcode = '22023';
  end if;

  select *
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if v_event.status <> 'published' then
    raise exception 'Event is not published' using errcode = 'P0002';
  end if;

  if v_event.registration_mode in ('external_link', 'none') then
    raise exception 'Internal registration is not available for this event' using errcode = '22023';
  end if;

  if v_event.registration_mode not in ('internal_free', 'internal_paid') then
    raise exception 'Unsupported registration mode' using errcode = '22023';
  end if;

  if v_event.visibility = 'public' then
    null;
  elsif v_event.visibility = 'members_only' then
    if not public.is_active_member(v_event.community_id) then
      raise exception 'Community membership required' using errcode = '42501';
    end if;
  else
    raise exception 'Event is not available for registration' using errcode = 'P0002';
  end if;

  select *
  into v_occurrence
  from public.event_occurrences eo
  where eo.id = p_occurrence_id
    and eo.event_id = p_event_id
  for update;

  if not found then
    raise exception 'Occurrence not found for this event' using errcode = 'P0002';
  end if;

  if v_occurrence.status <> 'active' then
    raise exception 'Occurrence is not active' using errcode = '22023';
  end if;

  if v_occurrence.registration_opens_at is not null
     and v_now < v_occurrence.registration_opens_at then
    raise exception 'Registration is not open yet for this occurrence' using errcode = 'P0001';
  end if;

  if v_occurrence.registration_closes_at is not null
     and v_now > v_occurrence.registration_closes_at then
    raise exception 'Registration is closed for this occurrence' using errcode = 'P0001';
  end if;

  select *
  into v_existing_registration
  from public.event_registrations r
  where r.event_id = p_event_id
    and r.user_id = v_user_id
    and r.occurrence_id = p_occurrence_id
    and r.status in ('pending', 'confirmed', 'waitlisted')
  order by r.registered_at desc, r.created_at desc
  limit 1
  for update;

  if found then
    return v_existing_registration;
  end if;

  if v_event.registration_mode = 'internal_paid'
     and jsonb_array_length(v_option_selections) = 0 then
    raise exception 'Select at least one participation option' using errcode = '22023';
  end if;

  for v_selection in
    select value
    from jsonb_array_elements(v_option_selections) as selection(value)
  loop
    if jsonb_typeof(v_selection) <> 'object' then
      raise exception 'Each option selection must be a JSON object' using errcode = '22023';
    end if;

    v_option_id_text := nullif(
      btrim(coalesce(v_selection ->> 'optionId', v_selection ->> 'option_id')),
      ''
    );

    if v_option_id_text is null then
      raise exception 'optionId is required for every selection' using errcode = '22023';
    end if;

    v_option_id := v_option_id_text::uuid;

    if v_option_id = any(v_seen_option_ids) then
      raise exception 'Duplicate participation option selection' using errcode = '22023';
    end if;

    v_seen_option_ids := array_append(v_seen_option_ids, v_option_id);

    v_quantity_text := nullif(btrim(coalesce(v_selection ->> 'quantity', '')), '');

    if v_quantity_text is null or v_quantity_text !~ '^[0-9]+$' then
      raise exception 'quantity must be a positive integer' using errcode = '22023';
    end if;

    v_quantity := v_quantity_text::integer;

    if v_quantity <= 0 then
      raise exception 'quantity must be greater than zero' using errcode = '22023';
    end if;

    select *
    into v_option
    from public.event_participation_options epo
    where epo.id = v_option_id
    for update;

    if not found then
      raise exception 'Participation option not found' using errcode = 'P0002';
    end if;

    if v_option.event_id <> p_event_id then
      raise exception 'Participation option does not belong to this event' using errcode = '22023';
    end if;

    if v_option.is_active is not true then
      raise exception 'Participation option is inactive' using errcode = '22023';
    end if;

    if v_option.allow_quantity is not true and v_quantity <> 1 then
      raise exception 'Quantity is not allowed for this participation option' using errcode = '22023';
    end if;

    if v_quantity < v_option.min_quantity or v_quantity > v_option.max_quantity then
      raise exception 'quantity is outside the allowed range for this option' using errcode = '22023';
    end if;

    if v_event.registration_mode = 'internal_free'
       and v_option.is_donation is not true
       and v_option.price_amount > 0 then
      raise exception 'Paid participation options require internal_paid registration' using errcode = '22023';
    end if;

    v_option_seats := case
      when v_option.is_donation then 0
      when v_option.counts_toward_capacity then v_quantity
      else 0
    end;

    if v_option.seat_limit is not null and v_option_seats > v_option.seat_limit then
      raise exception 'Participation option seat limit exceeded' using errcode = 'P0001';
    end if;

    if v_option.is_donation is not true then
      v_has_non_donation_selection := true;
    end if;

    v_registration_seats_count := v_registration_seats_count + v_option_seats;

    if v_option.is_donation is not true and v_option.counts_toward_capacity then
      v_has_capacity_mappings := false;

      for v_mapping in
        select
          epocu.capacity_unit_id,
          epocu.seats_per_quantity,
          ecu.key as capacity_unit_key,
          ecu.title as capacity_unit_title
        from public.event_participation_option_capacity_units epocu
        join public.event_capacity_units ecu
          on ecu.id = epocu.capacity_unit_id
         and ecu.event_id = epocu.event_id
        where epocu.event_id = p_event_id
          and epocu.option_id = v_option.id
        order by epocu.capacity_unit_id
      loop
        v_has_capacity_mappings := true;
        v_capacity_reservations := v_capacity_reservations || jsonb_build_array(
          jsonb_build_object(
            'capacity_unit_id', v_mapping.capacity_unit_id,
            'option_id', v_option.id,
            'capacity_unit_key_snapshot', v_mapping.capacity_unit_key,
            'capacity_unit_title_snapshot', v_mapping.capacity_unit_title,
            'option_title_snapshot', v_option.title,
            'quantity', v_quantity,
            'seats_per_quantity', v_mapping.seats_per_quantity,
            'seats_count', v_quantity * v_mapping.seats_per_quantity
          )
        );
      end loop;

      if not v_has_capacity_mappings then
        v_legacy_seats_count := v_legacy_seats_count + v_option_seats;
      end if;
    end if;
  end loop;

  if v_event.registration_mode = 'internal_paid' then
    if not v_has_non_donation_selection then
      raise exception 'Select at least one non-donation participation option' using errcode = '22023';
    end if;

    if v_registration_seats_count <= 0 then
      raise exception 'Select at least one option that reserves a seat' using errcode = '22023';
    end if;
  elsif v_registration_seats_count <= 0 then
    v_registration_seats_count := 1;
    v_legacy_seats_count := 1;
  end if;

  if jsonb_array_length(v_capacity_reservations) > 0 then
    perform ecu.id
    from public.event_capacity_units ecu
    where ecu.event_id = p_event_id
      and exists (
        select 1
        from jsonb_to_recordset(v_capacity_reservations) as reservation(
          capacity_unit_id uuid
        )
        where reservation.capacity_unit_id = ecu.id
      )
    order by ecu.id
    for update;

    for v_unit_request in
      select
        reservation.capacity_unit_id,
        ecu.capacity,
        sum(reservation.seats_count)::integer as requested_seats
      from jsonb_to_recordset(v_capacity_reservations) as reservation(
        capacity_unit_id uuid,
        seats_count integer
      )
      join public.event_capacity_units ecu
        on ecu.id = reservation.capacity_unit_id
       and ecu.event_id = p_event_id
      group by reservation.capacity_unit_id, ecu.capacity
      order by reservation.capacity_unit_id
    loop
      v_effective_capacity := coalesce(
        v_unit_request.capacity,
        v_occurrence.capacity,
        v_event.capacity
      );

      if v_effective_capacity is not null then
        select coalesce(sum(ecr.seats_count), 0)
        into v_taken_seats
        from public.event_registration_capacity_reservations ecr
        join public.event_registrations r
          on r.id = ecr.registration_id
        where ecr.event_id = p_event_id
          and ecr.capacity_unit_id = v_unit_request.capacity_unit_id
          and (
            (p_occurrence_id is not null and ecr.occurrence_id = p_occurrence_id)
            or (p_occurrence_id is null and ecr.occurrence_id is null)
          )
          and r.status in ('confirmed', 'pending', 'attended', 'no_show');

        if v_taken_seats + v_unit_request.requested_seats > v_effective_capacity then
          raise exception 'No seats available for this capacity unit' using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  if v_legacy_seats_count > 0 then
    v_effective_capacity := coalesce(v_occurrence.capacity, v_event.capacity);

    select coalesce(sum(r.seats_count), 0)
    into v_taken_seats
    from public.event_registrations r
    where r.event_id = p_event_id
      and r.occurrence_id = p_occurrence_id
      and r.status in ('confirmed', 'pending', 'waitlisted');

    if v_effective_capacity is not null
       and v_taken_seats + v_legacy_seats_count > v_effective_capacity then
      raise exception 'No seats available for this occurrence' using errcode = 'P0001';
    end if;
  end if;

  if v_event.registration_mode = 'internal_paid' then
    v_status := 'pending';
    v_payment_status := 'pending';
  else
    v_status := 'confirmed';
    v_payment_status := 'not_required';
  end if;

  insert into public.event_registrations (
    event_id,
    occurrence_id,
    user_id,
    status,
    seats_count,
    comment,
    registered_at,
    confirmed_at,
    payment_status,
    payment_id
  )
  values (
    p_event_id,
    p_occurrence_id,
    v_user_id,
    v_status,
    v_registration_seats_count,
    nullif(btrim(coalesce(p_comment, '')), ''),
    v_now,
    case when v_status = 'confirmed' then v_now else null end,
    v_payment_status,
    null
  )
  returning * into v_registration;

  for v_selection in
    select value
    from jsonb_array_elements(v_option_selections) as selection(value)
  loop
    v_option_id := (coalesce(v_selection ->> 'optionId', v_selection ->> 'option_id'))::uuid;
    v_quantity := (v_selection ->> 'quantity')::integer;

    select *
    into v_option
    from public.event_participation_options epo
    where epo.id = v_option_id;

    v_option_seats := case
      when v_option.is_donation then 0
      when v_option.counts_toward_capacity then v_quantity
      else 0
    end;
    v_line_total := v_option.price_amount * v_quantity;

    insert into public.event_registration_option_selections (
      registration_id,
      option_id,
      title_snapshot,
      description_snapshot,
      option_type_snapshot,
      quantity,
      unit_price_amount,
      total_amount,
      currency,
      counts_toward_capacity,
      seats_count,
      is_donation
    )
    values (
      v_registration.id,
      v_option.id,
      v_option.title,
      v_option.description,
      v_option.option_type,
      v_quantity,
      v_option.price_amount,
      v_line_total,
      v_option.price_currency,
      case when v_option.is_donation then false else v_option.counts_toward_capacity end,
      v_option_seats,
      v_option.is_donation
    );
  end loop;

  insert into public.event_registration_capacity_reservations (
    registration_id,
    event_id,
    occurrence_id,
    capacity_unit_id,
    option_id,
    capacity_unit_key_snapshot,
    capacity_unit_title_snapshot,
    option_title_snapshot,
    quantity,
    seats_per_quantity,
    seats_count
  )
  select
    v_registration.id,
    p_event_id,
    p_occurrence_id,
    reservation.capacity_unit_id,
    reservation.option_id,
    reservation.capacity_unit_key_snapshot,
    reservation.capacity_unit_title_snapshot,
    reservation.option_title_snapshot,
    reservation.quantity,
    reservation.seats_per_quantity,
    reservation.seats_count
  from jsonb_to_recordset(v_capacity_reservations) as reservation(
    capacity_unit_id uuid,
    option_id uuid,
    capacity_unit_key_snapshot text,
    capacity_unit_title_snapshot text,
    option_title_snapshot text,
    quantity integer,
    seats_per_quantity integer,
    seats_count integer
  );

  return v_registration;
end;
$$;

revoke all on function public.register_for_event_occurrence_with_options(uuid, uuid, jsonb, text) from public;
grant execute on function public.register_for_event_occurrence_with_options(uuid, uuid, jsonb, text) to authenticated;

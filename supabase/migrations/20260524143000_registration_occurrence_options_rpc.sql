-- Backend foundation for registering an authenticated user for one concrete
-- event occurrence with saved participation option snapshots.
--
-- This does not change the legacy register_for_event RPC and does not
-- integrate a production payment gateway.

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
  v_seats_count integer := 0;
  v_taken_seats integer := 0;
  v_effective_capacity integer;
  v_status text;
  v_payment_status text;
  v_has_non_donation_selection boolean := false;
  v_now timestamptz := now();
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

    v_seats_count := v_seats_count + v_option_seats;
  end loop;

  if v_event.registration_mode = 'internal_paid' then
    if not v_has_non_donation_selection then
      raise exception 'Select at least one non-donation participation option' using errcode = '22023';
    end if;

    if v_seats_count <= 0 then
      raise exception 'Select at least one option that reserves a seat' using errcode = '22023';
    end if;
  elsif v_seats_count <= 0 then
    v_seats_count := 1;
  end if;

  v_effective_capacity := coalesce(v_occurrence.capacity, v_event.capacity);

  select coalesce(sum(r.seats_count), 0)
  into v_taken_seats
  from public.event_registrations r
  where r.event_id = p_event_id
    and r.occurrence_id = p_occurrence_id
    and r.status in ('confirmed', 'pending', 'waitlisted');

  if v_effective_capacity is not null
     and v_taken_seats + v_seats_count > v_effective_capacity then
    raise exception 'No seats available for this occurrence' using errcode = 'P0001';
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
    v_seats_count,
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

  return v_registration;
end;
$$;

revoke all on function public.register_for_event_occurrence_with_options(uuid, uuid, jsonb, text) from public;
grant execute on function public.register_for_event_occurrence_with_options(uuid, uuid, jsonb, text) to authenticated;

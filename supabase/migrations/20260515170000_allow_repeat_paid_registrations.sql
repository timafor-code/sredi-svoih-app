-- Allow a user to create multiple active registrations for the same
-- event + occurrence (used by the paid simulated flow so a person can
-- book themselves, a guest, or a charity slot as separate rows).
--
-- The unique active indexes added in
-- 20260515133000_event_registration_occurrence_uniqueness.sql blocked
-- this. Drop them. internal_free still avoids duplicates via the
-- register_for_event RPC which short-circuits when an active row exists.

drop index if exists public.event_registrations_event_user_occurrence_active_unique;
drop index if exists public.event_registrations_event_user_no_occurrence_active_unique;

alter table public.event_registrations
  drop constraint if exists event_registrations_event_id_user_id_key;

create or replace function public.register_for_paid_event_simulated(payload jsonb)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_event public.events;
  v_occurrence public.event_occurrences;
  v_registration public.event_registrations;
  v_selection jsonb;
  v_option public.event_participation_options;
  v_event_id uuid;
  v_event_id_text text;
  v_occurrence_id uuid;
  v_occurrence_id_text text;
  v_option_id uuid;
  v_option_id_text text;
  v_quantity integer;
  v_quantity_text text;
  v_guest_names jsonb;
  v_comment text;
  v_option_selections jsonb;
  v_seen_option_ids uuid[] := array[]::uuid[];
  v_has_occurrences boolean := false;
  v_taken_seats integer := 0;
  v_seats_count integer := 0;
  v_option_seats integer := 0;
  v_total_amount bigint := 0;
  v_line_total integer := 0;
  v_effective_capacity integer;
  v_effective_waitlist_enabled boolean;
  v_effective_requires_approval boolean;
  v_status text;
  v_registration_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  v_event_id_text := nullif(btrim(coalesce(v_payload ->> 'eventId', v_payload ->> 'event_id')), '');
  if v_event_id_text is null then
    raise exception 'eventId is required' using errcode = '22023';
  end if;

  v_event_id := v_event_id_text::uuid;

  select *
  into v_event
  from public.events
  where id = v_event_id
    and status = 'published'
    and registration_mode = 'internal_paid'
  for update;

  if not found then
    raise exception 'Paid event is not available for registration' using errcode = 'P0002';
  end if;

  if v_event.visibility = 'members_only'
     and not public.is_active_member(v_event.community_id) then
    raise exception 'Community membership required' using errcode = '42501';
  end if;

  v_occurrence_id_text := nullif(
    btrim(coalesce(v_payload ->> 'occurrenceId', v_payload ->> 'occurrence_id')),
    ''
  );

  select exists (
    select 1
    from public.event_occurrences eo
    where eo.event_id = v_event_id
  )
  into v_has_occurrences;

  if v_has_occurrences and v_occurrence_id_text is null then
    raise exception 'occurrenceId is required for this event' using errcode = '22023';
  end if;

  if v_occurrence_id_text is not null then
    v_occurrence_id := v_occurrence_id_text::uuid;

    select *
    into v_occurrence
    from public.event_occurrences eo
    where eo.id = v_occurrence_id
      and eo.event_id = v_event_id
      and eo.status = 'active'
    for update;

    if not found then
      raise exception 'Occurrence not found for this event' using errcode = 'P0002';
    end if;
  end if;

  v_guest_names := coalesce(v_payload -> 'guestNames', v_payload -> 'guest_names', '[]'::jsonb);
  if jsonb_typeof(v_guest_names) <> 'array' then
    raise exception 'guestNames must be a JSON array' using errcode = '22023';
  end if;

  v_comment := nullif(btrim(coalesce(v_payload ->> 'comment', '')), '');
  v_option_selections := coalesce(
    v_payload -> 'optionSelections',
    v_payload -> 'option_selections',
    '[]'::jsonb
  );

  if jsonb_typeof(v_option_selections) <> 'array' then
    raise exception 'optionSelections must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(v_option_selections) = 0 then
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
    if v_quantity_text is null then
      raise exception 'quantity is required for every selection' using errcode = '22023';
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

    if v_option.event_id <> v_event_id then
      raise exception 'Participation option does not belong to this event' using errcode = '22023';
    end if;

    if v_option.is_active is not true then
      raise exception 'Participation option is inactive' using errcode = '22023';
    end if;

    v_option_seats := case
      when v_option.is_donation then 0
      when v_option.counts_toward_capacity then v_quantity
      else 0
    end;
    v_line_total := v_option.price_amount * v_quantity;
    v_seats_count := v_seats_count + v_option_seats;
    v_total_amount := v_total_amount + v_line_total;
  end loop;

  if v_seats_count <= 0 then
    raise exception 'Select at least one option that reserves a seat' using errcode = '22023';
  end if;

  v_effective_capacity := case
    when v_occurrence_id is not null then coalesce(v_occurrence.capacity, v_event.capacity)
    else v_event.capacity
  end;
  v_effective_waitlist_enabled := case
    when v_occurrence_id is not null then coalesce(v_occurrence.waitlist_enabled, v_event.waitlist_enabled)
    else v_event.waitlist_enabled
  end;
  v_effective_requires_approval := case
    when v_occurrence_id is not null then coalesce(v_occurrence.requires_approval, v_event.requires_approval)
    else v_event.requires_approval
  end;

  if v_occurrence_id is not null then
    select coalesce(sum(r.seats_count), 0)
    into v_taken_seats
    from public.event_registrations r
    where r.event_id = v_event_id
      and r.occurrence_id = v_occurrence_id
      and r.status in ('confirmed', 'pending');
  else
    select coalesce(sum(r.seats_count), 0)
    into v_taken_seats
    from public.event_registrations r
    where r.event_id = v_event_id
      and r.status in ('confirmed', 'pending');
  end if;

  if v_effective_capacity is not null
     and v_taken_seats + v_seats_count > v_effective_capacity then
    if v_effective_waitlist_enabled then
      v_status := 'waitlisted';
    else
      raise exception 'No seats available for this event' using errcode = 'P0001';
    end if;
  elsif v_effective_requires_approval then
    v_status := 'pending';
  else
    v_status := 'confirmed';
  end if;

  insert into public.event_registrations (
    id,
    event_id,
    occurrence_id,
    user_id,
    status,
    seats_count,
    guest_names,
    comment,
    registered_at,
    confirmed_at,
    payment_status,
    payment_id
  )
  values (
    v_registration_id,
    v_event_id,
    v_occurrence_id,
    v_user_id,
    v_status,
    v_seats_count,
    v_guest_names,
    v_comment,
    now(),
    case when v_status = 'confirmed' then now() else null end,
    'succeeded',
    'simulated:' || v_registration_id::text
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

revoke all on function public.register_for_paid_event_simulated(jsonb) from public;
grant execute on function public.register_for_paid_event_simulated(jsonb) to authenticated;

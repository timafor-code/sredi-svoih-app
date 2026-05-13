-- Admin registrations RPC foundation for web-admin.

create or replace function public.admin_list_registration_events()
returns table (
  event_id uuid,
  title text,
  starts_at timestamptz,
  event_kind text,
  registration_mode text,
  occurrence_count integer,
  confirmed_count integer,
  pending_count integer,
  waitlisted_count integer,
  cancelled_count integer,
  rejected_count integer,
  attended_count integer,
  no_show_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  return query
  with occurrence_counts as (
    select
      eo.event_id,
      count(*)::integer as occurrence_count
    from public.event_occurrences eo
    group by eo.event_id
  ),
  registration_counts as (
    select
      r.event_id,
      count(*) filter (where r.status = 'confirmed')::integer as confirmed_count,
      count(*) filter (where r.status = 'pending')::integer as pending_count,
      count(*) filter (where r.status = 'waitlisted')::integer as waitlisted_count,
      count(*) filter (where r.status = 'cancelled')::integer as cancelled_count,
      count(*) filter (where r.status = 'rejected')::integer as rejected_count,
      count(*) filter (where r.status = 'attended')::integer as attended_count,
      count(*) filter (where r.status = 'no_show')::integer as no_show_count
    from public.event_registrations r
    group by r.event_id
  )
  select
    e.id as event_id,
    e.title,
    e.starts_at,
    coalesce(e.event_kind, 'single') as event_kind,
    e.registration_mode,
    coalesce(oc.occurrence_count, 0) as occurrence_count,
    coalesce(rc.confirmed_count, 0) as confirmed_count,
    coalesce(rc.pending_count, 0) as pending_count,
    coalesce(rc.waitlisted_count, 0) as waitlisted_count,
    coalesce(rc.cancelled_count, 0) as cancelled_count,
    coalesce(rc.rejected_count, 0) as rejected_count,
    coalesce(rc.attended_count, 0) as attended_count,
    coalesce(rc.no_show_count, 0) as no_show_count
  from public.events e
  left join occurrence_counts oc
    on oc.event_id = e.id
  left join registration_counts rc
    on rc.event_id = e.id
  where public.has_community_role(e.community_id, array['admin', 'event_manager'])
  order by e.starts_at asc nulls last, e.created_at desc;
end;
$$;

create or replace function public.admin_list_event_registrations(payload jsonb)
returns table (
  id uuid,
  event_id uuid,
  occurrence_id uuid,
  user_id uuid,
  participant_display_name text,
  email text,
  phone text,
  status text,
  seats_count integer,
  guest_names jsonb,
  comment text,
  payment_status text,
  payment_id uuid,
  registered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  occurrence_starts_at timestamptz,
  occurrence_ends_at timestamptz,
  occurrence_title text,
  selected_options jsonb,
  total_amount bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_event public.events;
  v_event_id uuid;
  v_event_id_text text;
  v_occurrence_id uuid;
  v_occurrence_id_text text;
  v_status text;
  v_search text;
  v_limit integer := 100;
  v_offset integer := 0;
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
  where events.id = v_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_event.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  v_occurrence_id_text := nullif(
    btrim(coalesce(v_payload ->> 'occurrenceId', v_payload ->> 'occurrence_id')),
    ''
  );

  if v_occurrence_id_text is not null then
    v_occurrence_id := v_occurrence_id_text::uuid;

    if not exists (
      select 1
      from public.event_occurrences eo
      where eo.id = v_occurrence_id
        and eo.event_id = v_event_id
    ) then
      raise exception 'Occurrence not found' using errcode = 'P0002';
    end if;
  end if;

  v_status := nullif(btrim(coalesce(v_payload ->> 'status', '')), '');
  if v_status is not null then
    v_status := lower(v_status);

    if v_status = 'all' then
      v_status := null;
    elsif v_status not in (
      'pending',
      'confirmed',
      'waitlisted',
      'cancelled',
      'rejected',
      'attended',
      'no_show'
    ) then
      raise exception 'Invalid registration status' using errcode = '22023';
    end if;
  end if;

  v_search := nullif(btrim(coalesce(v_payload ->> 'search', '')), '');

  if nullif(v_payload ->> 'limit', '') is not null then
    v_limit := (v_payload ->> 'limit')::integer;
  end if;

  if nullif(v_payload ->> 'offset', '') is not null then
    v_offset := (v_payload ->> 'offset')::integer;
  end if;

  v_limit := least(greatest(coalesce(v_limit, 100), 1), 200);
  v_offset := greatest(coalesce(v_offset, 0), 0);

  return query
  select
    r.id,
    r.event_id,
    r.occurrence_id,
    r.user_id,
    coalesce(
      nullif(p.display_name, ''),
      nullif(p.full_name, ''),
      nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      nullif(p.email, ''),
      r.user_id::text
    ) as participant_display_name,
    p.email,
    p.phone,
    r.status,
    r.seats_count,
    r.guest_names,
    r.comment,
    r.payment_status,
    r.payment_id,
    r.registered_at,
    r.confirmed_at,
    r.cancelled_at,
    eo.starts_at as occurrence_starts_at,
    eo.ends_at as occurrence_ends_at,
    eo.title as occurrence_title,
    coalesce(selections.selected_options, '[]'::jsonb) as selected_options,
    selections.total_amount,
    r.created_at,
    r.updated_at
  from public.event_registrations r
  left join public.profiles p
    on p.id = r.user_id
  left join public.event_occurrences eo
    on eo.id = r.occurrence_id
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'id', eros.id,
          'optionId', eros.option_id,
          'title', eros.title_snapshot,
          'description', eros.description_snapshot,
          'optionType', eros.option_type_snapshot,
          'quantity', eros.quantity,
          'unitPriceAmount', eros.unit_price_amount,
          'totalAmount', eros.total_amount,
          'currency', eros.currency,
          'countsTowardCapacity', eros.counts_toward_capacity,
          'seatsCount', eros.seats_count,
          'isDonation', eros.is_donation,
          'createdAt', eros.created_at
        )
        order by eros.created_at asc, eros.id asc
      ) as selected_options,
      case
        when count(*) = 0 then null
        else sum(eros.total_amount)::bigint
      end as total_amount
    from public.event_registration_option_selections eros
    where eros.registration_id = r.id
  ) selections on true
  where r.event_id = v_event_id
    and (v_occurrence_id is null or r.occurrence_id = v_occurrence_id)
    and (v_status is null or r.status = v_status)
    and (
      v_search is null
      or coalesce(p.display_name, '') ilike '%' || v_search || '%'
      or coalesce(p.full_name, '') ilike '%' || v_search || '%'
      or concat_ws(' ', p.first_name, p.last_name) ilike '%' || v_search || '%'
      or coalesce(p.email, '') ilike '%' || v_search || '%'
      or coalesce(p.phone, '') ilike '%' || v_search || '%'
      or coalesce(r.comment, '') ilike '%' || v_search || '%'
      or r.guest_names::text ilike '%' || v_search || '%'
    )
  order by r.registered_at desc, r.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.admin_update_registration_status(
  registration_id uuid,
  next_status text,
  reason text default null
)
returns table (
  id uuid,
  event_id uuid,
  occurrence_id uuid,
  user_id uuid,
  participant_display_name text,
  email text,
  phone text,
  status text,
  seats_count integer,
  guest_names jsonb,
  comment text,
  payment_status text,
  payment_id uuid,
  registered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  occurrence_starts_at timestamptz,
  occurrence_ends_at timestamptz,
  occurrence_title text,
  selected_options jsonb,
  total_amount bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration public.event_registrations;
  v_community_id uuid;
  v_next_status text := lower(btrim(coalesce(next_status, '')));
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if registration_id is null then
    raise exception 'registration_id is required' using errcode = '22023';
  end if;

  if v_next_status not in ('pending', 'confirmed', 'waitlisted', 'cancelled', 'rejected') then
    raise exception 'Invalid registration status' using errcode = '22023';
  end if;

  select r.*
  into v_registration
  from public.event_registrations r
  where r.id = registration_id
  for update;

  if not found then
    raise exception 'Registration not found' using errcode = 'P0002';
  end if;

  select e.community_id
  into v_community_id
  from public.events e
  where e.id = v_registration.event_id;

  if v_community_id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  update public.event_registrations r
  set
    status = v_next_status,
    confirmed_at = case
      when v_next_status = 'confirmed' then coalesce(r.confirmed_at, now())
      when r.status = 'confirmed' and v_next_status in ('pending', 'waitlisted') then null
      else r.confirmed_at
    end,
    cancelled_at = case
      when v_next_status in ('cancelled', 'rejected') then coalesce(r.cancelled_at, now())
      when v_next_status in ('pending', 'confirmed', 'waitlisted') then null
      else r.cancelled_at
    end,
    updated_at = now()
  where r.id = v_registration.id
  returning r.* into v_registration;

  return query
  select
    r.id,
    r.event_id,
    r.occurrence_id,
    r.user_id,
    coalesce(
      nullif(p.display_name, ''),
      nullif(p.full_name, ''),
      nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      nullif(p.email, ''),
      r.user_id::text
    ) as participant_display_name,
    p.email,
    p.phone,
    r.status,
    r.seats_count,
    r.guest_names,
    r.comment,
    r.payment_status,
    r.payment_id,
    r.registered_at,
    r.confirmed_at,
    r.cancelled_at,
    eo.starts_at as occurrence_starts_at,
    eo.ends_at as occurrence_ends_at,
    eo.title as occurrence_title,
    coalesce(selections.selected_options, '[]'::jsonb) as selected_options,
    selections.total_amount,
    r.created_at,
    r.updated_at
  from public.event_registrations r
  left join public.profiles p
    on p.id = r.user_id
  left join public.event_occurrences eo
    on eo.id = r.occurrence_id
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'id', eros.id,
          'optionId', eros.option_id,
          'title', eros.title_snapshot,
          'description', eros.description_snapshot,
          'optionType', eros.option_type_snapshot,
          'quantity', eros.quantity,
          'unitPriceAmount', eros.unit_price_amount,
          'totalAmount', eros.total_amount,
          'currency', eros.currency,
          'countsTowardCapacity', eros.counts_toward_capacity,
          'seatsCount', eros.seats_count,
          'isDonation', eros.is_donation,
          'createdAt', eros.created_at
        )
        order by eros.created_at asc, eros.id asc
      ) as selected_options,
      case
        when count(*) = 0 then null
        else sum(eros.total_amount)::bigint
      end as total_amount
    from public.event_registration_option_selections eros
    where eros.registration_id = r.id
  ) selections on true
  where r.id = v_registration.id;
end;
$$;

create or replace function public.admin_mark_registration_attendance(
  registration_id uuid,
  attendance_status text
)
returns table (
  id uuid,
  event_id uuid,
  occurrence_id uuid,
  user_id uuid,
  participant_display_name text,
  email text,
  phone text,
  status text,
  seats_count integer,
  guest_names jsonb,
  comment text,
  payment_status text,
  payment_id uuid,
  registered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  occurrence_starts_at timestamptz,
  occurrence_ends_at timestamptz,
  occurrence_title text,
  selected_options jsonb,
  total_amount bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration public.event_registrations;
  v_community_id uuid;
  v_attendance_status text := lower(btrim(coalesce(attendance_status, '')));
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if registration_id is null then
    raise exception 'registration_id is required' using errcode = '22023';
  end if;

  if v_attendance_status not in ('attended', 'no_show') then
    raise exception 'Invalid attendance status' using errcode = '22023';
  end if;

  select r.*
  into v_registration
  from public.event_registrations r
  where r.id = registration_id
  for update;

  if not found then
    raise exception 'Registration not found' using errcode = 'P0002';
  end if;

  select e.community_id
  into v_community_id
  from public.events e
  where e.id = v_registration.event_id;

  if v_community_id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  update public.event_registrations r
  set
    status = v_attendance_status,
    cancelled_at = null,
    updated_at = now()
  where r.id = v_registration.id
  returning r.* into v_registration;

  return query
  select
    r.id,
    r.event_id,
    r.occurrence_id,
    r.user_id,
    coalesce(
      nullif(p.display_name, ''),
      nullif(p.full_name, ''),
      nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      nullif(p.email, ''),
      r.user_id::text
    ) as participant_display_name,
    p.email,
    p.phone,
    r.status,
    r.seats_count,
    r.guest_names,
    r.comment,
    r.payment_status,
    r.payment_id,
    r.registered_at,
    r.confirmed_at,
    r.cancelled_at,
    eo.starts_at as occurrence_starts_at,
    eo.ends_at as occurrence_ends_at,
    eo.title as occurrence_title,
    coalesce(selections.selected_options, '[]'::jsonb) as selected_options,
    selections.total_amount,
    r.created_at,
    r.updated_at
  from public.event_registrations r
  left join public.profiles p
    on p.id = r.user_id
  left join public.event_occurrences eo
    on eo.id = r.occurrence_id
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'id', eros.id,
          'optionId', eros.option_id,
          'title', eros.title_snapshot,
          'description', eros.description_snapshot,
          'optionType', eros.option_type_snapshot,
          'quantity', eros.quantity,
          'unitPriceAmount', eros.unit_price_amount,
          'totalAmount', eros.total_amount,
          'currency', eros.currency,
          'countsTowardCapacity', eros.counts_toward_capacity,
          'seatsCount', eros.seats_count,
          'isDonation', eros.is_donation,
          'createdAt', eros.created_at
        )
        order by eros.created_at asc, eros.id asc
      ) as selected_options,
      case
        when count(*) = 0 then null
        else sum(eros.total_amount)::bigint
      end as total_amount
    from public.event_registration_option_selections eros
    where eros.registration_id = r.id
  ) selections on true
  where r.id = v_registration.id;
end;
$$;

revoke all on function public.admin_list_registration_events() from public;
revoke all on function public.admin_list_event_registrations(jsonb) from public;
revoke all on function public.admin_update_registration_status(uuid, text, text) from public;
revoke all on function public.admin_mark_registration_attendance(uuid, text) from public;

grant execute on function public.admin_list_registration_events() to authenticated;
grant execute on function public.admin_list_event_registrations(jsonb) to authenticated;
grant execute on function public.admin_update_registration_status(uuid, text, text) to authenticated;
grant execute on function public.admin_mark_registration_attendance(uuid, text) to authenticated;

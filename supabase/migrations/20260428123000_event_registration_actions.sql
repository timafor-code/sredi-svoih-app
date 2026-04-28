update public.event_registrations
set
  status = 'confirmed',
  confirmed_at = coalesce(confirmed_at, created_at, registered_at, now()),
  updated_at = now()
where status = 'registered';

alter table public.event_registrations
  alter column status set default 'pending';

create or replace function public.register_for_event(
  p_event_id uuid,
  p_seats_count integer default 1,
  p_comment text default null
)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_registration public.event_registrations;
  v_user_id uuid := auth.uid();
  v_taken_seats integer := 0;
  v_status text;
  v_has_registration boolean := false;
begin
  if v_user_id is null then
    raise exception 'Auth required';
  end if;

  if p_seats_count is null or p_seats_count < 1 then
    raise exception 'seats_count must be greater than zero';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
    and status = 'published'
    and registration_mode in ('internal_free', 'internal_paid')
  for update;

  if not found then
    raise exception 'Event is not available for internal registration';
  end if;

  if v_event.registration_mode = 'internal_paid' then
    raise exception 'Internal paid registration is not implemented yet';
  end if;

  if v_event.visibility = 'members_only'
     and not public.is_active_member(v_event.community_id) then
    raise exception 'Community membership required';
  end if;

  select *
  into v_registration
  from public.event_registrations
  where event_id = p_event_id
    and user_id = v_user_id
  for update;
  v_has_registration := found;

  if v_has_registration and v_registration.status in ('pending', 'confirmed', 'waitlisted') then
    return v_registration;
  end if;

  if v_has_registration and v_registration.status not in ('cancelled', 'rejected') then
    raise exception 'Registration cannot be changed';
  end if;

  select coalesce(sum(seats_count), 0)
  into v_taken_seats
  from public.event_registrations
  where event_id = p_event_id
    and status in ('confirmed', 'pending');

  if v_event.capacity is not null
     and v_taken_seats + p_seats_count > v_event.capacity then
    if v_event.waitlist_enabled then
      v_status := 'waitlisted';
    else
      raise exception 'No seats available';
    end if;
  elsif v_event.requires_approval then
    v_status := 'pending';
  else
    v_status := 'confirmed';
  end if;

  if v_has_registration then
    update public.event_registrations
    set
      status = v_status,
      seats_count = p_seats_count,
      comment = p_comment,
      registered_at = now(),
      confirmed_at = case when v_status = 'confirmed' then now() else null end,
      cancelled_at = null,
      payment_status = 'not_required',
      updated_at = now()
    where id = v_registration.id
      and user_id = v_user_id
    returning * into v_registration;
  else
    insert into public.event_registrations (
      event_id,
      user_id,
      status,
      seats_count,
      comment,
      registered_at,
      confirmed_at
    )
    values (
      p_event_id,
      v_user_id,
      v_status,
      p_seats_count,
      p_comment,
      now(),
      case when v_status = 'confirmed' then now() else null end
    )
    returning * into v_registration;
  end if;

  return v_registration;
end;
$$;

create or replace function public.cancel_event_registration(registration_id uuid)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registration_id uuid := registration_id;
  v_registration public.event_registrations;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required';
  end if;

  select *
  into v_registration
  from public.event_registrations
  where id = v_registration_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Registration not found';
  end if;

  if v_registration.status = 'cancelled' then
    return v_registration;
  end if;

  update public.event_registrations
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where id = v_registration.id
    and user_id = v_user_id
  returning * into v_registration;

  return v_registration;
end;
$$;

grant execute on function public.register_for_event(uuid, integer, text) to authenticated;
revoke all on function public.cancel_event_registration(uuid) from public;
grant execute on function public.cancel_event_registration(uuid) to authenticated;

-- Mobile registration-window state must come from PostgreSQL time, not device time.

drop function if exists public.list_event_occurrences(uuid);

create function public.list_event_occurrences(p_event_id uuid)
returns table (
  id uuid,
  occurrence_id uuid,
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  capacity integer,
  waitlist_enabled boolean,
  requires_approval boolean,
  status text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  server_now timestamptz,
  is_registration_always_open boolean,
  registration_state text,
  registration_state_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_can_manage boolean := false;
  v_server_now timestamptz := now();
begin
  select *
  into v_event
  from public.events
  where events.id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if v_user_id is not null then
    v_can_manage := public.has_community_role(
      v_event.community_id,
      array['admin', 'event_manager']
    );
  end if;

  if not v_can_manage then
    if v_event.status <> 'published' then
      raise exception 'Event not found' using errcode = 'P0002';
    end if;

    if v_event.visibility = 'public' then
      null;
    elsif v_event.visibility = 'members_only' then
      if v_user_id is null then
        raise exception 'Auth required' using errcode = '28000';
      end if;

      if not public.is_active_member(v_event.community_id) then
        raise exception 'Auth required' using errcode = '28000';
      end if;
    else
      raise exception 'Event not found' using errcode = 'P0002';
    end if;
  end if;

  return query
  select
    eo.id,
    eo.id as occurrence_id,
    eo.event_id,
    eo.title,
    eo.starts_at,
    eo.ends_at,
    eo.timezone,
    eo.registration_opens_at,
    eo.registration_closes_at,
    eo.capacity,
    eo.waitlist_enabled,
    eo.requires_approval,
    eo.status,
    eo.sort_order,
    eo.created_at,
    eo.updated_at,
    v_server_now as server_now,
    (
      eo.status = 'active'
      and eo.registration_opens_at is null
      and eo.registration_closes_at is null
    ) as is_registration_always_open,
    case
      when eo.status <> 'active' then 'unavailable'
      when eo.registration_opens_at is null
        and eo.registration_closes_at is null then 'open'
      when eo.registration_opens_at is not null
        and v_server_now < eo.registration_opens_at then 'not_yet_open'
      when eo.registration_closes_at is not null
        and v_server_now > eo.registration_closes_at then 'closed'
      else 'open'
    end as registration_state,
    case
      when eo.status <> 'active' then 'occurrence_status_unavailable'
      when eo.registration_opens_at is not null
        and v_server_now < eo.registration_opens_at then 'registration_opens_in_future'
      when eo.registration_closes_at is not null
        and v_server_now > eo.registration_closes_at then 'registration_closed'
      else null
    end as registration_state_reason
  from public.event_occurrences eo
  where eo.event_id = p_event_id
    and eo.status = 'active'
  order by eo.starts_at asc, eo.sort_order asc;
end;
$$;

revoke all on function public.list_event_occurrences(uuid) from public;
grant execute on function public.list_event_occurrences(uuid) to anon, authenticated;

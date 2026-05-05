-- Event occurrences / sessions backend foundation.
-- Events remain the parent card/series. Occurrences model concrete dates.

alter table public.events
  add column if not exists event_kind text;

update public.events
set event_kind = 'single'
where event_kind is null;

alter table public.events
  alter column event_kind set default 'single',
  alter column event_kind set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_event_kind_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_event_kind_check
      check (event_kind in (
        'single',
        'course',
        'sunday_school',
        'shabbat',
        'holiday',
        'announcement'
      ));
  end if;
end $$;

create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'Europe/Moscow',

  registration_opens_at timestamptz,
  registration_closes_at timestamptz,

  capacity integer,
  waitlist_enabled boolean,
  requires_approval boolean,

  status text not null default 'active',
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_occurrences_status_check
    check (status in ('active', 'hidden', 'cancelled', 'archived')),

  constraint event_occurrences_capacity_check
    check (capacity is null or capacity > 0),

  constraint event_occurrences_ends_at_check
    check (ends_at is null or ends_at > starts_at),

  constraint event_occurrences_registration_window_check
    check (
      registration_closes_at is null
      or registration_opens_at is null
      or registration_closes_at > registration_opens_at
    )
);

create index if not exists event_occurrences_event_id_idx
  on public.event_occurrences(event_id);

create index if not exists event_occurrences_event_starts_at_idx
  on public.event_occurrences(event_id, starts_at);

create index if not exists event_occurrences_status_starts_at_idx
  on public.event_occurrences(status, starts_at);

drop trigger if exists set_event_occurrences_updated_at
  on public.event_occurrences;

create trigger set_event_occurrences_updated_at
before update on public.event_occurrences
for each row execute function public.set_updated_at();

alter table public.event_registrations
  add column if not exists occurrence_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_registrations_occurrence_id_fkey'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_occurrence_id_fkey
      foreign key (occurrence_id)
      references public.event_occurrences(id)
      on delete set null;
  end if;
end $$;

create index if not exists event_registrations_occurrence_id_idx
  on public.event_registrations(occurrence_id);

alter table public.event_occurrences enable row level security;

drop policy if exists "event_occurrences_select_public_published"
  on public.event_occurrences;

create policy "event_occurrences_select_public_published"
on public.event_occurrences
for select
to anon, authenticated
using (
  event_occurrences.status = 'active'
  and exists (
    select 1
    from public.events e
    where e.id = event_occurrences.event_id
      and e.status = 'published'
      and e.visibility = 'public'
  )
);

drop policy if exists "event_occurrences_select_members_published"
  on public.event_occurrences;

create policy "event_occurrences_select_members_published"
on public.event_occurrences
for select
to authenticated
using (
  event_occurrences.status = 'active'
  and exists (
    select 1
    from public.events e
    where e.id = event_occurrences.event_id
      and e.status = 'published'
      and e.visibility = 'members_only'
      and public.is_active_member(e.community_id)
  )
);

drop policy if exists "event_occurrences_select_by_manager"
  on public.event_occurrences;

create policy "event_occurrences_select_by_manager"
on public.event_occurrences
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_occurrences.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_occurrences_manage_by_manager"
  on public.event_occurrences;

create policy "event_occurrences_manage_by_manager"
on public.event_occurrences
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_occurrences.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_occurrences.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

grant select on public.event_occurrences to anon, authenticated;
grant insert, update, delete on public.event_occurrences to authenticated;

create or replace function public.list_event_occurrences(p_event_id uuid)
returns setof public.event_occurrences
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_can_manage boolean := false;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id;

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
  select *
  from public.event_occurrences eo
  where eo.event_id = p_event_id
    and eo.status = 'active'
  order by eo.starts_at asc, eo.sort_order asc;
end;
$$;

revoke all on function public.list_event_occurrences(uuid) from public;
grant execute on function public.list_event_occurrences(uuid) to anon, authenticated;

create or replace function public.admin_list_event_occurrences(p_event_id uuid)
returns setof public.event_occurrences
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
  select *
  from public.event_occurrences eo
  where eo.event_id = p_event_id
  order by eo.starts_at asc, eo.sort_order asc;
end;
$$;

revoke all on function public.admin_list_event_occurrences(uuid) from public;
grant execute on function public.admin_list_event_occurrences(uuid) to authenticated;

create or replace function public.admin_replace_event_occurrences(
  p_event_id uuid,
  p_occurrences jsonb
)
returns setof public.event_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_occurrence jsonb;
  v_index integer := 0;
  v_seen_ids uuid[] := array[]::uuid[];

  v_id uuid;
  v_existing_event_id uuid;
  v_title text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text;
  v_registration_opens_at timestamptz;
  v_registration_closes_at timestamptz;
  v_capacity integer;
  v_waitlist_enabled boolean;
  v_requires_approval boolean;
  v_status text;
  v_sort_order integer;

  v_text text;
  v_delete_blocked_count integer;
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

  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'p_occurrences must be a JSON array' using errcode = '22023';
  end if;

  perform 1
  from public.event_occurrences eo
  where eo.event_id = p_event_id
  for update;

  for v_occurrence in
    select value
    from jsonb_array_elements(p_occurrences) as t(value)
  loop
    if jsonb_typeof(v_occurrence) <> 'object' then
      raise exception 'Occurrence must be a JSON object' using errcode = '22023';
    end if;

    v_text := nullif(btrim(v_occurrence ->> 'id'), '');
    if v_text is null then
      v_id := null;
    else
      begin
        v_id := v_text::uuid;
      exception when others then
        raise exception 'id is invalid' using errcode = '22023';
      end;

      if v_id = any(v_seen_ids) then
        raise exception 'Duplicate occurrence id in payload' using errcode = '22023';
      end if;

      select eo.event_id
      into v_existing_event_id
      from public.event_occurrences eo
      where eo.id = v_id
      for update;

      if not found then
        raise exception 'Occurrence not found' using errcode = 'P0002';
      end if;

      if v_existing_event_id <> p_event_id then
        raise exception 'Occurrence does not belong to event' using errcode = '42501';
      end if;
    end if;

    v_title := nullif(btrim(v_occurrence ->> 'title'), '');

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'startsAt',
      v_occurrence ->> 'starts_at'
    )), '');
    if v_text is null then
      raise exception 'startsAt is required' using errcode = '22023';
    end if;

    begin
      v_starts_at := v_text::timestamptz;
    exception when others then
      raise exception 'startsAt is invalid' using errcode = '22023';
    end;

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'endsAt',
      v_occurrence ->> 'ends_at'
    )), '');
    if v_text is null then
      v_ends_at := null;
    else
      begin
        v_ends_at := v_text::timestamptz;
      exception when others then
        raise exception 'endsAt is invalid' using errcode = '22023';
      end;
    end if;

    if v_ends_at is not null and v_ends_at <= v_starts_at then
      raise exception 'endsAt must be later than startsAt' using errcode = '22023';
    end if;

    v_timezone := coalesce(
      nullif(btrim(v_occurrence ->> 'timezone'), ''),
      'Europe/Moscow'
    );

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'registrationOpensAt',
      v_occurrence ->> 'registration_opens_at'
    )), '');
    if v_text is null then
      v_registration_opens_at := null;
    else
      begin
        v_registration_opens_at := v_text::timestamptz;
      exception when others then
        raise exception 'registrationOpensAt is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'registrationClosesAt',
      v_occurrence ->> 'registration_closes_at'
    )), '');
    if v_text is null then
      v_registration_closes_at := null;
    else
      begin
        v_registration_closes_at := v_text::timestamptz;
      exception when others then
        raise exception 'registrationClosesAt is invalid' using errcode = '22023';
      end;
    end if;

    if v_registration_closes_at is not null
       and v_registration_opens_at is not null
       and v_registration_closes_at <= v_registration_opens_at then
      raise exception 'registrationClosesAt must be later than registrationOpensAt'
        using errcode = '22023';
    end if;

    v_text := nullif(btrim(v_occurrence ->> 'capacity'), '');
    if v_text is null then
      v_capacity := null;
    else
      begin
        v_capacity := v_text::integer;
      exception when others then
        raise exception 'capacity is invalid' using errcode = '22023';
      end;

      if v_capacity <= 0 then
        raise exception 'capacity must be greater than 0' using errcode = '22023';
      end if;
    end if;

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'waitlistEnabled',
      v_occurrence ->> 'waitlist_enabled'
    )), '');
    if v_text is null then
      v_waitlist_enabled := null;
    else
      begin
        v_waitlist_enabled := v_text::boolean;
      exception when others then
        raise exception 'waitlistEnabled is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'requiresApproval',
      v_occurrence ->> 'requires_approval'
    )), '');
    if v_text is null then
      v_requires_approval := null;
    else
      begin
        v_requires_approval := v_text::boolean;
      exception when others then
        raise exception 'requiresApproval is invalid' using errcode = '22023';
      end;
    end if;

    v_status := coalesce(
      nullif(btrim(v_occurrence ->> 'status'), ''),
      'active'
    );
    if v_status not in ('active', 'hidden', 'cancelled', 'archived') then
      raise exception 'status is invalid' using errcode = '22023';
    end if;

    v_text := nullif(btrim(coalesce(
      v_occurrence ->> 'sortOrder',
      v_occurrence ->> 'sort_order'
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

    if v_id is null then
      insert into public.event_occurrences (
        event_id,
        title,
        starts_at,
        ends_at,
        timezone,
        registration_opens_at,
        registration_closes_at,
        capacity,
        waitlist_enabled,
        requires_approval,
        status,
        sort_order
      ) values (
        p_event_id,
        v_title,
        v_starts_at,
        v_ends_at,
        v_timezone,
        v_registration_opens_at,
        v_registration_closes_at,
        v_capacity,
        v_waitlist_enabled,
        v_requires_approval,
        v_status,
        v_sort_order
      )
      returning id into v_id;
    else
      update public.event_occurrences
      set
        title = v_title,
        starts_at = v_starts_at,
        ends_at = v_ends_at,
        timezone = v_timezone,
        registration_opens_at = v_registration_opens_at,
        registration_closes_at = v_registration_closes_at,
        capacity = v_capacity,
        waitlist_enabled = v_waitlist_enabled,
        requires_approval = v_requires_approval,
        status = v_status,
        sort_order = v_sort_order
      where id = v_id;
    end if;

    v_seen_ids := array_append(v_seen_ids, v_id);
    v_index := v_index + 1;
  end loop;

  select count(*)
  into v_delete_blocked_count
  from public.event_occurrences eo
  where eo.event_id = p_event_id
    and not (eo.id = any(v_seen_ids))
    and exists (
      select 1
      from public.event_registrations r
      where r.occurrence_id = eo.id
    );

  if v_delete_blocked_count > 0 then
    raise exception 'Cannot delete occurrence with registrations'
      using errcode = '23503';
  end if;

  delete from public.event_occurrences eo
  where eo.event_id = p_event_id
    and not (eo.id = any(v_seen_ids));

  return query
  select *
  from public.event_occurrences eo
  where eo.event_id = p_event_id
  order by eo.starts_at asc, eo.sort_order asc;
end;
$$;

revoke all on function public.admin_replace_event_occurrences(uuid, jsonb) from public;
grant execute on function public.admin_replace_event_occurrences(uuid, jsonb) to authenticated;

-- Allow rabbi memberships in the admin members RPC role validation.

create or replace function public.admin_list_users(payload jsonb default '{}'::jsonb)
returns table (
  user_id uuid,
  display_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  city text,
  birth_date date,
  hebrew_birth_date jsonb,
  nusach text,
  onboarding_completed boolean,
  profile_created_at timestamptz,
  profile_updated_at timestamptz,
  membership_id uuid,
  community_id uuid,
  membership_role text,
  membership_status text,
  joined_at timestamptz,
  invited_by uuid,
  registrations_total integer,
  registrations_upcoming integer,
  registrations_past integer,
  registrations_cancelled integer,
  last_registration_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_community_id uuid;
  v_community_id_text text;
  v_search text;
  v_membership_status text;
  v_role text;
  v_onboarding text;
  v_limit integer := 100;
  v_offset integer := 0;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  v_community_id_text := nullif(
    btrim(coalesce(v_payload ->> 'communityId', v_payload ->> 'community_id')),
    ''
  );

  if v_community_id_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  v_community_id := v_community_id_text::uuid;

  if not public.has_community_role(v_community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  v_search := nullif(btrim(coalesce(v_payload ->> 'search', '')), '');

  v_membership_status := lower(nullif(btrim(coalesce(
    v_payload ->> 'membershipStatus',
    v_payload ->> 'membership_status',
    'all'
  )), ''));

  if v_membership_status is null or v_membership_status = 'all' then
    v_membership_status := null;
  elsif v_membership_status not in ('active', 'pending', 'suspended', 'left', 'no_membership') then
    raise exception 'Invalid membership status' using errcode = '22023';
  end if;

  v_role := lower(nullif(btrim(coalesce(v_payload ->> 'role', 'all')), ''));

  if v_role is null or v_role = 'all' then
    v_role := null;
  elsif v_role not in ('member', 'rabbi', 'event_manager', 'admin') then
    raise exception 'Invalid membership role' using errcode = '22023';
  end if;

  v_onboarding := lower(nullif(btrim(coalesce(v_payload ->> 'onboarding', 'all')), ''));

  if v_onboarding is null or v_onboarding = 'all' then
    v_onboarding := null;
  elsif v_onboarding not in ('completed', 'incomplete') then
    raise exception 'Invalid onboarding filter' using errcode = '22023';
  end if;

  if nullif(v_payload ->> 'limit', '') is not null then
    v_limit := (v_payload ->> 'limit')::integer;
  end if;

  if nullif(v_payload ->> 'offset', '') is not null then
    v_offset := (v_payload ->> 'offset')::integer;
  end if;

  v_limit := least(greatest(coalesce(v_limit, 100), 1), 200);
  v_offset := greatest(coalesce(v_offset, 0), 0);

  return query
  with registration_stats as (
    select
      r.user_id,
      count(*)::integer as registrations_total,
      count(*) filter (
        where r.status <> 'cancelled'
          and coalesce(eo.starts_at, e.starts_at) >= now()
      )::integer as registrations_upcoming,
      count(*) filter (
        where r.status <> 'cancelled'
          and coalesce(eo.starts_at, e.starts_at) < now()
      )::integer as registrations_past,
      count(*) filter (where r.status = 'cancelled')::integer as registrations_cancelled,
      max(r.registered_at) as last_registration_at
    from public.event_registrations r
    join public.events e
      on e.id = r.event_id
     and e.community_id = v_community_id
    left join public.event_occurrences eo
      on eo.id = r.occurrence_id
    group by r.user_id
  ),
  scoped_profiles as (
    select
      p.id as user_id,
      p.display_name,
      p.first_name,
      p.last_name,
      p.email,
      p.phone,
      p.avatar_url,
      p.city,
      p.birth_date,
      p.hebrew_birth_date,
      p.nusach,
      p.onboarding_completed,
      p.created_at as profile_created_at,
      p.updated_at as profile_updated_at,
      p.full_name,
      cm.id as membership_id,
      cm.community_id,
      cm.role as membership_role,
      cm.status as membership_status,
      cm.joined_at,
      cm.invited_by
    from public.profiles p
    left join public.community_memberships cm
      on cm.user_id = p.id
     and cm.community_id = v_community_id
    where cm.id is not null
      or not exists (
        select 1
        from public.community_memberships active_cm
        where active_cm.user_id = p.id
          and active_cm.status = 'active'
      )
  )
  select
    sp.user_id,
    sp.display_name,
    sp.first_name,
    sp.last_name,
    sp.email,
    sp.phone,
    sp.avatar_url,
    sp.city,
    sp.birth_date,
    sp.hebrew_birth_date,
    sp.nusach,
    sp.onboarding_completed,
    sp.profile_created_at,
    sp.profile_updated_at,
    sp.membership_id,
    sp.community_id,
    sp.membership_role,
    sp.membership_status,
    sp.joined_at,
    sp.invited_by,
    coalesce(rs.registrations_total, 0) as registrations_total,
    coalesce(rs.registrations_upcoming, 0) as registrations_upcoming,
    coalesce(rs.registrations_past, 0) as registrations_past,
    coalesce(rs.registrations_cancelled, 0) as registrations_cancelled,
    rs.last_registration_at
  from scoped_profiles sp
  left join registration_stats rs
    on rs.user_id = sp.user_id
  where (
      v_membership_status is null
      or (
        v_membership_status = 'no_membership'
        and sp.membership_id is null
      )
      or (
        v_membership_status <> 'no_membership'
        and sp.membership_status = v_membership_status
      )
    )
    and (v_role is null or sp.membership_role = v_role)
    and (
      v_onboarding is null
      or (v_onboarding = 'completed' and sp.onboarding_completed is true)
      or (v_onboarding = 'incomplete' and sp.onboarding_completed is not true)
    )
    and (
      v_search is null
      or coalesce(sp.display_name, '') ilike '%' || v_search || '%'
      or coalesce(sp.full_name, '') ilike '%' || v_search || '%'
      or concat_ws(' ', sp.first_name, sp.last_name) ilike '%' || v_search || '%'
      or coalesce(sp.email, '') ilike '%' || v_search || '%'
      or coalesce(sp.phone, '') ilike '%' || v_search || '%'
      or coalesce(sp.city, '') ilike '%' || v_search || '%'
      or sp.user_id::text ilike '%' || v_search || '%'
    )
  order by
    case
      when sp.membership_status = 'active' then 0
      when sp.membership_id is not null then 1
      else 2
    end,
    lower(coalesce(
      nullif(sp.display_name, ''),
      nullif(concat_ws(' ', sp.first_name, sp.last_name), ''),
      nullif(sp.email, ''),
      sp.user_id::text
    )) asc,
    sp.profile_created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.admin_set_user_membership(payload jsonb)
returns table (
  membership_id uuid,
  community_id uuid,
  user_id uuid,
  membership_role text,
  membership_status text,
  joined_at timestamptz,
  invited_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_community_id uuid;
  v_community_id_text text;
  v_target_user_id uuid;
  v_target_user_id_text text;
  v_role text;
  v_status text;
begin
  if v_admin_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  v_community_id_text := nullif(
    btrim(coalesce(v_payload ->> 'communityId', v_payload ->> 'community_id')),
    ''
  );

  v_target_user_id_text := nullif(
    btrim(coalesce(v_payload ->> 'userId', v_payload ->> 'user_id')),
    ''
  );

  if v_community_id_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  if v_target_user_id_text is null then
    raise exception 'userId is required' using errcode = '22023';
  end if;

  v_community_id := v_community_id_text::uuid;
  v_target_user_id := v_target_user_id_text::uuid;

  if not public.has_community_role(v_community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_target_user_id
  ) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  v_role := lower(nullif(btrim(coalesce(v_payload ->> 'role', '')), ''));
  v_status := lower(nullif(btrim(coalesce(v_payload ->> 'status', '')), ''));

  if v_role is null or v_role not in ('member', 'rabbi', 'event_manager', 'admin') then
    raise exception 'Invalid membership role' using errcode = '22023';
  end if;

  if v_status is null or v_status not in ('pending', 'active', 'suspended', 'left') then
    raise exception 'Invalid membership status' using errcode = '22023';
  end if;

  return query
  insert into public.community_memberships as cm (
    community_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at
  )
  values (
    v_community_id,
    v_target_user_id,
    v_role,
    v_status,
    v_admin_user_id,
    case when v_status = 'active' then now() else null end
  )
  on conflict on constraint community_memberships_unique_user_community do update
  set
    role = excluded.role,
    status = excluded.status,
    joined_at = case
      when excluded.status = 'active' then coalesce(cm.joined_at, now())
      else cm.joined_at
    end
  returning
    cm.id as membership_id,
    cm.community_id,
    cm.user_id,
    cm.role as membership_role,
    cm.status as membership_status,
    cm.joined_at,
    cm.invited_by,
    cm.created_at;
end;
$$;

revoke all on function public.admin_list_users(jsonb) from public;
revoke all on function public.admin_set_user_membership(jsonb) from public;

grant execute on function public.admin_list_users(jsonb) to authenticated;
grant execute on function public.admin_set_user_membership(jsonb) to authenticated;

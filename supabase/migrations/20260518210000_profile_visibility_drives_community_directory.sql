create or replace function public.list_community_contacts(
  p_community_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  community_id uuid,
  display_name text,
  first_name text,
  last_name text,
  avatar_url text,
  phone text,
  email text,
  city text,
  hebrew_name text,
  birth_date date,
  hebrew_birth_date jsonb,
  role text,
  membership_status text,
  joined_at timestamptz,
  show_in_community_directory boolean,
  share_phone boolean,
  share_email boolean,
  share_birth_date boolean,
  share_hebrew_birth_date boolean,
  share_city boolean,
  share_hebrew_name boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_community_id uuid := p_community_id;
  v_viewer_role text;
  v_can_view_rabbi_only boolean := false;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_community_id is null then
    select cm.community_id
    into v_community_id
    from public.community_memberships cm
    where cm.user_id = v_user_id
      and cm.status = 'active'
    order by cm.joined_at nulls last, cm.created_at
    limit 1;
  end if;

  if v_community_id is null then
    raise exception 'Active community membership required' using errcode = '42501';
  end if;

  select cm.role
  into v_viewer_role
  from public.community_memberships cm
  where cm.community_id = v_community_id
    and cm.user_id = v_user_id
    and cm.status = 'active'
  limit 1;

  if v_viewer_role is null then
    raise exception 'Active community membership required' using errcode = '42501';
  end if;

  v_can_view_rabbi_only := v_viewer_role in ('admin', 'event_manager');

  return query
  with visible_profiles as (
    select
      cm.id,
      cm.user_id,
      cm.community_id,
      cm.role,
      cm.status,
      cm.joined_at,
      cm.created_at,
      p.display_name,
      p.full_name,
      p.first_name,
      p.last_name,
      p.avatar_url,
      p.phone,
      p.city,
      p.hebrew_name,
      p.birth_date,
      p.hebrew_birth_date,
      coalesce(p.profile_visibility, 'members') as profile_visibility,
      coalesce(p.birthday_visibility, 'members') as birthday_visibility,
      coalesce(p.phone_visibility, 'rabbi_only') as phone_visibility
    from public.community_memberships cm
    join public.profiles p
      on p.id = cm.user_id
    where cm.community_id = v_community_id
      and cm.status = 'active'
      and (
        v_can_view_rabbi_only
        or coalesce(p.profile_visibility, 'members') in ('members', 'public')
      )
  )
  select
    vp.id,
    vp.user_id,
    vp.community_id,
    coalesce(
      nullif(vp.display_name, ''),
      nullif(vp.full_name, ''),
      nullif(concat_ws(' ', nullif(vp.first_name, ''), nullif(vp.last_name, '')), ''),
      'Community member'
    ) as display_name,
    vp.first_name,
    vp.last_name,
    vp.avatar_url,
    case
      when v_can_view_rabbi_only or vp.phone_visibility in ('members', 'public')
        then vp.phone
      else null
    end as phone,
    null::text as email,
    vp.city,
    vp.hebrew_name,
    case
      when v_can_view_rabbi_only or vp.birthday_visibility in ('members', 'public')
        then vp.birth_date
      else null
    end as birth_date,
    case
      when v_can_view_rabbi_only or vp.birthday_visibility in ('members', 'public')
        then vp.hebrew_birth_date
      else null
    end as hebrew_birth_date,
    vp.role,
    vp.status as membership_status,
    vp.joined_at,
    (v_can_view_rabbi_only or vp.profile_visibility in ('members', 'public')) as show_in_community_directory,
    (v_can_view_rabbi_only or vp.phone_visibility in ('members', 'public')) as share_phone,
    false as share_email,
    (v_can_view_rabbi_only or vp.birthday_visibility in ('members', 'public')) as share_birth_date,
    (v_can_view_rabbi_only or vp.birthday_visibility in ('members', 'public')) as share_hebrew_birth_date,
    (v_can_view_rabbi_only or vp.profile_visibility in ('members', 'public')) as share_city,
    (v_can_view_rabbi_only or vp.profile_visibility in ('members', 'public')) as share_hebrew_name
  from visible_profiles vp
  order by
    case vp.role
      when 'admin' then 0
      when 'event_manager' then 1
      else 2
    end,
    lower(coalesce(
      nullif(vp.display_name, ''),
      nullif(vp.full_name, ''),
      nullif(concat_ws(' ', nullif(vp.first_name, ''), nullif(vp.last_name, '')), ''),
      'Community member'
    )),
    vp.joined_at nulls last,
    vp.created_at;
end;
$$;

revoke all on function public.list_community_contacts(uuid) from public;
grant execute on function public.list_community_contacts(uuid) to authenticated;

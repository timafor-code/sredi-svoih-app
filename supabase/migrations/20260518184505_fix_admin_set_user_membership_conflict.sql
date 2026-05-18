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

  if v_role is null or v_role not in ('member', 'event_manager', 'admin') then
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

revoke all on function public.admin_set_user_membership(jsonb) from public;
grant execute on function public.admin_set_user_membership(jsonb) to authenticated;

create or replace function public.accept_invite(invite_code text)
returns public.community_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
  v_membership public.community_memberships;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required';
  end if;

  select *
  into v_invite
  from public.invites
  where code_hash = encode(extensions.digest(invite_code, 'sha256'), 'hex')
    and status = 'active'
    and used_count < max_uses
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'Invalid or expired invite code';
  end if;

  insert into public.community_memberships (
    community_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    v_invite.community_id,
    v_user_id,
    v_invite.role,
    'active',
    now()
  )
  on conflict (community_id, user_id)
  do update set
    role = excluded.role,
    status = 'active',
    joined_at = coalesce(public.community_memberships.joined_at, now())
  returning * into v_membership;

  update public.invites
  set
    used_count = used_count + 1,
    accepted_by = v_user_id,
    accepted_at = now(),
    status = case
      when used_count + 1 >= max_uses then 'used'
      else status
    end
  where id = v_invite.id;

  return v_membership;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

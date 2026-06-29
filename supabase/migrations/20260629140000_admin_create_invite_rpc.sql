-- Admin invite creation foundation for web-admin.
-- Auth identifies the operator; community_memberships defines community access.
--
-- This RPC lets an active community admin create an invite for the selected
-- community. It generates a random invite code, stores only the sha256 hash of
-- that code, and returns the plaintext code exactly once in the RPC response.
--
-- The stored hash uses the same formula as public.accept_invite
-- (encode(extensions.digest(code, 'sha256'), 'hex')), so codes created here stay
-- compatible with the existing invite acceptance flow.

create or replace function public.admin_create_invite(payload jsonb)
returns table (
  invite_id uuid,
  community_id uuid,
  code text,
  role text,
  email text,
  phone text,
  max_uses integer,
  used_count integer,
  expires_at timestamptz,
  status text,
  created_by uuid,
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
  v_role text;
  v_email text;
  v_phone text;
  v_max_uses integer := 1;
  v_max_uses_text text;
  v_expires_at timestamptz;
  v_expires_at_text text;
  v_key text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_code_hash text;
  v_attempt integer;
  v_bytes bytea;
  v_index integer;
begin
  if v_admin_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  -- Reject unsupported top-level payload keys.
  for v_key in select jsonb_object_keys(v_payload) loop
    if v_key not in (
      'communityId', 'community_id',
      'email',
      'phone',
      'role',
      'maxUses', 'max_uses',
      'expiresAt', 'expires_at'
    ) then
      raise exception 'Unsupported payload key: %', v_key using errcode = '22023';
    end if;
  end loop;

  v_community_id_text := nullif(
    btrim(coalesce(v_payload ->> 'communityId', v_payload ->> 'community_id')),
    ''
  );

  if v_community_id_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  begin
    v_community_id := v_community_id_text::uuid;
  exception when others then
    raise exception 'communityId must be a valid uuid' using errcode = '22023';
  end;

  if not exists (
    select 1
    from public.communities c
    where c.id = v_community_id
  ) then
    raise exception 'Community not found' using errcode = 'P0002';
  end if;

  -- Derive the acting admin only from auth.uid(); a spoofed admin id in the
  -- payload is not accepted, and access requires an active admin membership.
  if not public.has_community_role(v_community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  v_role := lower(nullif(btrim(coalesce(v_payload ->> 'role', 'member')), ''));

  if v_role is null then
    v_role := 'member';
  end if;

  if v_role not in ('member', 'event_manager', 'admin', 'rabbi') then
    raise exception 'Invalid invite role' using errcode = '22023';
  end if;

  v_email := nullif(btrim(coalesce(v_payload ->> 'email', '')), '');
  v_phone := nullif(btrim(coalesce(v_payload ->> 'phone', '')), '');

  v_max_uses_text := nullif(btrim(coalesce(v_payload ->> 'maxUses', v_payload ->> 'max_uses', '')), '');

  if v_max_uses_text is not null then
    begin
      v_max_uses := v_max_uses_text::integer;
    exception when others then
      raise exception 'maxUses must be an integer' using errcode = '22023';
    end;
  end if;

  if v_max_uses < 1 or v_max_uses > 1000 then
    raise exception 'maxUses must be between 1 and 1000' using errcode = '22023';
  end if;

  v_expires_at_text := nullif(btrim(coalesce(v_payload ->> 'expiresAt', v_payload ->> 'expires_at', '')), '');

  if v_expires_at_text is not null then
    begin
      v_expires_at := v_expires_at_text::timestamptz;
    exception when others then
      raise exception 'expiresAt must be a valid timestamp' using errcode = '22023';
    end;

    if v_expires_at <= now() then
      raise exception 'expiresAt must be in the future' using errcode = '22023';
    end if;
  end if;

  -- Generate a safe random invite code and store only its hash. Retry on the
  -- rare hash collision against the unique code_hash index.
  v_attempt := 0;
  loop
    v_attempt := v_attempt + 1;

    v_bytes := extensions.gen_random_bytes(12);
    v_code := '';
    for v_index in 0..11 loop
      -- 256 is divisible by 32, so byte % 32 maps uniformly onto the alphabet.
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
    end loop;

    v_code := 'SS-'
      || substr(v_code, 1, 4) || '-'
      || substr(v_code, 5, 4) || '-'
      || substr(v_code, 9, 4);

    v_code_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

    exit when not exists (
      select 1 from public.invites i where i.code_hash = v_code_hash
    );

    if v_attempt >= 5 then
      raise exception 'Could not generate a unique invite code' using errcode = 'P0001';
    end if;
  end loop;

  return query
  insert into public.invites as i (
    community_id,
    code_hash,
    email,
    phone,
    role,
    max_uses,
    used_count,
    expires_at,
    created_by,
    status
  )
  values (
    v_community_id,
    v_code_hash,
    v_email,
    v_phone,
    v_role,
    v_max_uses,
    0,
    v_expires_at,
    v_admin_user_id,
    'active'
  )
  returning
    i.id as invite_id,
    i.community_id,
    v_code as code,
    i.role,
    i.email,
    i.phone,
    i.max_uses,
    i.used_count,
    i.expires_at,
    i.status,
    i.created_by,
    i.created_at;
end;
$$;

revoke all on function public.admin_create_invite(jsonb) from public;
grant execute on function public.admin_create_invite(jsonb) to authenticated;

-- Safe admin profile edits for the web-admin Members surface.

create or replace function public.admin_update_user_profile(payload jsonb)
returns table (
  user_id uuid,
  profile_community_id uuid,
  full_name text,
  first_name text,
  last_name text,
  display_name text,
  hebrew_name text,
  email text,
  phone text,
  city text,
  birth_date date,
  hebrew_birth_date jsonb,
  birth_time_context text,
  nusach text,
  tribe_status text,
  marital_status text,
  about text,
  onboarding_completed boolean,
  profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_fields jsonb;
  v_community_id uuid;
  v_community_id_text text;
  v_target_user_id uuid;
  v_target_user_id_text text;
begin
  if v_admin_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_payload) as payload_key(key)
    where payload_key.key not in (
      'targetUserId',
      'target_user_id',
      'communityId',
      'community_id',
      'fields'
    )
  ) then
    raise exception 'Unsupported payload field' using errcode = '22023';
  end if;

  if v_payload ? 'targetUserId'
     and v_payload ? 'target_user_id'
     and nullif(btrim(v_payload ->> 'targetUserId'), '')
       is distinct from nullif(btrim(v_payload ->> 'target_user_id'), '') then
    raise exception 'Conflicting target user id fields' using errcode = '22023';
  end if;

  if v_payload ? 'communityId'
     and v_payload ? 'community_id'
     and nullif(btrim(v_payload ->> 'communityId'), '')
       is distinct from nullif(btrim(v_payload ->> 'community_id'), '') then
    raise exception 'Conflicting community id fields' using errcode = '22023';
  end if;

  v_target_user_id_text := nullif(
    btrim(coalesce(v_payload ->> 'targetUserId', v_payload ->> 'target_user_id')),
    ''
  );

  v_community_id_text := nullif(
    btrim(coalesce(v_payload ->> 'communityId', v_payload ->> 'community_id')),
    ''
  );

  if v_target_user_id_text is null then
    raise exception 'target_user_id is required' using errcode = '22023';
  end if;

  if v_community_id_text is null then
    raise exception 'community_id is required' using errcode = '22023';
  end if;

  v_target_user_id := v_target_user_id_text::uuid;
  v_community_id := v_community_id_text::uuid;

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

  if not exists (
    select 1
    from public.community_memberships cm
    where cm.community_id = v_community_id
      and cm.user_id = v_target_user_id
  ) and exists (
    select 1
    from public.community_memberships active_cm
    where active_cm.user_id = v_target_user_id
      and active_cm.status = 'active'
  ) then
    raise exception 'Profile is outside admin members scope' using errcode = '42501';
  end if;

  if not v_payload ? 'fields' then
    raise exception 'fields is required' using errcode = '22023';
  end if;

  v_fields := v_payload -> 'fields';

  if jsonb_typeof(v_fields) <> 'object' then
    raise exception 'fields must be a JSON object' using errcode = '22023';
  end if;

  if v_fields = '{}'::jsonb then
    raise exception 'At least one profile field is required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_fields) as field_key(key)
    where field_key.key not in (
      'full_name',
      'first_name',
      'last_name',
      'display_name',
      'hebrew_name',
      'email',
      'phone',
      'city',
      'birth_date',
      'hebrew_birth_date',
      'birth_time_context',
      'nusach',
      'tribe_status',
      'marital_status',
      'about',
      'onboarding_completed'
    )
  ) then
    raise exception 'Unsupported profile field' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(v_fields) as field_value(key, value)
    where field_value.key in (
      'full_name',
      'first_name',
      'last_name',
      'display_name',
      'hebrew_name',
      'email',
      'phone',
      'city',
      'nusach',
      'about'
    )
      and jsonb_typeof(field_value.value) not in ('string', 'null')
  ) then
    raise exception 'Profile text fields must be strings or null' using errcode = '22023';
  end if;

  if v_fields ? 'birth_date'
     and jsonb_typeof(v_fields -> 'birth_date') not in ('string', 'null') then
    raise exception 'birth_date must be a date string or null' using errcode = '22023';
  end if;

  if v_fields ? 'hebrew_birth_date'
     and jsonb_typeof(v_fields -> 'hebrew_birth_date') not in ('object', 'null') then
    raise exception 'hebrew_birth_date must be an object or null' using errcode = '22023';
  end if;

  if v_fields ? 'birth_time_context'
     and (
       jsonb_typeof(v_fields -> 'birth_time_context') <> 'string'
       or lower(btrim(v_fields ->> 'birth_time_context')) not in (
         'before_sunset',
         'after_sunset',
         'unknown'
       )
     ) then
    raise exception 'Invalid birth_time_context' using errcode = '22023';
  end if;

  if v_fields ? 'tribe_status'
     and jsonb_typeof(v_fields -> 'tribe_status') not in ('string', 'null') then
    raise exception 'tribe_status must be a string or null' using errcode = '22023';
  end if;

  if v_fields ? 'tribe_status'
     and nullif(btrim(v_fields ->> 'tribe_status'), '') is not null
     and lower(btrim(v_fields ->> 'tribe_status')) not in ('kohen', 'levi', 'israel') then
    raise exception 'Invalid tribe_status' using errcode = '22023';
  end if;

  if v_fields ? 'marital_status'
     and jsonb_typeof(v_fields -> 'marital_status') not in ('string', 'null') then
    raise exception 'marital_status must be a string or null' using errcode = '22023';
  end if;

  if v_fields ? 'marital_status'
     and nullif(btrim(v_fields ->> 'marital_status'), '') is not null
     and lower(btrim(v_fields ->> 'marital_status')) not in (
       'single',
       'married',
       'divorced',
       'widowed',
       'other'
     ) then
    raise exception 'Invalid marital_status' using errcode = '22023';
  end if;

  if v_fields ? 'about'
     and v_fields ->> 'about' is not null
     and char_length(v_fields ->> 'about') > 200 then
    raise exception 'about must be at most 200 characters' using errcode = '22023';
  end if;

  if v_fields ? 'onboarding_completed'
     and jsonb_typeof(v_fields -> 'onboarding_completed') <> 'boolean' then
    raise exception 'onboarding_completed must be boolean' using errcode = '22023';
  end if;

  return query
  update public.profiles as p
  set
    full_name = case
      when v_fields ? 'full_name' then v_fields ->> 'full_name'
      else p.full_name
    end,
    first_name = case
      when v_fields ? 'first_name' then v_fields ->> 'first_name'
      else p.first_name
    end,
    last_name = case
      when v_fields ? 'last_name' then v_fields ->> 'last_name'
      else p.last_name
    end,
    display_name = case
      when v_fields ? 'display_name' then v_fields ->> 'display_name'
      else p.display_name
    end,
    hebrew_name = case
      when v_fields ? 'hebrew_name' then v_fields ->> 'hebrew_name'
      else p.hebrew_name
    end,
    email = case
      when v_fields ? 'email' then v_fields ->> 'email'
      else p.email
    end,
    phone = case
      when v_fields ? 'phone' then v_fields ->> 'phone'
      else p.phone
    end,
    city = case
      when v_fields ? 'city' then v_fields ->> 'city'
      else p.city
    end,
    birth_date = case
      when v_fields ? 'birth_date' then nullif(btrim(v_fields ->> 'birth_date'), '')::date
      else p.birth_date
    end,
    hebrew_birth_date = case
      when v_fields ? 'hebrew_birth_date' then nullif(v_fields -> 'hebrew_birth_date', 'null'::jsonb)
      else p.hebrew_birth_date
    end,
    birth_time_context = case
      when v_fields ? 'birth_time_context' then lower(btrim(v_fields ->> 'birth_time_context'))
      else p.birth_time_context
    end,
    nusach = case
      when v_fields ? 'nusach' then v_fields ->> 'nusach'
      else p.nusach
    end,
    tribe_status = case
      when v_fields ? 'tribe_status' then lower(nullif(btrim(v_fields ->> 'tribe_status'), ''))
      else p.tribe_status
    end,
    marital_status = case
      when v_fields ? 'marital_status' then lower(nullif(btrim(v_fields ->> 'marital_status'), ''))
      else p.marital_status
    end,
    about = case
      when v_fields ? 'about' then v_fields ->> 'about'
      else p.about
    end,
    onboarding_completed = case
      when v_fields ? 'onboarding_completed' then (v_fields ->> 'onboarding_completed')::boolean
      else p.onboarding_completed
    end
  where p.id = v_target_user_id
  returning
    p.id as user_id,
    p.community_id as profile_community_id,
    p.full_name,
    p.first_name,
    p.last_name,
    p.display_name,
    p.hebrew_name,
    p.email,
    p.phone,
    p.city,
    p.birth_date,
    p.hebrew_birth_date,
    p.birth_time_context,
    p.nusach,
    p.tribe_status,
    p.marital_status,
    p.about,
    p.onboarding_completed,
    p.updated_at as profile_updated_at;
end;
$$;

revoke all on function public.admin_update_user_profile(jsonb) from public;
grant execute on function public.admin_update_user_profile(jsonb) to authenticated;

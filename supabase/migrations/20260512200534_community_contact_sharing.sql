-- Community contacts privacy foundation.

create table if not exists public.profile_contact_visibility (
  user_id uuid primary key references auth.users(id) on delete cascade,

  show_in_community_directory boolean not null default false,

  share_phone boolean not null default false,
  share_email boolean not null default false,
  share_birth_date boolean not null default false,
  share_hebrew_birth_date boolean not null default false,
  share_city boolean not null default false,
  share_hebrew_name boolean not null default false,

  birthday_reminders_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_contact_visibility_directory_user_idx
  on public.profile_contact_visibility(user_id)
  where show_in_community_directory = true;

drop trigger if exists set_profile_contact_visibility_updated_at
on public.profile_contact_visibility;

create trigger set_profile_contact_visibility_updated_at
before update on public.profile_contact_visibility
for each row execute function public.set_updated_at();

alter table public.profile_contact_visibility enable row level security;

drop policy if exists "profile_contact_visibility_select_own"
on public.profile_contact_visibility;

create policy "profile_contact_visibility_select_own"
on public.profile_contact_visibility
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profile_contact_visibility_select_by_admin"
on public.profile_contact_visibility;

create policy "profile_contact_visibility_select_by_admin"
on public.profile_contact_visibility
for select
to authenticated
using (
  exists (
    select 1
    from public.community_memberships cm
    where cm.user_id = profile_contact_visibility.user_id
      and cm.status = 'active'
      and public.has_community_role(cm.community_id, array['admin'])
  )
);

drop policy if exists "profile_contact_visibility_insert_own"
on public.profile_contact_visibility;

create policy "profile_contact_visibility_insert_own"
on public.profile_contact_visibility
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "profile_contact_visibility_update_own"
on public.profile_contact_visibility;

create policy "profile_contact_visibility_update_own"
on public.profile_contact_visibility
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.get_my_contact_visibility()
returns public.profile_contact_visibility
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_visibility public.profile_contact_visibility;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  insert into public.profile_contact_visibility (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select pcv.*
  into v_visibility
  from public.profile_contact_visibility pcv
  where pcv.user_id = v_user_id;

  return v_visibility;
end;
$$;

create or replace function public.upsert_my_contact_visibility(
  p_show_in_community_directory boolean,
  p_share_phone boolean,
  p_share_email boolean,
  p_share_birth_date boolean,
  p_share_hebrew_birth_date boolean,
  p_share_city boolean,
  p_share_hebrew_name boolean,
  p_birthday_reminders_enabled boolean
)
returns public.profile_contact_visibility
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_visibility public.profile_contact_visibility;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  insert into public.profile_contact_visibility (
    user_id,
    show_in_community_directory,
    share_phone,
    share_email,
    share_birth_date,
    share_hebrew_birth_date,
    share_city,
    share_hebrew_name,
    birthday_reminders_enabled
  )
  values (
    v_user_id,
    coalesce(p_show_in_community_directory, false),
    coalesce(p_share_phone, false),
    coalesce(p_share_email, false),
    coalesce(p_share_birth_date, false),
    coalesce(p_share_hebrew_birth_date, false),
    coalesce(p_share_city, false),
    coalesce(p_share_hebrew_name, false),
    coalesce(p_birthday_reminders_enabled, false)
  )
  on conflict (user_id)
  do update set
    show_in_community_directory = excluded.show_in_community_directory,
    share_phone = excluded.share_phone,
    share_email = excluded.share_email,
    share_birth_date = excluded.share_birth_date,
    share_hebrew_birth_date = excluded.share_hebrew_birth_date,
    share_city = excluded.share_city,
    share_hebrew_name = excluded.share_hebrew_name,
    birthday_reminders_enabled = excluded.birthday_reminders_enabled
  returning * into v_visibility;

  return v_visibility;
end;
$$;

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

  if not exists (
    select 1
    from public.community_memberships cm
    where cm.community_id = v_community_id
      and cm.user_id = v_user_id
      and cm.status = 'active'
  ) then
    raise exception 'Active community membership required' using errcode = '42501';
  end if;

  return query
  select
    cm.id,
    cm.user_id,
    cm.community_id,
    coalesce(
      nullif(p.display_name, ''),
      nullif(p.full_name, ''),
      nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      'Community member'
    ) as display_name,
    p.first_name,
    p.last_name,
    p.avatar_url,
    case when pcv.share_phone then p.phone else null end as phone,
    case when pcv.share_email then p.email else null end as email,
    case when pcv.share_city then p.city else null end as city,
    case when pcv.share_hebrew_name then p.hebrew_name else null end as hebrew_name,
    case when pcv.share_birth_date then p.birth_date else null end as birth_date,
    case when pcv.share_hebrew_birth_date then p.hebrew_birth_date else null end as hebrew_birth_date,
    cm.role,
    cm.status as membership_status,
    cm.joined_at,
    pcv.show_in_community_directory,
    pcv.share_phone,
    pcv.share_email,
    pcv.share_birth_date,
    pcv.share_hebrew_birth_date,
    pcv.share_city,
    pcv.share_hebrew_name
  from public.community_memberships cm
  join public.profile_contact_visibility pcv
    on pcv.user_id = cm.user_id
  left join public.profiles p
    on p.id = cm.user_id
  where cm.community_id = v_community_id
    and cm.status = 'active'
    and pcv.show_in_community_directory = true
  order by
    case cm.role
      when 'admin' then 0
      when 'event_manager' then 1
      else 2
    end,
    lower(coalesce(
      nullif(p.display_name, ''),
      nullif(p.full_name, ''),
      nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      'Community member'
    )),
    cm.joined_at nulls last,
    cm.created_at;
end;
$$;

grant select, insert, update on public.profile_contact_visibility to authenticated;

revoke all on function public.get_my_contact_visibility() from public;
revoke all on function public.upsert_my_contact_visibility(
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
) from public;
revoke all on function public.list_community_contacts(uuid) from public;

grant execute on function public.get_my_contact_visibility() to authenticated;
grant execute on function public.upsert_my_contact_visibility(
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
) to authenticated;
grant execute on function public.list_community_contacts(uuid) to authenticated;

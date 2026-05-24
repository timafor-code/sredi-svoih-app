-- Community event locations dictionary for web-admin event forms.
--
-- The browser admin client uses the normal authenticated Supabase session.
-- Location management is exposed through RPCs; no service role or Admin API is
-- required.

create table if not exists public.community_event_locations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null,
  address text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint community_event_locations_title_not_empty_check
    check (btrim(title) <> ''),
  constraint community_event_locations_address_not_empty_check
    check (btrim(address) <> '')
);

create index if not exists community_event_locations_community_id_idx
  on public.community_event_locations(community_id);

create index if not exists community_event_locations_active_sort_idx
  on public.community_event_locations(
    community_id,
    is_active,
    is_default desc,
    sort_order,
    title
  );

create unique index if not exists community_event_locations_one_default_idx
  on public.community_event_locations(community_id)
  where is_default;

drop trigger if exists set_community_event_locations_updated_at
  on public.community_event_locations;

create trigger set_community_event_locations_updated_at
before update on public.community_event_locations
for each row execute function public.set_updated_at();

alter table public.community_event_locations enable row level security;

drop policy if exists "community_event_locations_select_active_by_manager"
  on public.community_event_locations;

create policy "community_event_locations_select_active_by_manager"
on public.community_event_locations
for select
to authenticated
using (
  is_active = true
  and public.has_community_role(community_id, array['admin', 'event_manager'])
);

drop policy if exists "community_event_locations_select_all_by_admin"
  on public.community_event_locations;

create policy "community_event_locations_select_all_by_admin"
on public.community_event_locations
for select
to authenticated
using (
  public.has_community_role(community_id, array['admin'])
);

drop policy if exists "community_event_locations_manage_by_admin"
  on public.community_event_locations;

create policy "community_event_locations_manage_by_admin"
on public.community_event_locations
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin'])
)
with check (
  public.has_community_role(community_id, array['admin'])
);

grant select on public.community_event_locations to authenticated;

-- Dev/test fallback seed. This deliberately avoids inventing a production
-- address: admins should replace it in Settings.
insert into public.community_event_locations (
  community_id,
  title,
  address,
  is_default,
  is_active,
  sort_order
)
select
  c.id,
  'DEV/TEST placeholder',
  'DEV/TEST only - replace with the real community address in Settings',
  true,
  true,
  100
from public.communities c
where not exists (
  select 1
  from public.community_event_locations cel
  where cel.community_id = c.id
);

create or replace function public.admin_list_community_locations()
returns setof public.community_event_locations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  return query
  select cel.*
  from public.community_event_locations cel
  where public.has_community_role(cel.community_id, array['admin'])
     or (
       cel.is_active = true
       and public.has_community_role(cel.community_id, array['admin', 'event_manager'])
     )
  order by
    cel.community_id,
    cel.is_active desc,
    cel.is_default desc,
    cel.sort_order asc,
    cel.title asc;
end;
$$;

create or replace function public.admin_create_community_location(payload jsonb)
returns public.community_event_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_location public.community_event_locations;
  v_community_text text := nullif(btrim(coalesce(
    v_payload ->> 'communityId',
    v_payload ->> 'community_id'
  )), '');
  v_community_id uuid;
  v_title text := nullif(btrim(v_payload ->> 'title'), '');
  v_address text := nullif(btrim(v_payload ->> 'address'), '');
  v_sort_order integer := 100;
  v_is_default boolean := false;
  v_is_active boolean := true;
  v_text text;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_community_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  v_community_id := v_community_text::uuid;

  if not public.has_community_role(v_community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if v_address is null then
    raise exception 'address is required' using errcode = '22023';
  end if;

  v_text := nullif(btrim(coalesce(
    v_payload ->> 'sortOrder',
    v_payload ->> 'sort_order'
  )), '');
  if v_text is not null then
    begin
      v_sort_order := v_text::integer;
    exception when others then
      raise exception 'sortOrder must be an integer' using errcode = '22023';
    end;
  end if;

  v_text := nullif(btrim(coalesce(
    v_payload ->> 'isDefault',
    v_payload ->> 'is_default'
  )), '');
  if v_text is not null then
    begin
      v_is_default := v_text::boolean;
    exception when others then
      raise exception 'isDefault must be boolean' using errcode = '22023';
    end;
  end if;

  v_text := nullif(btrim(coalesce(
    v_payload ->> 'isActive',
    v_payload ->> 'is_active'
  )), '');
  if v_text is not null then
    begin
      v_is_active := v_text::boolean;
    exception when others then
      raise exception 'isActive must be boolean' using errcode = '22023';
    end;
  end if;

  if v_is_active = false then
    v_is_default := false;
  end if;

  if v_is_default then
    update public.community_event_locations
    set is_default = false
    where community_id = v_community_id
      and is_default = true;
  end if;

  insert into public.community_event_locations (
    community_id,
    title,
    address,
    is_default,
    is_active,
    sort_order
  )
  values (
    v_community_id,
    v_title,
    v_address,
    v_is_default,
    v_is_active,
    v_sort_order
  )
  returning * into v_location;

  return v_location;
end;
$$;

create or replace function public.admin_update_community_location(
  location_id uuid,
  payload jsonb
)
returns public.community_event_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce($2, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_existing public.community_event_locations;
  v_location public.community_event_locations;
  v_has_title boolean := v_payload ? 'title';
  v_has_address boolean := v_payload ? 'address';
  v_has_sort_order boolean := v_payload ? 'sortOrder' or v_payload ? 'sort_order';
  v_has_is_default boolean := v_payload ? 'isDefault' or v_payload ? 'is_default';
  v_has_is_active boolean := v_payload ? 'isActive' or v_payload ? 'is_active';
  v_title text;
  v_address text;
  v_sort_order integer;
  v_is_default boolean;
  v_is_active boolean;
  v_text text;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.community_event_locations
  where id = $1
  for update;

  if not found then
    raise exception 'Community location not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  v_title := v_existing.title;
  v_address := v_existing.address;
  v_sort_order := v_existing.sort_order;
  v_is_default := v_existing.is_default;
  v_is_active := v_existing.is_active;

  if v_has_title then
    v_title := nullif(btrim(v_payload ->> 'title'), '');
    if v_title is null then
      raise exception 'title must not be empty' using errcode = '22023';
    end if;
  end if;

  if v_has_address then
    v_address := nullif(btrim(v_payload ->> 'address'), '');
    if v_address is null then
      raise exception 'address must not be empty' using errcode = '22023';
    end if;
  end if;

  if v_has_sort_order then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'sortOrder',
      v_payload ->> 'sort_order'
    )), '');

    if v_text is null then
      raise exception 'sortOrder must not be empty' using errcode = '22023';
    end if;

    begin
      v_sort_order := v_text::integer;
    exception when others then
      raise exception 'sortOrder must be an integer' using errcode = '22023';
    end;
  end if;

  if v_has_is_default then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'isDefault',
      v_payload ->> 'is_default'
    )), '');

    if v_text is null then
      raise exception 'isDefault must not be empty' using errcode = '22023';
    end if;

    begin
      v_is_default := v_text::boolean;
    exception when others then
      raise exception 'isDefault must be boolean' using errcode = '22023';
    end;
  end if;

  if v_has_is_active then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'isActive',
      v_payload ->> 'is_active'
    )), '');

    if v_text is null then
      raise exception 'isActive must not be empty' using errcode = '22023';
    end if;

    begin
      v_is_active := v_text::boolean;
    exception when others then
      raise exception 'isActive must be boolean' using errcode = '22023';
    end;
  end if;

  if v_is_active = false then
    v_is_default := false;
  end if;

  if v_is_default then
    update public.community_event_locations
    set is_default = false
    where community_id = v_existing.community_id
      and id <> v_existing.id
      and is_default = true;
  end if;

  update public.community_event_locations
  set
    title = v_title,
    address = v_address,
    sort_order = v_sort_order,
    is_default = v_is_default,
    is_active = v_is_active
  where id = v_existing.id
  returning * into v_location;

  return v_location;
end;
$$;

create or replace function public.admin_archive_community_location(location_id uuid)
returns public.community_event_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.community_event_locations;
  v_location public.community_event_locations;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.community_event_locations
  where id = $1
  for update;

  if not found then
    raise exception 'Community location not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  update public.community_event_locations
  set
    is_active = false,
    is_default = false
  where id = v_existing.id
  returning * into v_location;

  return v_location;
end;
$$;

revoke all on function public.admin_list_community_locations() from public;
revoke all on function public.admin_create_community_location(jsonb) from public;
revoke all on function public.admin_update_community_location(uuid, jsonb) from public;
revoke all on function public.admin_archive_community_location(uuid) from public;

grant execute on function public.admin_list_community_locations() to authenticated;
grant execute on function public.admin_create_community_location(jsonb) to authenticated;
grant execute on function public.admin_update_community_location(uuid, jsonb) to authenticated;
grant execute on function public.admin_archive_community_location(uuid) to authenticated;

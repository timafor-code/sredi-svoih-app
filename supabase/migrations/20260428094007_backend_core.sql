-- backend_core for Среди Своих

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Communities
-- ------------------------------------------------------------

alter table public.communities
  add column if not exists slug text,
  add column if not exists country text default 'RU',
  add column if not exists timezone text default 'Europe/Moscow',
  add column if not exists logo_url text,
  add column if not exists website_url text,
  add column if not exists is_active boolean not null default true;

create unique index if not exists communities_slug_key
  on public.communities (slug)
  where slug is not null;

-- ------------------------------------------------------------
-- 2. Profiles
-- ------------------------------------------------------------

alter table public.profiles
  alter column full_name drop not null;

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists birth_date date,
  add column if not exists hebrew_birth_date jsonb,
  add column if not exists nusach text default 'chabad',
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set display_name = coalesce(display_name, full_name)
where display_name is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_auth_users_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_id_auth_users_fkey
      foreign key (id) references auth.users(id)
      on delete cascade
      not valid;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Community memberships
-- ------------------------------------------------------------

create table if not exists public.community_memberships (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),

  constraint community_memberships_role_check
    check (role in ('member', 'event_manager', 'admin')),

  constraint community_memberships_status_check
    check (status in ('pending', 'active', 'suspended', 'left')),

  constraint community_memberships_unique_user_community
    unique (community_id, user_id)
);

create index if not exists community_memberships_user_id_idx
  on public.community_memberships(user_id);

create index if not exists community_memberships_community_id_idx
  on public.community_memberships(community_id);

-- ------------------------------------------------------------
-- 4. Invites
-- ------------------------------------------------------------

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  code_hash text not null,
  email text,
  phone text,
  role text not null default 'member',
  max_uses integer not null default 1,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),

  constraint invites_role_check
    check (role in ('member', 'event_manager', 'admin')),

  constraint invites_status_check
    check (status in ('active', 'used', 'expired', 'revoked')),

  constraint invites_usage_check
    check (max_uses > 0 and used_count >= 0 and used_count <= max_uses)
);

create unique index if not exists invites_code_hash_key
  on public.invites(code_hash);

create index if not exists invites_community_id_idx
  on public.invites(community_id);

-- ------------------------------------------------------------
-- 5. Events
-- ------------------------------------------------------------

alter table public.events
  add column if not exists subtitle text,
  add column if not exists description text,
  add column if not exists short_description text,

  add column if not exists ends_at timestamptz,
  add column if not exists timezone text default 'Europe/Moscow',

  add column if not exists location_name text,
  add column if not exists address text,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),

  add column if not exists image_url text,
  add column if not exists category text default 'community',
  add column if not exists audience text default 'all',

  add column if not exists visibility text not null default 'public',
  add column if not exists status text not null default 'published',

  add column if not exists source_type text not null default 'manual',
  add column if not exists source_url text,
  add column if not exists source_external_id text,
  add column if not exists manual_override boolean not null default false,

  add column if not exists registration_mode text not null default 'none',
  add column if not exists registration_url text,

  add column if not exists capacity integer,
  add column if not exists waitlist_enabled boolean not null default false,
  add column if not exists requires_approval boolean not null default false,

  add column if not exists price_amount integer,
  add column if not exists price_currency text default 'RUB',

  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists published_at timestamptz;

update public.events
set capacity = coalesce(capacity, seats_total)
where capacity is null
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'seats_total'
  );

update public.events
set published_at = coalesce(published_at, created_at, now())
where status = 'published'
  and published_at is null;

create index if not exists events_community_id_idx
  on public.events(community_id);

create index if not exists events_status_visibility_starts_at_idx
  on public.events(status, visibility, starts_at);

create index if not exists events_source_external_id_idx
  on public.events(source_type, source_external_id)
  where source_external_id is not null;

-- ------------------------------------------------------------
-- 6. Event registrations
-- ------------------------------------------------------------

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  status text not null default 'pending',
  seats_count integer not null default 1,
  guest_names jsonb not null default '[]'::jsonb,
  comment text,

  registered_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,

  payment_status text not null default 'not_required',
  payment_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_registrations_status_check
    check (status in ('pending', 'confirmed', 'waitlisted', 'cancelled', 'rejected', 'attended', 'no_show')),

  constraint event_registrations_seats_count_check
    check (seats_count > 0)
);

alter table public.event_registrations
  add column if not exists user_id uuid,
  add column if not exists status text not null default 'pending',
  add column if not exists seats_count integer not null default 1,
  add column if not exists guest_names jsonb not null default '[]'::jsonb,
  add column if not exists comment text,
  add column if not exists registered_at timestamptz not null default now(),
  add column if not exists confirmed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_id uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_event_id_fkey'
  ) then
    alter table public.event_registrations
      add constraint event_registrations_event_id_fkey
      foreign key (event_id) references public.events(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_user_id_fkey'
  ) then
    alter table public.event_registrations
      add constraint event_registrations_user_id_fkey
      foreign key (user_id) references auth.users(id)
      on delete cascade
      not valid;
  end if;
end $$;

create index if not exists event_registrations_event_id_idx
  on public.event_registrations(event_id);

create index if not exists event_registrations_user_id_idx
  on public.event_registrations(user_id);

create index if not exists event_registrations_status_idx
  on public.event_registrations(status);

-- ------------------------------------------------------------
-- 7. Event import
-- ------------------------------------------------------------

create table if not exists public.event_import_sources (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null,
  source_type text not null default 'website_scrape',
  url text not null,
  parser_name text not null,
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.event_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.event_import_sources(id) on delete cascade,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  found_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,

  constraint event_import_runs_status_check
    check (status in ('started', 'success', 'failed'))
);

create table if not exists public.event_import_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.event_import_sources(id) on delete cascade,
  run_id uuid references public.event_import_runs(id) on delete set null,
  external_id text,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid references public.events(id) on delete set null,
  status text not null default 'new',
  created_at timestamptz not null default now(),

  constraint event_import_items_status_check
    check (status in ('new', 'linked', 'ignored', 'error'))
);

create index if not exists event_import_sources_community_id_idx
  on public.event_import_sources(community_id);

create index if not exists event_import_runs_source_id_idx
  on public.event_import_runs(source_id);

create index if not exists event_import_items_source_id_idx
  on public.event_import_items(source_id);

create index if not exists event_import_items_external_id_idx
  on public.event_import_items(source_id, external_id)
  where external_id is not null;

-- ------------------------------------------------------------
-- 8. Payments placeholder
-- ------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  registration_id uuid,

  provider text not null default 'manual',
  provider_payment_id text,
  provider_checkout_url text,

  amount integer not null default 0,
  currency text not null default 'RUB',

  status text not null default 'created',
  raw_provider_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_provider_check
    check (provider in ('stripe', 'payplus', 'tranzila', 'manual')),

  constraint payments_status_check
    check (status in ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded'))
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade,
  provider text not null,
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_payment_id_fkey'
  ) then
    alter table public.event_registrations
      add constraint event_registrations_payment_id_fkey
      foreign key (payment_id) references public.payments(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_registration_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_registration_id_fkey
      foreign key (registration_id) references public.event_registrations(id)
      on delete set null
      not valid;
  end if;
end $$;

create index if not exists payments_user_id_idx
  on public.payments(user_id);

create index if not exists payments_event_id_idx
  on public.payments(event_id);

create index if not exists payments_status_idx
  on public.payments(status);

create unique index if not exists payment_events_provider_event_key
  on public.payment_events(provider, provider_event_id)
  where provider_event_id is not null;

-- ------------------------------------------------------------
-- 9. Device tokens - later
-- ------------------------------------------------------------

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text,
  device_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists device_tokens_expo_push_token_key
  on public.device_tokens(expo_push_token);

create index if not exists device_tokens_user_id_idx
  on public.device_tokens(user_id);

-- ------------------------------------------------------------
-- 10. Helper functions
-- ------------------------------------------------------------

create or replace function public.is_active_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_memberships cm
    where cm.community_id = p_community_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

create or replace function public.has_community_role(
  p_community_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_memberships cm
    where cm.community_id = p_community_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = any(p_roles)
  );
$$;

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
  where code_hash = encode(digest(invite_code, 'sha256'), 'hex')
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

create or replace function public.register_for_event(
  p_event_id uuid,
  p_seats_count integer default 1,
  p_comment text default null
)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_registration public.event_registrations;
  v_user_id uuid := auth.uid();
  v_taken_seats integer := 0;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Auth required';
  end if;

  if p_seats_count is null or p_seats_count < 1 then
    raise exception 'seats_count must be greater than zero';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
    and status = 'published'
    and registration_mode in ('internal_free', 'internal_paid')
  for update;

  if not found then
    raise exception 'Event is not available for internal registration';
  end if;

  if v_event.registration_mode = 'internal_paid' then
    raise exception 'Internal paid registration is not implemented yet';
  end if;

  if v_event.visibility = 'members_only'
     and not public.is_active_member(v_event.community_id) then
    raise exception 'Community membership required';
  end if;

  select coalesce(sum(seats_count), 0)
  into v_taken_seats
  from public.event_registrations
  where event_id = p_event_id
    and status in ('confirmed', 'pending');

  if v_event.capacity is not null
     and v_taken_seats + p_seats_count > v_event.capacity then
    if v_event.waitlist_enabled then
      v_status := 'waitlisted';
    else
      raise exception 'No seats available';
    end if;
  elsif v_event.requires_approval then
    v_status := 'pending';
  else
    v_status := 'confirmed';
  end if;

  insert into public.event_registrations (
    event_id,
    user_id,
    status,
    seats_count,
    comment,
    registered_at,
    confirmed_at
  )
  values (
    p_event_id,
    v_user_id,
    v_status,
    p_seats_count,
    p_comment,
    now(),
    case when v_status = 'confirmed' then now() else null end
  )
  returning * into v_registration;

  return v_registration;
end;
$$;

-- ------------------------------------------------------------
-- 11. updated_at triggers
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row execute function public.set_updated_at();

drop trigger if exists set_event_registrations_updated_at on public.event_registrations;
create trigger set_event_registrations_updated_at
before update on public.event_registrations
for each row execute function public.set_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists set_device_tokens_updated_at on public.device_tokens;
create trigger set_device_tokens_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 12. RLS reset for backend core tables
-- ------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'communities',
        'profiles',
        'community_memberships',
        'invites',
        'events',
        'event_registrations',
        'event_import_sources',
        'event_import_runs',
        'event_import_items',
        'payments',
        'payment_events',
        'device_tokens'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );
  end loop;
end $$;

alter table public.communities enable row level security;
alter table public.profiles enable row level security;
alter table public.community_memberships enable row level security;
alter table public.invites enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_import_sources enable row level security;
alter table public.event_import_runs enable row level security;
alter table public.event_import_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.device_tokens enable row level security;

-- communities
create policy "communities_select_active"
on public.communities
for select
to anon, authenticated
using (is_active = true);

-- profiles
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- community_memberships
create policy "memberships_select_own"
on public.community_memberships
for select
to authenticated
using (user_id = auth.uid());

create policy "memberships_select_by_admin"
on public.community_memberships
for select
to authenticated
using (
  public.has_community_role(community_id, array['admin'])
);

create policy "memberships_manage_by_admin"
on public.community_memberships
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin'])
)
with check (
  public.has_community_role(community_id, array['admin'])
);

-- invites
create policy "invites_manage_by_admin"
on public.invites
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin'])
)
with check (
  public.has_community_role(community_id, array['admin'])
);

-- events
create policy "events_select_public_published"
on public.events
for select
to anon, authenticated
using (
  status = 'published'
  and visibility = 'public'
);

create policy "events_select_members_published"
on public.events
for select
to authenticated
using (
  status = 'published'
  and visibility = 'members_only'
  and public.is_active_member(community_id)
);

create policy "events_select_by_manager"
on public.events
for select
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

create policy "events_manage_by_manager"
on public.events
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
)
with check (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

-- event registrations
create policy "event_registrations_select_own"
on public.event_registrations
for select
to authenticated
using (user_id = auth.uid());

create policy "event_registrations_select_by_manager"
on public.event_registrations
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_registrations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

create policy "event_registrations_insert_own"
on public.event_registrations
for insert
to authenticated
with check (
  user_id = auth.uid()
);

create policy "event_registrations_cancel_own"
on public.event_registrations
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and status = 'cancelled'
);

create policy "event_registrations_manage_by_manager"
on public.event_registrations
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_registrations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_registrations.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

-- event import
create policy "event_import_sources_manage_by_manager"
on public.event_import_sources
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
)
with check (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

create policy "event_import_runs_manage_by_manager"
on public.event_import_runs
for all
to authenticated
using (
  exists (
    select 1
    from public.event_import_sources s
    where s.id = event_import_runs.source_id
      and public.has_community_role(s.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.event_import_sources s
    where s.id = event_import_runs.source_id
      and public.has_community_role(s.community_id, array['admin', 'event_manager'])
  )
);

create policy "event_import_items_manage_by_manager"
on public.event_import_items
for all
to authenticated
using (
  exists (
    select 1
    from public.event_import_sources s
    where s.id = event_import_items.source_id
      and public.has_community_role(s.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.event_import_sources s
    where s.id = event_import_items.source_id
      and public.has_community_role(s.community_id, array['admin', 'event_manager'])
  )
);

-- payments
create policy "payments_select_own"
on public.payments
for select
to authenticated
using (user_id = auth.uid());

create policy "payments_select_by_manager"
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = payments.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

create policy "payment_events_select_by_manager"
on public.payment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.payments p
    join public.events e on e.id = p.event_id
    where p.id = payment_events.payment_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

-- device tokens
create policy "device_tokens_select_own"
on public.device_tokens
for select
to authenticated
using (user_id = auth.uid());

create policy "device_tokens_insert_own"
on public.device_tokens
for insert
to authenticated
with check (user_id = auth.uid());

create policy "device_tokens_update_own"
on public.device_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 13. Grants
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.communities to anon, authenticated;
grant select on public.events to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.community_memberships to authenticated;
grant select, insert, update on public.event_registrations to authenticated;
grant select, insert, update on public.device_tokens to authenticated;

grant select, insert, update, delete on public.invites to authenticated;
grant select, insert, update, delete on public.event_import_sources to authenticated;
grant select, insert, update, delete on public.event_import_runs to authenticated;
grant select, insert, update, delete on public.event_import_items to authenticated;
grant select on public.payments to authenticated;
grant select on public.payment_events to authenticated;

grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.register_for_event(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------
-- 14. Seed data
-- ------------------------------------------------------------

insert into public.communities (
  id,
  name,
  slug,
  city,
  country,
  timezone,
  website_url,
  is_active
)
values (
  '00000000-0000-0000-0000-000000000001',
  'Среди Своих',
  'sredi-svoih',
  'Москва',
  'RU',
  'Europe/Moscow',
  'https://www.sredisvoih.com/',
  true
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  city = excluded.city,
  country = excluded.country,
  timezone = excluded.timezone,
  website_url = excluded.website_url,
  is_active = excluded.is_active;

insert into public.events (
  id,
  community_id,
  title,
  subtitle,
  short_description,
  description,
  starts_at,
  ends_at,
  timezone,
  location_name,
  address,
  category,
  audience,
  visibility,
  status,
  source_type,
  manual_override,
  registration_mode,
  capacity,
  waitlist_enabled,
  requires_approval,
  published_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Тестовая лекция в общине',
  'Internal free registration',
  'Проверочное бесплатное событие с регистрацией внутри приложения.',
  'Тестовое событие для проверки таблицы events и внутренней бесплатной регистрации.',
  '2026-05-05 19:00:00+03',
  '2026-05-05 21:00:00+03',
  'Europe/Moscow',
  'Синагога Среди Своих',
  'Москва',
  'lecture',
  'all',
  'public',
  'published',
  'manual',
  true,
  'internal_free',
  50,
  true,
  false,
  now()
)
on conflict (id) do update set
  title = excluded.title,
  subtitle = excluded.subtitle,
  short_description = excluded.short_description,
  description = excluded.description,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  timezone = excluded.timezone,
  location_name = excluded.location_name,
  address = excluded.address,
  category = excluded.category,
  audience = excluded.audience,
  visibility = excluded.visibility,
  status = excluded.status,
  source_type = excluded.source_type,
  manual_override = excluded.manual_override,
  registration_mode = excluded.registration_mode,
  capacity = excluded.capacity,
  waitlist_enabled = excluded.waitlist_enabled,
  requires_approval = excluded.requires_approval,
  published_at = excluded.published_at;

insert into public.events (
  id,
  community_id,
  title,
  subtitle,
  short_description,
  description,
  starts_at,
  ends_at,
  timezone,
  location_name,
  address,
  category,
  audience,
  visibility,
  status,
  source_type,
  source_url,
  manual_override,
  registration_mode,
  registration_url,
  published_at
)
values (
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Тестовое событие с внешней записью',
  'External link registration',
  'Проверочное событие, где кнопка записи открывает внешнюю ссылку.',
  'Тестовое событие для проверки registration_mode = external_link.',
  '2026-05-08 18:30:00+03',
  '2026-05-08 20:30:00+03',
  'Europe/Moscow',
  'Среди Своих',
  'Москва',
  'community',
  'all',
  'public',
  'published',
  'external',
  'https://www.sredisvoih.com/events/',
  true,
  'external_link',
  'https://www.sredisvoih.com/events/',
  now()
)
on conflict (id) do update set
  title = excluded.title,
  subtitle = excluded.subtitle,
  short_description = excluded.short_description,
  description = excluded.description,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  timezone = excluded.timezone,
  location_name = excluded.location_name,
  address = excluded.address,
  category = excluded.category,
  audience = excluded.audience,
  visibility = excluded.visibility,
  status = excluded.status,
  source_type = excluded.source_type,
  source_url = excluded.source_url,
  manual_override = excluded.manual_override,
  registration_mode = excluded.registration_mode,
  registration_url = excluded.registration_url,
  published_at = excluded.published_at;

insert into public.event_import_sources (
  id,
  community_id,
  name,
  source_type,
  url,
  parser_name,
  is_active
)
values (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Сайт Среди Своих — события',
  'website_scrape',
  'https://www.sredisvoih.com/events/',
  'sredi_svoih_events',
  true
)
on conflict (id) do update set
  community_id = excluded.community_id,
  name = excluded.name,
  source_type = excluded.source_type,
  url = excluded.url,
  parser_name = excluded.parser_name,
  is_active = excluded.is_active;
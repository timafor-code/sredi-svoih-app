-- Participation options schema for Среди Своих

create table if not exists public.event_participation_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  title text not null,
  description text,

  price_amount integer not null default 0,
  price_currency text not null default 'RUB',

  option_type text not null default 'participation',

  seat_limit integer,
  allow_quantity boolean not null default false,
  min_quantity integer not null default 1,
  max_quantity integer not null default 1,

  is_donation boolean not null default false,
  counts_toward_capacity boolean not null default true,

  group_key text,
  conflicts_with jsonb not null default '[]'::jsonb,

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_participation_options_price_amount_check
    check (price_amount >= 0),

  constraint event_participation_options_price_currency_check
    check (btrim(price_currency) <> ''),

  constraint event_participation_options_option_type_check
    check (option_type in (
      'participation',
      'meal',
      'package',
      'donation',
      'child',
      'family',
      'other'
    )),

  constraint event_participation_options_seat_limit_check
    check (seat_limit is null or seat_limit > 0),

  constraint event_participation_options_min_quantity_check
    check (min_quantity >= 1),

  constraint event_participation_options_max_quantity_check
    check (max_quantity >= min_quantity),

  constraint event_participation_options_allow_quantity_check
    check (
      allow_quantity = true
      or (min_quantity = 1 and max_quantity = 1)
    ),

  constraint event_participation_options_conflicts_with_array_check
    check (jsonb_typeof(conflicts_with) = 'array')
);

create index if not exists event_participation_options_event_id_idx
  on public.event_participation_options(event_id);

create index if not exists event_participation_options_active_sort_idx
  on public.event_participation_options(event_id, is_active, sort_order);

create table if not exists public.event_registration_option_selections (
  id uuid primary key default gen_random_uuid(),

  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  option_id uuid references public.event_participation_options(id) on delete set null,

  title_snapshot text not null,
  description_snapshot text,
  option_type_snapshot text not null,

  quantity integer not null default 1,
  unit_price_amount integer not null default 0,
  total_amount integer not null default 0,
  currency text not null default 'RUB',

  counts_toward_capacity boolean not null default true,
  seats_count integer not null default 0,
  is_donation boolean not null default false,

  created_at timestamptz not null default now(),

  constraint event_registration_option_selections_quantity_check
    check (quantity > 0),

  constraint event_registration_option_selections_unit_price_amount_check
    check (unit_price_amount >= 0),

  constraint event_registration_option_selections_total_amount_check
    check (total_amount >= 0),

  constraint event_registration_option_selections_currency_check
    check (btrim(currency) <> ''),

  constraint event_registration_option_selections_seats_count_check
    check (seats_count >= 0)
);

create index if not exists event_registration_option_selections_registration_id_idx
  on public.event_registration_option_selections(registration_id);

create index if not exists event_registration_option_selections_option_id_idx
  on public.event_registration_option_selections(option_id);

drop trigger if exists set_event_participation_options_updated_at
  on public.event_participation_options;

create trigger set_event_participation_options_updated_at
before update on public.event_participation_options
for each row execute function public.set_updated_at();

alter table public.event_participation_options enable row level security;
alter table public.event_registration_option_selections enable row level security;

drop policy if exists "event_participation_options_select_public_published"
  on public.event_participation_options;

create policy "event_participation_options_select_public_published"
on public.event_participation_options
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.events e
    where e.id = event_participation_options.event_id
      and e.status = 'published'
      and e.visibility = 'public'
  )
);

drop policy if exists "event_participation_options_select_members_published"
  on public.event_participation_options;

create policy "event_participation_options_select_members_published"
on public.event_participation_options
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.events e
    where e.id = event_participation_options.event_id
      and e.status = 'published'
      and e.visibility = 'members_only'
      and public.is_active_member(e.community_id)
  )
);

drop policy if exists "event_participation_options_select_by_manager"
  on public.event_participation_options;

create policy "event_participation_options_select_by_manager"
on public.event_participation_options
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_options.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_participation_options_manage_by_manager"
  on public.event_participation_options;

create policy "event_participation_options_manage_by_manager"
on public.event_participation_options
for all
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_options.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_participation_options.event_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_registration_option_selections_select_own"
  on public.event_registration_option_selections;

create policy "event_registration_option_selections_select_own"
on public.event_registration_option_selections
for select
to authenticated
using (
  exists (
    select 1
    from public.event_registrations r
    where r.id = event_registration_option_selections.registration_id
      and r.user_id = auth.uid()
  )
);

drop policy if exists "event_registration_option_selections_select_by_manager"
  on public.event_registration_option_selections;

create policy "event_registration_option_selections_select_by_manager"
on public.event_registration_option_selections
for select
to authenticated
using (
  exists (
    select 1
    from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.id = event_registration_option_selections.registration_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_registration_option_selections_manage_by_manager"
  on public.event_registration_option_selections;

create policy "event_registration_option_selections_manage_by_manager"
on public.event_registration_option_selections
for all
to authenticated
using (
  exists (
    select 1
    from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.id = event_registration_option_selections.registration_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
)
with check (
  exists (
    select 1
    from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.id = event_registration_option_selections.registration_id
      and public.has_community_role(e.community_id, array['admin', 'event_manager'])
  )
);

grant select on public.event_participation_options to anon, authenticated;
grant insert, update, delete on public.event_participation_options to authenticated;

grant select on public.event_registration_option_selections to authenticated;
grant insert, update, delete on public.event_registration_option_selections to authenticated;

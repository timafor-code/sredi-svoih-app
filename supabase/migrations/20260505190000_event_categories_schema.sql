-- Event categories taxonomy for Среди Своих
--
-- Replaces free-text events.category with a managed dictionary in
-- public.event_categories. Each community owns its own set of categories.
-- Existing events.category values are normalized to canonical slugs and a
-- composite foreign key (community_id, category) -> (community_id, slug)
-- guarantees that mobile clients always resolve a known category record.

-- ------------------------------------------------------------
-- 1. event_categories table
-- ------------------------------------------------------------

create table if not exists public.event_categories (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  color text not null default '#7B68EE',
  icon text not null default '✡️',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_categories_slug_format_check
    check (slug ~ '^[a-z0-9][a-z0-9_]{1,63}$'),
  constraint event_categories_color_format_check
    check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint event_categories_title_not_empty_check
    check (btrim(title) <> ''),
  constraint event_categories_icon_not_empty_check
    check (btrim(icon) <> ''),
  constraint event_categories_unique_slug_per_community
    unique (community_id, slug)
);

create index if not exists event_categories_community_id_idx
  on public.event_categories(community_id);

create index if not exists event_categories_active_sort_idx
  on public.event_categories(community_id, is_active, sort_order);

drop trigger if exists set_event_categories_updated_at
  on public.event_categories;

create trigger set_event_categories_updated_at
before update on public.event_categories
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Seed canonical categories for every community
-- ------------------------------------------------------------

with seed(slug, title, color, icon, sort_order) as (
  values
    ('lecture',   'Лекции',     '#4A90D9', '📚',  10),
    ('class',     'Занятия',    '#6B7FD4', '📖',  20),
    ('holiday',   'Праздники',  '#F07A2A', '🕯️', 30),
    ('shabbat',   'Шаббат',     '#F6A400', '🕯️', 40),
    ('children',  'Детские',    '#E84393', '🎨',  50),
    ('tour',      'Экскурсии',  '#11A7A0', '🏛️', 60),
    ('community', 'Общинные',   '#7B68EE', '✡️',  70),
    ('other',     'Другое',     '#99A5B7', '•',   999)
)
insert into public.event_categories (
  community_id,
  slug,
  title,
  color,
  icon,
  sort_order,
  is_active
)
select c.id, s.slug, s.title, s.color, s.icon, s.sort_order, true
from public.communities c
cross join seed s
on conflict (community_id, slug) do nothing;

-- ------------------------------------------------------------
-- 3. Normalize existing events.category values to canonical slugs
-- ------------------------------------------------------------

update public.events
set category = case
  when category is null or btrim(category) = '' then 'community'
  when lower(btrim(category)) in (
    'holiday', 'holidays', 'hollidays',
    'праздник', 'праздники'
  ) then 'holiday'
  when lower(btrim(category)) in ('shabbat', 'шаббат', 'шабат') then 'shabbat'
  when lower(btrim(category)) in (
    'lecture', 'lectures', 'лекция', 'лекции'
  ) then 'lecture'
  when lower(btrim(category)) in (
    'class', 'classes', 'занятие', 'занятия', 'класс'
  ) then 'class'
  when lower(btrim(category)) in (
    'children', 'kids', 'дети', 'детские'
  ) then 'children'
  when lower(btrim(category)) in (
    'tour', 'tours', 'экскурсия', 'экскурсии'
  ) then 'tour'
  when lower(btrim(category)) in (
    'community', 'communal', 'общинное', 'общинные', 'община'
  ) then 'community'
  else lower(btrim(category))
end;

-- Anything that does not resolve to an existing category for the event's
-- community is forced to 'other'. The 'other' seed above guarantees the
-- target slug exists for every community.
update public.events e
set category = 'other'
where not exists (
  select 1
  from public.event_categories c
  where c.community_id = e.community_id
    and c.slug = e.category
);

-- ------------------------------------------------------------
-- 4. Lock down events.category and link it to event_categories
-- ------------------------------------------------------------

alter table public.events
  alter column category set default 'community',
  alter column category set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_category_event_categories_fkey'
  ) then
    alter table public.events
      add constraint events_category_event_categories_fkey
      foreign key (community_id, category)
      references public.event_categories (community_id, slug)
      on update cascade
      on delete restrict;
  end if;
end $$;

create index if not exists events_community_id_category_idx
  on public.events(community_id, category);

-- ------------------------------------------------------------
-- 5. Row Level Security
-- ------------------------------------------------------------

alter table public.event_categories enable row level security;

drop policy if exists "event_categories_select_active_community"
  on public.event_categories;

create policy "event_categories_select_active_community"
on public.event_categories
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.communities c
    where c.id = event_categories.community_id
      and c.is_active = true
  )
);

drop policy if exists "event_categories_manage_by_manager"
  on public.event_categories;

create policy "event_categories_manage_by_manager"
on public.event_categories
for all
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
)
with check (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

grant select on public.event_categories to anon, authenticated;
grant insert, update, delete on public.event_categories to authenticated;

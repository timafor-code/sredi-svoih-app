-- Seed local MVP members-only event for RLS/manual app checks.

with seed_community as (
  select
    id,
    coalesce(nullif(timezone, ''), 'Europe/Moscow') as timezone
  from public.communities
  where slug = 'sredi-svoih'
     or name = 'Среди Своих'
  order by case when slug = 'sredi-svoih' then 0 else 1 end
  limit 1
),
event_values as (
  select
    gen_random_uuid() as id,
    id as community_id,
    now() + interval '14 days' as starts_at,
    timezone
  from seed_community
)
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
  source_external_id,
  registration_mode,
  capacity,
  waitlist_enabled,
  requires_approval,
  published_at
)
select
  id,
  community_id,
  'Закрытая встреча участников общины',
  'Только для участников',
  'Тестовое событие, доступное только active members.',
  'Это dev-событие нужно для проверки RLS и отображения members_only мероприятий.',
  starts_at,
  starts_at + interval '2 hours',
  timezone,
  'Среди Своих',
  'Москва',
  'community',
  'all',
  'members_only',
  'published',
  'manual',
  'dev-members-only-event',
  'internal_free',
  20,
  true,
  false,
  now()
from event_values
where not exists (
  select 1
  from public.events e
  where e.source_external_id = 'dev-members-only-event'
);

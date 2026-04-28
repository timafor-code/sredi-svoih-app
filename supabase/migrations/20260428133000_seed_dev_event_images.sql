-- Add public demo images to local/dev seed events.
-- Keep this idempotent: only fill empty image_url values and never create events.

update public.events
set image_url = 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80'
where (
    id = '10000000-0000-0000-0000-000000000001'
    or source_external_id in ('dev-internal-free-event', 'test-internal-free-event')
    or title = 'Тестовая лекция в общине'
  )
  and nullif(btrim(image_url), '') is null;

update public.events
set image_url = 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=80'
where (
    id = '10000000-0000-0000-0000-000000000002'
    or source_external_id in ('dev-external-link-event', 'test-external-link-event')
    or title = 'Тестовое событие с внешней записью'
  )
  and nullif(btrim(image_url), '') is null;

update public.events
set image_url = 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80'
where (
    source_external_id in ('dev-internal-paid-event', 'test-internal-paid-event')
    or title in ('Тестовое платное событие', 'Платное тестовое событие')
    or (
      registration_mode = 'internal_paid'
      and title ilike '%тест%'
    )
  )
  and nullif(btrim(image_url), '') is null;

update public.events
set image_url = 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1200&q=80'
where (
    source_external_id in ('dev-members-only-event', 'test-members-only-event')
    or title = 'Закрытая встреча участников общины'
  )
  and nullif(btrim(image_url), '') is null;

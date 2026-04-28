-- Use a real public Sredi Svoih image for the main dev lecture event.
-- Also updates local/dev databases that already received the previous demo URL.

update public.events
set image_url = 'https://www.sredisvoih.com/upload/iblock/06c/ckujoqkozeaqm6rj9mxdbnfaly722e9t.jpg'
where (
    id = '10000000-0000-0000-0000-000000000001'
    or source_external_id in ('dev-internal-free-event', 'test-internal-free-event')
    or title = 'Тестовая лекция в общине'
  )
  and (
    nullif(btrim(image_url), '') is null
    or image_url = 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80'
  );

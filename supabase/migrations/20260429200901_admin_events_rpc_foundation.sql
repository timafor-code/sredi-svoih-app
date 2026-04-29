-- Admin Events Center RPC foundation.
-- Client code calls these functions with the normal authenticated Supabase
-- session. Permission checks stay tied to community roles.

create or replace function public.admin_list_import_items_needing_review(
  limit_count integer default 50
)
returns table (
  id uuid,
  source_id uuid,
  run_id uuid,
  external_id text,
  source_url text,
  raw_payload jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid,
  status text,
  created_at timestamptz,
  source_name text,
  community_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(limit_count, 50), 1), 100);
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  return query
  select
    i.id,
    i.source_id,
    i.run_id,
    i.external_id,
    i.source_url,
    i.raw_payload,
    i.parsed_title,
    i.parsed_starts_at,
    i.parsed_location,
    i.linked_event_id,
    i.status,
    i.created_at,
    s.name as source_name,
    s.community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where public.has_community_role(s.community_id, array['admin', 'event_manager'])
    and i.linked_event_id is null
    and (
      i.status in ('new', 'error')
      or i.status is null
      or (
        i.status = 'ignored'
        and i.raw_payload #>> '{adminReview,ignoredAt}' is null
        and (
          lower(coalesce(i.raw_payload #>> '{importReview,dateStatus}', '')) in (
            'needs_review',
            'needs-review',
            'review'
          )
          or lower(coalesce(i.raw_payload #>> '{importReview,dateConfidence}', '')) not in (
            '',
            'confident'
          )
          or lower(coalesce(
            i.raw_payload #>> '{importReview,reviewNeeded}',
            i.raw_payload #>> '{importReview,needsReview}',
            ''
          )) in ('true', '1', 'yes')
        )
      )
    )
    and (
      i.status = 'error'
      or i.raw_payload -> 'importReview' is null
      or lower(coalesce(i.raw_payload #>> '{importReview,dateStatus}', '')) not in (
        'ready',
        'confident',
        'published',
        'linked'
      )
      or lower(coalesce(i.raw_payload #>> '{importReview,dateConfidence}', '')) not in (
        'confident'
      )
      or lower(coalesce(
        i.raw_payload #>> '{importReview,reviewNeeded}',
        i.raw_payload #>> '{importReview,needsReview}',
        ''
      )) in ('true', '1', 'yes')
    )
  order by i.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_get_import_item(import_item_id uuid)
returns table (
  id uuid,
  source_id uuid,
  run_id uuid,
  external_id text,
  source_url text,
  raw_payload jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid,
  status text,
  created_at timestamptz,
  source_name text,
  community_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select s.community_id
  into v_community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id;

  if not found then
    raise exception 'Import item not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.source_id,
    i.run_id,
    i.external_id,
    i.source_url,
    i.raw_payload,
    i.parsed_title,
    i.parsed_starts_at,
    i.parsed_location,
    i.linked_event_id,
    i.status,
    i.created_at,
    s.name as source_name,
    s.community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id;
end;
$$;

create or replace function public.admin_create_event(payload jsonb)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_community_id uuid;
  v_community_text text := nullif(coalesce(
    v_payload ->> 'communityId',
    v_payload ->> 'community_id'
  ), '');
  v_title text := nullif(v_payload ->> 'title', '');
  v_starts_text text := nullif(coalesce(
    v_payload ->> 'startsAt',
    v_payload ->> 'starts_at'
  ), '');
  v_registration_mode text := nullif(coalesce(
    v_payload ->> 'registrationMode',
    v_payload ->> 'registration_mode'
  ), '');
  v_category text := nullif(v_payload ->> 'category', '');
  v_visibility text := coalesce(nullif(v_payload ->> 'visibility', ''), 'public');
  v_status text := coalesce(nullif(v_payload ->> 'status', ''), 'draft');
  v_timezone text := coalesce(nullif(v_payload ->> 'timezone', ''), 'Europe/Moscow');
  v_registration_url text := nullif(coalesce(
    v_payload ->> 'registrationUrl',
    v_payload ->> 'registration_url'
  ), '');
  v_published_at timestamptz := nullif(coalesce(
    v_payload ->> 'publishedAt',
    v_payload ->> 'published_at'
  ), '')::timestamptz;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_community_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  v_community_id := v_community_text::uuid;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if v_starts_text is null then
    raise exception 'startsAt is required' using errcode = '22023';
  end if;

  if v_category is null then
    raise exception 'category is required' using errcode = '22023';
  end if;

  if v_registration_mode is null then
    raise exception 'registrationMode is required' using errcode = '22023';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  if v_visibility not in ('public', 'members_only', 'hidden') then
    raise exception 'visibility is invalid' using errcode = '22023';
  end if;

  if v_status not in ('draft', 'published', 'cancelled', 'archived') then
    raise exception 'status is invalid' using errcode = '22023';
  end if;

  if v_registration_mode not in ('none', 'external_link', 'internal_free', 'internal_paid') then
    raise exception 'registrationMode is invalid' using errcode = '22023';
  end if;

  if v_registration_mode = 'external_link' and v_registration_url is null then
    raise exception 'registrationUrl is required for external_link registration' using errcode = '22023';
  end if;

  insert into public.events (
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
    latitude,
    longitude,
    image_url,
    category,
    audience,
    visibility,
    status,
    source_type,
    source_url,
    source_external_id,
    manual_override,
    registration_mode,
    registration_url,
    capacity,
    waitlist_enabled,
    requires_approval,
    price_amount,
    price_currency,
    created_by,
    updated_by,
    published_at
  )
  values (
    v_community_id,
    v_title,
    nullif(v_payload ->> 'subtitle', ''),
    nullif(coalesce(v_payload ->> 'shortDescription', v_payload ->> 'short_description'), ''),
    nullif(v_payload ->> 'description', ''),
    v_starts_text::timestamptz,
    nullif(coalesce(v_payload ->> 'endsAt', v_payload ->> 'ends_at'), '')::timestamptz,
    v_timezone,
    nullif(coalesce(v_payload ->> 'locationName', v_payload ->> 'location_name'), ''),
    nullif(v_payload ->> 'address', ''),
    nullif(v_payload ->> 'latitude', '')::numeric,
    nullif(v_payload ->> 'longitude', '')::numeric,
    nullif(coalesce(v_payload ->> 'imageUrl', v_payload ->> 'image_url'), ''),
    v_category,
    nullif(v_payload ->> 'audience', ''),
    v_visibility,
    v_status,
    'manual',
    nullif(coalesce(v_payload ->> 'sourceUrl', v_payload ->> 'source_url'), ''),
    nullif(coalesce(v_payload ->> 'sourceExternalId', v_payload ->> 'source_external_id'), ''),
    true,
    v_registration_mode,
    v_registration_url,
    nullif(v_payload ->> 'capacity', '')::integer,
    coalesce(nullif(coalesce(
      v_payload ->> 'waitlistEnabled',
      v_payload ->> 'waitlist_enabled'
    ), '')::boolean, false),
    coalesce(nullif(coalesce(
      v_payload ->> 'requiresApproval',
      v_payload ->> 'requires_approval'
    ), '')::boolean, false),
    nullif(coalesce(v_payload ->> 'priceAmount', v_payload ->> 'price_amount'), '')::integer,
    coalesce(nullif(coalesce(v_payload ->> 'priceCurrency', v_payload ->> 'price_currency'), ''), 'RUB'),
    v_user_id,
    v_user_id,
    case
      when v_status = 'published' then coalesce(v_published_at, now())
      else null
    end
  )
  returning * into v_event;

  return v_event;
end;
$$;

create or replace function public.admin_publish_import_item(
  import_item_id uuid,
  payload jsonb
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_item public.event_import_items;
  v_source public.event_import_sources;
  v_event public.events;
  v_event_id uuid;
  v_payload_community_text text := nullif(coalesce(
    v_payload ->> 'communityId',
    v_payload ->> 'community_id'
  ), '');
  v_title text := nullif(v_payload ->> 'title', '');
  v_starts_text text := nullif(coalesce(
    v_payload ->> 'startsAt',
    v_payload ->> 'starts_at'
  ), '');
  v_registration_mode text := nullif(coalesce(
    v_payload ->> 'registrationMode',
    v_payload ->> 'registration_mode'
  ), '');
  v_category text := nullif(v_payload ->> 'category', '');
  v_visibility text := coalesce(nullif(v_payload ->> 'visibility', ''), 'public');
  v_status text := coalesce(nullif(v_payload ->> 'status', ''), 'published');
  v_timezone text := coalesce(nullif(v_payload ->> 'timezone', ''), 'Europe/Moscow');
  v_registration_url text := nullif(coalesce(
    v_payload ->> 'registrationUrl',
    v_payload ->> 'registration_url'
  ), '');
  v_source_url text;
  v_published_at timestamptz := nullif(coalesce(
    v_payload ->> 'publishedAt',
    v_payload ->> 'published_at'
  ), '')::timestamptz;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_item
  from public.event_import_items
  where id = import_item_id
  for update;

  if not found then
    raise exception 'Import item not found' using errcode = 'P0002';
  end if;

  select *
  into v_source
  from public.event_import_sources
  where id = v_item.source_id;

  if not found then
    raise exception 'Import source not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_source.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  if v_payload_community_text is not null
     and v_payload_community_text::uuid <> v_source.community_id then
    raise exception 'communityId does not match import source' using errcode = '22023';
  end if;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if v_starts_text is null then
    raise exception 'startsAt is required' using errcode = '22023';
  end if;

  if v_category is null then
    raise exception 'category is required' using errcode = '22023';
  end if;

  if v_registration_mode is null then
    raise exception 'registrationMode is required' using errcode = '22023';
  end if;

  if v_visibility not in ('public', 'members_only', 'hidden') then
    raise exception 'visibility is invalid' using errcode = '22023';
  end if;

  if v_status not in ('draft', 'published', 'cancelled', 'archived') then
    raise exception 'status is invalid' using errcode = '22023';
  end if;

  if v_registration_mode not in ('none', 'external_link', 'internal_free', 'internal_paid') then
    raise exception 'registrationMode is invalid' using errcode = '22023';
  end if;

  if v_registration_mode = 'external_link' and v_registration_url is null then
    raise exception 'registrationUrl is required for external_link registration' using errcode = '22023';
  end if;

  v_source_url := coalesce(
    nullif(coalesce(v_payload ->> 'sourceUrl', v_payload ->> 'source_url'), ''),
    v_item.source_url
  );

  if v_item.linked_event_id is not null then
    select *
    into v_event
    from public.events
    where id = v_item.linked_event_id
    for update;

    if not found then
      raise exception 'Linked event not found' using errcode = 'P0002';
    end if;

    if v_event.community_id <> v_source.community_id then
      raise exception 'Linked event community mismatch' using errcode = '42501';
    end if;

    v_event_id := v_event.id;
  elsif v_item.external_id is not null then
    select e.id
    into v_event_id
    from public.events e
    where e.community_id = v_source.community_id
      and e.source_type = 'website_scrape'
      and e.source_external_id = v_item.external_id
    order by e.created_at, e.id
    limit 1
    for update;
  end if;

  if v_event_id is not null then
    update public.events
    set
      title = v_title,
      subtitle = nullif(v_payload ->> 'subtitle', ''),
      short_description = nullif(coalesce(
        v_payload ->> 'shortDescription',
        v_payload ->> 'short_description'
      ), ''),
      description = nullif(v_payload ->> 'description', ''),
      starts_at = v_starts_text::timestamptz,
      ends_at = nullif(coalesce(v_payload ->> 'endsAt', v_payload ->> 'ends_at'), '')::timestamptz,
      timezone = v_timezone,
      location_name = nullif(coalesce(v_payload ->> 'locationName', v_payload ->> 'location_name'), ''),
      address = nullif(v_payload ->> 'address', ''),
      latitude = nullif(v_payload ->> 'latitude', '')::numeric,
      longitude = nullif(v_payload ->> 'longitude', '')::numeric,
      image_url = nullif(coalesce(v_payload ->> 'imageUrl', v_payload ->> 'image_url'), ''),
      category = v_category,
      audience = nullif(v_payload ->> 'audience', ''),
      visibility = v_visibility,
      status = v_status,
      source_type = 'website_scrape',
      source_url = v_source_url,
      source_external_id = v_item.external_id,
      manual_override = true,
      registration_mode = v_registration_mode,
      registration_url = v_registration_url,
      capacity = nullif(v_payload ->> 'capacity', '')::integer,
      waitlist_enabled = coalesce(nullif(coalesce(
        v_payload ->> 'waitlistEnabled',
        v_payload ->> 'waitlist_enabled'
      ), '')::boolean, false),
      requires_approval = coalesce(nullif(coalesce(
        v_payload ->> 'requiresApproval',
        v_payload ->> 'requires_approval'
      ), '')::boolean, false),
      price_amount = nullif(coalesce(v_payload ->> 'priceAmount', v_payload ->> 'price_amount'), '')::integer,
      price_currency = coalesce(nullif(coalesce(
        v_payload ->> 'priceCurrency',
        v_payload ->> 'price_currency'
      ), ''), 'RUB'),
      updated_by = v_user_id,
      published_at = case
        when v_status = 'published' then coalesce(v_published_at, public.events.published_at, now())
        else public.events.published_at
      end
    where id = v_event_id
    returning * into v_event;
  else
    insert into public.events (
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
      latitude,
      longitude,
      image_url,
      category,
      audience,
      visibility,
      status,
      source_type,
      source_url,
      source_external_id,
      manual_override,
      registration_mode,
      registration_url,
      capacity,
      waitlist_enabled,
      requires_approval,
      price_amount,
      price_currency,
      created_by,
      updated_by,
      published_at
    )
    values (
      v_source.community_id,
      v_title,
      nullif(v_payload ->> 'subtitle', ''),
      nullif(coalesce(v_payload ->> 'shortDescription', v_payload ->> 'short_description'), ''),
      nullif(v_payload ->> 'description', ''),
      v_starts_text::timestamptz,
      nullif(coalesce(v_payload ->> 'endsAt', v_payload ->> 'ends_at'), '')::timestamptz,
      v_timezone,
      nullif(coalesce(v_payload ->> 'locationName', v_payload ->> 'location_name'), ''),
      nullif(v_payload ->> 'address', ''),
      nullif(v_payload ->> 'latitude', '')::numeric,
      nullif(v_payload ->> 'longitude', '')::numeric,
      nullif(coalesce(v_payload ->> 'imageUrl', v_payload ->> 'image_url'), ''),
      v_category,
      nullif(v_payload ->> 'audience', ''),
      v_visibility,
      v_status,
      'website_scrape',
      v_source_url,
      v_item.external_id,
      true,
      v_registration_mode,
      v_registration_url,
      nullif(v_payload ->> 'capacity', '')::integer,
      coalesce(nullif(coalesce(
        v_payload ->> 'waitlistEnabled',
        v_payload ->> 'waitlist_enabled'
      ), '')::boolean, false),
      coalesce(nullif(coalesce(
        v_payload ->> 'requiresApproval',
        v_payload ->> 'requires_approval'
      ), '')::boolean, false),
      nullif(coalesce(v_payload ->> 'priceAmount', v_payload ->> 'price_amount'), '')::integer,
      coalesce(nullif(coalesce(v_payload ->> 'priceCurrency', v_payload ->> 'price_currency'), ''), 'RUB'),
      v_user_id,
      v_user_id,
      case
        when v_status = 'published' then coalesce(v_published_at, now())
        else null
      end
    )
    returning * into v_event;
  end if;

  update public.event_import_items
  set
    linked_event_id = v_event.id,
    status = 'linked'
  where id = v_item.id;

  return v_event;
end;
$$;

create or replace function public.admin_ignore_import_item(
  import_item_id uuid,
  reason text default null
)
returns table (
  id uuid,
  source_id uuid,
  run_id uuid,
  external_id text,
  source_url text,
  raw_payload jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid,
  status text,
  created_at timestamptz,
  source_name text,
  community_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select s.community_id
  into v_community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id
  for update of i;

  if not found then
    raise exception 'Import item not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  update public.event_import_items i
  set
    status = 'ignored',
    raw_payload = jsonb_set(
      coalesce(i.raw_payload, '{}'::jsonb),
      '{adminReview}',
      coalesce(i.raw_payload -> 'adminReview', '{}'::jsonb)
        || jsonb_build_object(
          'ignoredAt',
          now(),
          'ignoredBy',
          v_user_id,
          'ignoreReason',
          reason
        ),
      true
    )
  where i.id = import_item_id;

  return query
  select
    i.id,
    i.source_id,
    i.run_id,
    i.external_id,
    i.source_url,
    i.raw_payload,
    i.parsed_title,
    i.parsed_starts_at,
    i.parsed_location,
    i.linked_event_id,
    i.status,
    i.created_at,
    s.name as source_name,
    s.community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id;
end;
$$;

revoke all on function public.admin_list_import_items_needing_review(integer) from public;
revoke all on function public.admin_get_import_item(uuid) from public;
revoke all on function public.admin_create_event(jsonb) from public;
revoke all on function public.admin_publish_import_item(uuid, jsonb) from public;
revoke all on function public.admin_ignore_import_item(uuid, text) from public;

grant execute on function public.admin_list_import_items_needing_review(integer) to authenticated;
grant execute on function public.admin_get_import_item(uuid) to authenticated;
grant execute on function public.admin_create_event(jsonb) to authenticated;
grant execute on function public.admin_publish_import_item(uuid, jsonb) to authenticated;
grant execute on function public.admin_ignore_import_item(uuid, text) to authenticated;

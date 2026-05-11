-- Add an explicit parent/card flag for events that should not move to past
-- solely because their technical end time has passed.

alter table public.events
  add column if not exists is_permanent boolean not null default false;

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
  v_event_kind text := coalesce(nullif(coalesce(
    v_payload ->> 'eventKind',
    v_payload ->> 'event_kind'
  ), ''), 'single');
  v_title text := nullif(v_payload ->> 'title', '');
  v_starts_text text := nullif(coalesce(
    v_payload ->> 'startsAt',
    v_payload ->> 'starts_at'
  ), '');
  v_is_permanent boolean := coalesce(nullif(coalesce(
    v_payload ->> 'isPermanent',
    v_payload ->> 'is_permanent'
  ), '')::boolean, false);
  v_ends_at timestamptz := case
    when v_is_permanent then null
    else nullif(coalesce(v_payload ->> 'endsAt', v_payload ->> 'ends_at'), '')::timestamptz
  end;
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

  if v_event_kind not in (
    'single',
    'course',
    'sunday_school',
    'shabbat',
    'holiday',
    'announcement'
  ) then
    raise exception 'eventKind is invalid' using errcode = '22023';
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
    event_kind,
    title,
    subtitle,
    short_description,
    description,
    starts_at,
    ends_at,
    is_permanent,
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
    v_event_kind,
    v_title,
    nullif(v_payload ->> 'subtitle', ''),
    nullif(coalesce(v_payload ->> 'shortDescription', v_payload ->> 'short_description'), ''),
    nullif(v_payload ->> 'description', ''),
    v_starts_text::timestamptz,
    v_ends_at,
    v_is_permanent,
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

create or replace function public.admin_update_event(
  event_id uuid,
  payload jsonb
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce($2, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_existing public.events;
  v_event public.events;

  v_has_title boolean := v_payload ? 'title';
  v_has_event_kind boolean := v_payload ? 'eventKind'
    or v_payload ? 'event_kind';
  v_has_subtitle boolean := v_payload ? 'subtitle';
  v_has_short_description boolean := v_payload ? 'shortDescription'
    or v_payload ? 'short_description';
  v_has_description boolean := v_payload ? 'description';
  v_has_starts_at boolean := v_payload ? 'startsAt'
    or v_payload ? 'starts_at';
  v_has_ends_at boolean := v_payload ? 'endsAt'
    or v_payload ? 'ends_at';
  v_has_is_permanent boolean := v_payload ? 'isPermanent'
    or v_payload ? 'is_permanent';
  v_has_timezone boolean := v_payload ? 'timezone';
  v_has_location_name boolean := v_payload ? 'locationName'
    or v_payload ? 'location_name';
  v_has_address boolean := v_payload ? 'address';
  v_has_latitude boolean := v_payload ? 'latitude';
  v_has_longitude boolean := v_payload ? 'longitude';
  v_has_image_url boolean := v_payload ? 'imageUrl'
    or v_payload ? 'image_url';
  v_has_category boolean := v_payload ? 'category';
  v_has_audience boolean := v_payload ? 'audience';
  v_has_visibility boolean := v_payload ? 'visibility';
  v_has_status boolean := v_payload ? 'status';
  v_has_registration_mode boolean := v_payload ? 'registrationMode'
    or v_payload ? 'registration_mode';
  v_has_registration_url boolean := v_payload ? 'registrationUrl'
    or v_payload ? 'registration_url';
  v_has_capacity boolean := v_payload ? 'capacity';
  v_has_waitlist_enabled boolean := v_payload ? 'waitlistEnabled'
    or v_payload ? 'waitlist_enabled';
  v_has_requires_approval boolean := v_payload ? 'requiresApproval'
    or v_payload ? 'requires_approval';
  v_has_price_amount boolean := v_payload ? 'priceAmount'
    or v_payload ? 'price_amount';
  v_has_price_currency boolean := v_payload ? 'priceCurrency'
    or v_payload ? 'price_currency';
  v_has_manual_override boolean := v_payload ? 'manualOverride'
    or v_payload ? 'manual_override';

  v_title text;
  v_event_kind text;
  v_subtitle text;
  v_short_description text;
  v_description text;
  v_timezone text;
  v_location_name text;
  v_address text;
  v_image_url text;
  v_category text;
  v_audience text;
  v_visibility text;
  v_status text;
  v_registration_mode text;
  v_registration_url text;
  v_price_currency text;
  v_text text;

  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_published_at timestamptz;
  v_latitude numeric;
  v_longitude numeric;
  v_capacity integer;
  v_price_amount integer;
  v_is_permanent boolean;
  v_waitlist_enabled boolean;
  v_requires_approval boolean;
  v_manual_override boolean := true;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.events
  where id = $1
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  v_title := v_existing.title;
  v_event_kind := coalesce(v_existing.event_kind, 'single');
  v_subtitle := v_existing.subtitle;
  v_short_description := v_existing.short_description;
  v_description := v_existing.description;
  v_starts_at := v_existing.starts_at;
  v_ends_at := v_existing.ends_at;
  v_is_permanent := coalesce(v_existing.is_permanent, false);
  v_timezone := v_existing.timezone;
  v_location_name := v_existing.location_name;
  v_address := v_existing.address;
  v_latitude := v_existing.latitude;
  v_longitude := v_existing.longitude;
  v_image_url := v_existing.image_url;
  v_category := v_existing.category;
  v_audience := v_existing.audience;
  v_visibility := v_existing.visibility;
  v_status := v_existing.status;
  v_registration_mode := v_existing.registration_mode;
  v_registration_url := v_existing.registration_url;
  v_capacity := v_existing.capacity;
  v_waitlist_enabled := v_existing.waitlist_enabled;
  v_requires_approval := v_existing.requires_approval;
  v_price_amount := v_existing.price_amount;
  v_price_currency := v_existing.price_currency;
  v_published_at := v_existing.published_at;

  if v_has_title then
    v_title := nullif(btrim(v_payload ->> 'title'), '');

    if v_title is null then
      raise exception 'title must not be empty' using errcode = '22023';
    end if;
  end if;

  if v_has_event_kind then
    v_event_kind := nullif(btrim(coalesce(
      v_payload ->> 'eventKind',
      v_payload ->> 'event_kind'
    )), '');

    if v_event_kind is null or v_event_kind not in (
      'single',
      'course',
      'sunday_school',
      'shabbat',
      'holiday',
      'announcement'
    ) then
      raise exception 'eventKind is invalid' using errcode = '22023';
    end if;
  end if;

  if v_has_subtitle then
    v_subtitle := nullif(btrim(v_payload ->> 'subtitle'), '');
  end if;

  if v_has_short_description then
    v_short_description := nullif(btrim(coalesce(
      v_payload ->> 'shortDescription',
      v_payload ->> 'short_description'
    )), '');
  end if;

  if v_has_description then
    v_description := nullif(btrim(v_payload ->> 'description'), '');
  end if;

  if v_has_starts_at then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'startsAt',
      v_payload ->> 'starts_at'
    )), '');

    if v_text is null then
      raise exception 'startsAt must not be empty' using errcode = '22023';
    end if;

    begin
      v_starts_at := v_text::timestamptz;
    exception when others then
      raise exception 'startsAt is invalid' using errcode = '22023';
    end;
  end if;

  if v_has_is_permanent then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'isPermanent',
      v_payload ->> 'is_permanent'
    )), '');

    if v_text is null then
      v_is_permanent := false;
    else
      begin
        v_is_permanent := v_text::boolean;
      exception when others then
        raise exception 'isPermanent is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_has_ends_at then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'endsAt',
      v_payload ->> 'ends_at'
    )), '');

    if v_text is null then
      v_ends_at := null;
    else
      begin
        v_ends_at := v_text::timestamptz;
      exception when others then
        raise exception 'endsAt is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_is_permanent then
    v_ends_at := null;
  elsif v_ends_at is not null and v_ends_at <= v_starts_at then
    raise exception 'endsAt must be later than startsAt' using errcode = '22023';
  end if;

  if v_has_timezone then
    v_timezone := nullif(btrim(v_payload ->> 'timezone'), '');

    if v_timezone is null then
      raise exception 'timezone must not be empty' using errcode = '22023';
    end if;
  end if;

  if v_has_location_name then
    v_location_name := nullif(btrim(coalesce(
      v_payload ->> 'locationName',
      v_payload ->> 'location_name'
    )), '');
  end if;

  if v_has_address then
    v_address := nullif(btrim(v_payload ->> 'address'), '');
  end if;

  if v_has_latitude then
    v_text := nullif(btrim(v_payload ->> 'latitude'), '');

    if v_text is null then
      v_latitude := null;
    else
      begin
        v_latitude := v_text::numeric;
      exception when others then
        raise exception 'latitude is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_has_longitude then
    v_text := nullif(btrim(v_payload ->> 'longitude'), '');

    if v_text is null then
      v_longitude := null;
    else
      begin
        v_longitude := v_text::numeric;
      exception when others then
        raise exception 'longitude is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_has_image_url then
    v_image_url := nullif(btrim(coalesce(
      v_payload ->> 'imageUrl',
      v_payload ->> 'image_url'
    )), '');
  end if;

  if v_has_category then
    v_category := nullif(btrim(v_payload ->> 'category'), '');
  end if;

  if v_has_audience then
    v_audience := nullif(btrim(v_payload ->> 'audience'), '');
  end if;

  if v_has_visibility then
    v_visibility := nullif(btrim(v_payload ->> 'visibility'), '');

    if v_visibility not in ('public', 'members_only', 'hidden') then
      raise exception 'visibility is invalid' using errcode = '22023';
    end if;
  end if;

  if v_has_status then
    v_status := nullif(btrim(v_payload ->> 'status'), '');

    if v_status not in ('draft', 'published', 'cancelled', 'archived') then
      raise exception 'status is invalid' using errcode = '22023';
    end if;

    if v_status = 'published'
       and v_existing.status is distinct from 'published'
       and v_existing.published_at is null then
      v_published_at := now();
    end if;
  end if;

  if v_has_registration_mode then
    v_registration_mode := nullif(btrim(coalesce(
      v_payload ->> 'registrationMode',
      v_payload ->> 'registration_mode'
    )), '');

    if v_registration_mode not in ('none', 'external_link', 'internal_free', 'internal_paid') then
      raise exception 'registrationMode is invalid' using errcode = '22023';
    end if;
  end if;

  if v_has_registration_url then
    v_registration_url := nullif(btrim(coalesce(
      v_payload ->> 'registrationUrl',
      v_payload ->> 'registration_url'
    )), '');
  end if;

  if v_registration_mode = 'external_link' and v_registration_url is null then
    raise exception 'registrationUrl is required for external_link registration' using errcode = '22023';
  end if;

  if v_has_capacity then
    v_text := nullif(btrim(v_payload ->> 'capacity'), '');

    if v_text is null then
      v_capacity := null;
    else
      begin
        v_capacity := v_text::integer;
      exception when others then
        raise exception 'capacity is invalid' using errcode = '22023';
      end;

      if v_capacity <= 0 then
        raise exception 'capacity must be positive' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_has_waitlist_enabled then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'waitlistEnabled',
      v_payload ->> 'waitlist_enabled'
    )), '');

    if v_text is null then
      v_waitlist_enabled := false;
    else
      begin
        v_waitlist_enabled := v_text::boolean;
      exception when others then
        raise exception 'waitlistEnabled is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_has_requires_approval then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'requiresApproval',
      v_payload ->> 'requires_approval'
    )), '');

    if v_text is null then
      v_requires_approval := false;
    else
      begin
        v_requires_approval := v_text::boolean;
      exception when others then
        raise exception 'requiresApproval is invalid' using errcode = '22023';
      end;
    end if;
  end if;

  if v_has_price_amount then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'priceAmount',
      v_payload ->> 'price_amount'
    )), '');

    if v_text is null then
      v_price_amount := null;
    else
      begin
        v_price_amount := v_text::integer;
      exception when others then
        raise exception 'priceAmount is invalid' using errcode = '22023';
      end;

      if v_price_amount < 0 then
        raise exception 'priceAmount must be greater than or equal to 0' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_has_price_currency then
    v_price_currency := nullif(btrim(coalesce(
      v_payload ->> 'priceCurrency',
      v_payload ->> 'price_currency'
    )), '');
  end if;

  if v_price_amount is not null and v_price_currency is null then
    if v_has_price_currency then
      raise exception 'priceCurrency is required when priceAmount is set' using errcode = '22023';
    end if;

    v_price_currency := 'RUB';
  end if;

  if v_has_manual_override then
    v_text := nullif(btrim(coalesce(
      v_payload ->> 'manualOverride',
      v_payload ->> 'manual_override'
    )), '');

    if v_text is not null then
      begin
        v_manual_override := v_text::boolean;
      exception when others then
        raise exception 'manualOverride is invalid' using errcode = '22023';
      end;
    end if;

    if v_manual_override is false then
      raise exception 'manualOverride cannot be false for admin updates' using errcode = '22023';
    end if;
  end if;

  update public.events
  set
    title = v_title,
    event_kind = v_event_kind,
    subtitle = v_subtitle,
    short_description = v_short_description,
    description = v_description,
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    is_permanent = v_is_permanent,
    timezone = v_timezone,
    location_name = v_location_name,
    address = v_address,
    latitude = v_latitude,
    longitude = v_longitude,
    image_url = v_image_url,
    category = v_category,
    audience = v_audience,
    visibility = v_visibility,
    status = v_status,
    manual_override = true,
    registration_mode = v_registration_mode,
    registration_url = v_registration_url,
    capacity = v_capacity,
    waitlist_enabled = v_waitlist_enabled,
    requires_approval = v_requires_approval,
    price_amount = v_price_amount,
    price_currency = v_price_currency,
    updated_by = v_user_id,
    published_at = v_published_at
  where id = v_existing.id
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
  v_is_permanent boolean := coalesce(nullif(coalesce(
    v_payload ->> 'isPermanent',
    v_payload ->> 'is_permanent'
  ), '')::boolean, false);
  v_ends_at timestamptz := case
    when v_is_permanent then null
    else nullif(coalesce(v_payload ->> 'endsAt', v_payload ->> 'ends_at'), '')::timestamptz
  end;
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
      ends_at = v_ends_at,
      is_permanent = v_is_permanent,
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
      is_permanent,
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
      v_ends_at,
      v_is_permanent,
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

revoke all on function public.admin_create_event(jsonb) from public;
revoke all on function public.admin_update_event(uuid, jsonb) from public;
revoke all on function public.admin_publish_import_item(uuid, jsonb) from public;

grant execute on function public.admin_create_event(jsonb) to authenticated;
grant execute on function public.admin_update_event(uuid, jsonb) to authenticated;
grant execute on function public.admin_publish_import_item(uuid, jsonb) to authenticated;

-- Admin RPCs for event_categories management.
--
-- All functions are security definer with locked search_path. Permissions
-- are revoked from public and granted only to authenticated users. Each
-- function checks that the caller has an active admin/event_manager role
-- in the relevant community via has_community_role(...).

create or replace function public.admin_list_event_categories(
  p_community_id uuid
)
returns setof public.event_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_community_id is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  if not public.has_community_role(p_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  return query
    select *
    from public.event_categories
    where community_id = p_community_id
    order by is_active desc, sort_order asc, title asc;
end;
$$;

create or replace function public.admin_create_event_category(payload jsonb)
returns public.event_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_category public.event_categories;
  v_community_text text := nullif(coalesce(
    v_payload ->> 'communityId',
    v_payload ->> 'community_id'
  ), '');
  v_community_id uuid;
  v_slug text := nullif(btrim(v_payload ->> 'slug'), '');
  v_title text := nullif(btrim(v_payload ->> 'title'), '');
  v_description text := nullif(btrim(v_payload ->> 'description'), '');
  v_color text := coalesce(nullif(btrim(v_payload ->> 'color'), ''), '#7B68EE');
  v_icon text := coalesce(nullif(btrim(v_payload ->> 'icon'), ''), '✡️');
  v_sort_order_text text := nullif(btrim(coalesce(
    v_payload ->> 'sortOrder',
    v_payload ->> 'sort_order'
  )), '');
  v_sort_order integer := 100;
  v_is_active_text text := nullif(btrim(coalesce(
    v_payload ->> 'isActive',
    v_payload ->> 'is_active'
  )), '');
  v_is_active boolean := true;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_community_text is null then
    raise exception 'communityId is required' using errcode = '22023';
  end if;

  v_community_id := v_community_text::uuid;

  if v_slug is null then
    raise exception 'slug is required' using errcode = '22023';
  end if;

  v_slug := lower(v_slug);

  if v_slug !~ '^[a-z0-9][a-z0-9_]{1,63}$' then
    raise exception 'slug is invalid' using errcode = '22023';
  end if;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'color must be #RRGGBB hex' using errcode = '22023';
  end if;

  if btrim(v_icon) = '' then
    raise exception 'icon must not be empty' using errcode = '22023';
  end if;

  if v_sort_order_text is not null then
    begin
      v_sort_order := v_sort_order_text::integer;
    exception when others then
      raise exception 'sortOrder must be an integer' using errcode = '22023';
    end;
  end if;

  if v_is_active_text is not null then
    begin
      v_is_active := v_is_active_text::boolean;
    exception when others then
      raise exception 'isActive must be boolean' using errcode = '22023';
    end;
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.event_categories
    where community_id = v_community_id and slug = v_slug
  ) then
    raise exception 'Category with this slug already exists' using errcode = '23505';
  end if;

  insert into public.event_categories (
    community_id,
    slug,
    title,
    description,
    color,
    icon,
    sort_order,
    is_active,
    created_by,
    updated_by
  )
  values (
    v_community_id,
    v_slug,
    v_title,
    v_description,
    v_color,
    v_icon,
    v_sort_order,
    v_is_active,
    v_user_id,
    v_user_id
  )
  returning * into v_category;

  return v_category;
end;
$$;

create or replace function public.admin_update_event_category(
  category_id uuid,
  payload jsonb
)
returns public.event_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce($2, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_existing public.event_categories;
  v_category public.event_categories;
  v_usage_count integer;
  v_active_count integer;

  v_has_slug boolean := v_payload ? 'slug';
  v_has_title boolean := v_payload ? 'title';
  v_has_description boolean := v_payload ? 'description';
  v_has_color boolean := v_payload ? 'color';
  v_has_icon boolean := v_payload ? 'icon';
  v_has_sort_order boolean := v_payload ? 'sortOrder' or v_payload ? 'sort_order';
  v_has_is_active boolean := v_payload ? 'isActive' or v_payload ? 'is_active';

  v_slug text;
  v_title text;
  v_description text;
  v_color text;
  v_icon text;
  v_sort_order integer;
  v_is_active boolean;
  v_text text;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.event_categories
  where id = $1
  for update;

  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  v_slug := v_existing.slug;
  v_title := v_existing.title;
  v_description := v_existing.description;
  v_color := v_existing.color;
  v_icon := v_existing.icon;
  v_sort_order := v_existing.sort_order;
  v_is_active := v_existing.is_active;

  select count(*)
  into v_usage_count
  from public.events
  where community_id = v_existing.community_id
    and category = v_existing.slug;

  if v_has_slug then
    v_slug := lower(nullif(btrim(v_payload ->> 'slug'), ''));

    if v_slug is null then
      raise exception 'slug is required' using errcode = '22023';
    end if;

    if v_slug !~ '^[a-z0-9][a-z0-9_]{1,63}$' then
      raise exception 'slug is invalid' using errcode = '22023';
    end if;

    if v_slug <> v_existing.slug then
      if v_usage_count > 0 then
        raise exception 'Cannot change slug: category is used by events. Archive it instead.' using errcode = '22023';
      end if;

      if exists (
        select 1
        from public.event_categories
        where community_id = v_existing.community_id
          and slug = v_slug
          and id <> v_existing.id
      ) then
        raise exception 'Category with this slug already exists' using errcode = '23505';
      end if;
    end if;
  end if;

  if v_has_title then
    v_title := nullif(btrim(v_payload ->> 'title'), '');

    if v_title is null then
      raise exception 'title must not be empty' using errcode = '22023';
    end if;
  end if;

  if v_has_description then
    v_description := nullif(btrim(v_payload ->> 'description'), '');
  end if;

  if v_has_color then
    v_color := nullif(btrim(v_payload ->> 'color'), '');

    if v_color is null or v_color !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'color must be #RRGGBB hex' using errcode = '22023';
    end if;
  end if;

  if v_has_icon then
    v_icon := nullif(btrim(v_payload ->> 'icon'), '');

    if v_icon is null then
      raise exception 'icon must not be empty' using errcode = '22023';
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

  if v_existing.is_active = true and v_is_active = false then
    select count(*)
    into v_active_count
    from public.event_categories
    where community_id = v_existing.community_id
      and is_active = true
      and id <> v_existing.id;

    if v_active_count = 0 then
      raise exception 'Cannot deactivate the last active category' using errcode = '22023';
    end if;
  end if;

  update public.event_categories
  set
    slug = v_slug,
    title = v_title,
    description = v_description,
    color = v_color,
    icon = v_icon,
    sort_order = v_sort_order,
    is_active = v_is_active,
    updated_by = v_user_id
  where id = v_existing.id
  returning * into v_category;

  return v_category;
end;
$$;

create or replace function public.admin_delete_event_category(category_id uuid)
returns public.event_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.event_categories;
  v_category public.event_categories;
  v_usage_count integer;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.event_categories
  where id = category_id
  for update;

  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  select count(*)
  into v_usage_count
  from public.events
  where community_id = v_existing.community_id
    and category = v_existing.slug;

  if v_existing.is_active = true then
    select count(*)
    into v_active_count
    from public.event_categories
    where community_id = v_existing.community_id
      and is_active = true
      and id <> v_existing.id;

    if v_active_count = 0 then
      raise exception 'Cannot delete the last active category' using errcode = '22023';
    end if;
  end if;

  if v_usage_count > 0 then
    update public.event_categories
    set is_active = false,
        updated_by = v_user_id
    where id = v_existing.id
    returning * into v_category;

    return v_category;
  end if;

  delete from public.event_categories
  where id = v_existing.id
  returning * into v_category;

  return v_category;
end;
$$;

revoke all on function public.admin_list_event_categories(uuid) from public;
revoke all on function public.admin_create_event_category(jsonb) from public;
revoke all on function public.admin_update_event_category(uuid, jsonb) from public;
revoke all on function public.admin_delete_event_category(uuid) from public;

grant execute on function public.admin_list_event_categories(uuid) to authenticated;
grant execute on function public.admin_create_event_category(jsonb) to authenticated;
grant execute on function public.admin_update_event_category(uuid, jsonb) to authenticated;
grant execute on function public.admin_delete_event_category(uuid) to authenticated;

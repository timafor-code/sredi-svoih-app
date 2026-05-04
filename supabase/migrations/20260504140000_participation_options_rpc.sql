-- Participation options RPC for Среди Своих.
-- Adds three RPC functions on top of the existing
-- public.event_participation_options table:
--   1. list_event_participation_options
--   2. admin_list_event_participation_options
--   3. admin_replace_event_participation_options

create or replace function public.list_event_participation_options(p_event_id uuid)
returns setof public.event_participation_options
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_can_manage boolean := false;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if v_user_id is not null then
    v_can_manage := public.has_community_role(
      v_event.community_id,
      array['admin', 'event_manager']
    );
  end if;

  if not v_can_manage then
    if v_event.status <> 'published' then
      raise exception 'Event not found' using errcode = 'P0002';
    end if;

    if v_event.visibility = 'public' then
      null;
    elsif v_event.visibility = 'members_only' then
      if v_user_id is null then
        raise exception 'Auth required' using errcode = '28000';
      end if;

      if not public.is_active_member(v_event.community_id) then
        raise exception 'Auth required' using errcode = '28000';
      end if;
    else
      raise exception 'Event not found' using errcode = 'P0002';
    end if;
  end if;

  return query
  select *
  from public.event_participation_options
  where event_id = p_event_id
    and is_active = true
  order by sort_order asc, created_at asc;
end;
$$;

revoke all on function public.list_event_participation_options(uuid) from public;
grant execute on function public.list_event_participation_options(uuid) to anon, authenticated;


create or replace function public.admin_list_event_participation_options(p_event_id uuid)
returns setof public.event_participation_options
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return query
  select *
  from public.event_participation_options
  where event_id = p_event_id
  order by sort_order asc, created_at asc;
end;
$$;

revoke all on function public.admin_list_event_participation_options(uuid) from public;
grant execute on function public.admin_list_event_participation_options(uuid) to authenticated;


create or replace function public.admin_replace_event_participation_options(
  p_event_id uuid,
  p_options jsonb
)
returns setof public.event_participation_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_option jsonb;
  v_index integer := 0;

  v_title text;
  v_description text;
  v_price_amount integer;
  v_price_currency text;
  v_option_type text;
  v_seat_limit integer;
  v_allow_quantity boolean;
  v_min_quantity integer;
  v_max_quantity integer;
  v_is_donation boolean;
  v_counts_toward_capacity boolean;
  v_group_key text;
  v_conflicts_with jsonb;
  v_sort_order integer;
  v_is_active boolean;

  v_text text;
  v_raw jsonb;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'p_options must be a JSON array' using errcode = '22023';
  end if;

  delete from public.event_participation_options
  where event_id = p_event_id;

  for v_option in
    select value
    from jsonb_array_elements(p_options) as t(value)
  loop
    if jsonb_typeof(v_option) <> 'object' then
      raise exception 'Option must be a JSON object' using errcode = '22023';
    end if;

    v_title := nullif(btrim(v_option ->> 'title'), '');
    if v_title is null then
      raise exception 'Option title is required' using errcode = '22023';
    end if;

    v_description := nullif(btrim(v_option ->> 'description'), '');

    v_text := nullif(btrim(coalesce(
      v_option ->> 'priceAmount',
      v_option ->> 'price_amount'
    )), '');
    if v_text is null then
      v_price_amount := 0;
    else
      begin
        v_price_amount := v_text::integer;
      exception when others then
        raise exception 'priceAmount is invalid' using errcode = '22023';
      end;
    end if;
    if v_price_amount < 0 then
      raise exception 'priceAmount must be greater than or equal to 0'
        using errcode = '22023';
    end if;

    v_price_currency := nullif(btrim(coalesce(
      v_option ->> 'priceCurrency',
      v_option ->> 'price_currency'
    )), '');
    if v_price_currency is null then
      v_price_currency := 'RUB';
    end if;

    v_option_type := nullif(btrim(coalesce(
      v_option ->> 'optionType',
      v_option ->> 'option_type'
    )), '');
    if v_option_type is null then
      v_option_type := 'participation';
    end if;
    if v_option_type not in (
      'participation', 'meal', 'package', 'donation',
      'child', 'family', 'other'
    ) then
      raise exception 'Invalid option type' using errcode = '22023';
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'seatLimit',
      v_option ->> 'seat_limit'
    )), '');
    if v_text is null then
      v_seat_limit := null;
    else
      begin
        v_seat_limit := v_text::integer;
      exception when others then
        raise exception 'seatLimit is invalid' using errcode = '22023';
      end;
      if v_seat_limit <= 0 then
        raise exception 'seatLimit must be greater than 0'
          using errcode = '22023';
      end if;
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'allowQuantity',
      v_option ->> 'allow_quantity'
    )), '');
    if v_text is null then
      v_allow_quantity := false;
    else
      begin
        v_allow_quantity := v_text::boolean;
      exception when others then
        raise exception 'allowQuantity is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'minQuantity',
      v_option ->> 'min_quantity'
    )), '');
    if v_text is null then
      v_min_quantity := 1;
    else
      begin
        v_min_quantity := v_text::integer;
      exception when others then
        raise exception 'minQuantity is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'maxQuantity',
      v_option ->> 'max_quantity'
    )), '');
    if v_text is null then
      v_max_quantity := 1;
    else
      begin
        v_max_quantity := v_text::integer;
      exception when others then
        raise exception 'maxQuantity is invalid' using errcode = '22023';
      end;
    end if;

    if v_min_quantity < 1
       or v_max_quantity < v_min_quantity then
      raise exception 'Invalid quantity limits' using errcode = '22023';
    end if;

    if v_allow_quantity = false
       and (v_min_quantity <> 1 or v_max_quantity <> 1) then
      raise exception 'Invalid quantity limits' using errcode = '22023';
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'isDonation',
      v_option ->> 'is_donation'
    )), '');
    if v_text is null then
      v_is_donation := false;
    else
      begin
        v_is_donation := v_text::boolean;
      exception when others then
        raise exception 'isDonation is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'countsTowardCapacity',
      v_option ->> 'counts_toward_capacity'
    )), '');
    if v_text is null then
      v_counts_toward_capacity := true;
    else
      begin
        v_counts_toward_capacity := v_text::boolean;
      exception when others then
        raise exception 'countsTowardCapacity is invalid'
          using errcode = '22023';
      end;
    end if;

    v_group_key := nullif(btrim(coalesce(
      v_option ->> 'groupKey',
      v_option ->> 'group_key'
    )), '');

    if v_option ? 'conflictsWith' then
      v_raw := v_option -> 'conflictsWith';
    elsif v_option ? 'conflicts_with' then
      v_raw := v_option -> 'conflicts_with';
    else
      v_raw := null;
    end if;

    if v_raw is null or jsonb_typeof(v_raw) = 'null' then
      v_conflicts_with := '[]'::jsonb;
    elsif jsonb_typeof(v_raw) = 'array' then
      v_conflicts_with := v_raw;
    else
      raise exception 'conflictsWith must be an array'
        using errcode = '22023';
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'sortOrder',
      v_option ->> 'sort_order'
    )), '');
    if v_text is null then
      v_sort_order := v_index;
    else
      begin
        v_sort_order := v_text::integer;
      exception when others then
        raise exception 'sortOrder is invalid' using errcode = '22023';
      end;
    end if;

    v_text := nullif(btrim(coalesce(
      v_option ->> 'isActive',
      v_option ->> 'is_active'
    )), '');
    if v_text is null then
      v_is_active := true;
    else
      begin
        v_is_active := v_text::boolean;
      exception when others then
        raise exception 'isActive is invalid' using errcode = '22023';
      end;
    end if;

    insert into public.event_participation_options (
      event_id,
      title,
      description,
      price_amount,
      price_currency,
      option_type,
      seat_limit,
      allow_quantity,
      min_quantity,
      max_quantity,
      is_donation,
      counts_toward_capacity,
      group_key,
      conflicts_with,
      sort_order,
      is_active
    ) values (
      p_event_id,
      v_title,
      v_description,
      v_price_amount,
      v_price_currency,
      v_option_type,
      v_seat_limit,
      v_allow_quantity,
      v_min_quantity,
      v_max_quantity,
      v_is_donation,
      v_counts_toward_capacity,
      v_group_key,
      v_conflicts_with,
      v_sort_order,
      v_is_active
    );

    v_index := v_index + 1;
  end loop;

  return query
  select *
  from public.event_participation_options
  where event_id = p_event_id
  order by sort_order asc, created_at asc;
end;
$$;

revoke all on function public.admin_replace_event_participation_options(uuid, jsonb) from public;
grant execute on function public.admin_replace_event_participation_options(uuid, jsonb) to authenticated;

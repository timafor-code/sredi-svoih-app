-- Admin registration capacity analytics RPC: reservation fallback hotfix.
-- Keeps capacity reservations as the primary source for bucket analytics, but
-- adds a read-only fallback for legacy/test registrations that have active
-- seat-taking option selections without matching rows in
-- event_registration_capacity_reservations. The fallback never inserts
-- reservations, never changes capacity, and never affects public registration.

create or replace function public.admin_get_registration_capacity_analytics(
  p_event_id uuid,
  p_occurrence_id uuid default null
)
returns table (
  event_id uuid,
  occurrence_id uuid,
  totals jsonb,
  bucket_aggregate jsonb,
  buckets jsonb,
  option_stats jsonb,
  donation_options jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_occurrence public.event_occurrences;
  v_scope_capacity integer;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_event_id is null then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_occurrence_id is not null then
    select *
    into v_occurrence
    from public.event_occurrences eo
    where eo.id = p_occurrence_id
      and eo.event_id = p_event_id;

    if not found then
      raise exception 'Occurrence not found for this event' using errcode = 'P0002';
    end if;
  end if;

  v_scope_capacity := coalesce(v_occurrence.capacity, v_event.capacity);

  return query
  with scoped_registrations as (
    select r.*
    from public.event_registrations r
    where r.event_id = p_event_id
      and (
        (p_occurrence_id is null and r.occurrence_id is null)
        or (p_occurrence_id is not null and r.occurrence_id = p_occurrence_id)
      )
  ),
  active_registrations as (
    select sr.*
    from scoped_registrations sr
    where sr.status in ('confirmed', 'pending', 'attended', 'no_show')
  ),
  status_counts as (
    select
      count(*)::integer as total_registrations,
      count(*) filter (where sr.status = 'confirmed')::integer as confirmed_count,
      count(*) filter (where sr.status = 'pending')::integer as pending_count,
      count(*) filter (where sr.status = 'waitlisted')::integer as waitlisted_count,
      count(*) filter (where sr.status = 'cancelled')::integer as cancelled_count,
      count(*) filter (where sr.status = 'rejected')::integer as rejected_count,
      count(*) filter (where sr.status = 'attended')::integer as attended_count,
      count(*) filter (where sr.status = 'no_show')::integer as no_show_count,
      count(*) filter (
        where sr.status in ('confirmed', 'pending', 'attended', 'no_show')
      )::integer as active_registrations_count,
      coalesce(
        sum(sr.seats_count) filter (
          where sr.status in ('confirmed', 'pending', 'attended', 'no_show')
        ),
        0
      )::integer as active_seats_count,
      count(distinct sr.user_id) filter (
        where sr.status in ('confirmed', 'pending', 'attended', 'no_show')
      )::integer as unique_registered_users_count
    from scoped_registrations sr
  ),
  active_guest_names as (
    select distinct lower(btrim(guest_name.value)) as guest_key
    from active_registrations ar
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(ar.guest_names) = 'array' then ar.guest_names
        else '[]'::jsonb
      end
    ) as guest_name(value)
    where btrim(guest_name.value) <> ''
  ),
  active_option_rows as (
    select eros.*
    from active_registrations ar
    join public.event_registration_option_selections eros
      on eros.registration_id = ar.id
  ),
  option_stat_rows as (
    select
      aor.option_id,
      aor.title_snapshot,
      aor.option_type_snapshot,
      aor.is_donation,
      aor.counts_toward_capacity,
      count(distinct aor.registration_id)::integer as registrations_count,
      coalesce(sum(aor.quantity), 0)::integer as quantity,
      coalesce(sum(aor.seats_count), 0)::integer as seats_count
    from active_option_rows aor
    group by
      aor.option_id,
      aor.title_snapshot,
      aor.option_type_snapshot,
      aor.is_donation,
      aor.counts_toward_capacity
  ),
  option_stats_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'optionId', osr.option_id,
          'title', osr.title_snapshot,
          'optionType', osr.option_type_snapshot,
          'registrationsCount', osr.registrations_count,
          'quantity', osr.quantity,
          'seatsCount', osr.seats_count,
          'isDonation', osr.is_donation,
          'countsTowardCapacity', osr.counts_toward_capacity
        )
        order by osr.is_donation asc, lower(osr.title_snapshot) asc
      ),
      '[]'::jsonb
    ) as payload
    from option_stat_rows osr
  ),
  donation_options_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'optionId', osr.option_id,
          'title', osr.title_snapshot,
          'optionType', osr.option_type_snapshot,
          'registrationsCount', osr.registrations_count,
          'quantity', osr.quantity,
          'seatsCount', osr.seats_count,
          'isDonation', osr.is_donation,
          'countsTowardCapacity', osr.counts_toward_capacity
        )
        order by osr.is_donation desc, lower(osr.title_snapshot) asc
      ),
      '[]'::jsonb
    ) as payload
    from option_stat_rows osr
    where osr.is_donation is true
      or osr.counts_toward_capacity is false
  ),
  donation_counts as (
    select
      count(*) filter (where aor.is_donation is true)::integer as donation_selections_count,
      coalesce(
        sum(aor.quantity) filter (where aor.is_donation is true),
        0
      )::integer as donation_quantity,
      count(distinct aor.registration_id) filter (
        where aor.is_donation is true
      )::integer as donation_registrations_count
    from active_option_rows aor
  ),
  active_capacity_reservations as (
    select ecr.*
    from public.event_registration_capacity_reservations ecr
    join active_registrations ar
      on ar.id = ecr.registration_id
    where ecr.event_id = p_event_id
      and (
        (p_occurrence_id is null and ecr.occurrence_id is null)
        or (p_occurrence_id is not null and ecr.occurrence_id = p_occurrence_id)
      )
  ),
  -- Read-only fallback: aggregate active seat-taking option selections per
  -- registration/option so we can synthesize obligations for registrations that
  -- predate (or otherwise lack) capacity reservation rows. Donation and
  -- non-capacity options are excluded and never create a fallback obligation.
  fallback_option_selections as (
    select
      aor.registration_id,
      aor.option_id,
      min(aor.title_snapshot) as option_title_snapshot,
      coalesce(sum(aor.quantity), 0)::integer as quantity
    from active_option_rows aor
    where aor.option_id is not null
      and aor.is_donation is not true
      and aor.counts_toward_capacity is true
    group by aor.registration_id, aor.option_id
  ),
  -- Expand each fallback selection across its mapped capacity units. Skip any
  -- (registration_id, option_id, capacity_unit_id) triple that already has a
  -- real reservation row so we never double-count existing reservations. Seats
  -- are computed with the project's current model: quantity * seats_per_quantity.
  fallback_capacity_reservations as (
    select
      fos.registration_id,
      map.capacity_unit_id,
      fos.option_id,
      coalesce(fos.option_title_snapshot, ecu.title, 'Option') as option_title_snapshot,
      fos.quantity,
      (fos.quantity * map.seats_per_quantity)::integer as seats_count
    from fallback_option_selections fos
    join public.event_participation_option_capacity_units map
      on map.option_id = fos.option_id
     and map.event_id = p_event_id
    join public.event_capacity_units ecu
      on ecu.id = map.capacity_unit_id
     and ecu.event_id = p_event_id
    where fos.quantity > 0
      and not exists (
        select 1
        from active_capacity_reservations acr
        where acr.registration_id = fos.registration_id
          and acr.capacity_unit_id = map.capacity_unit_id
          and acr.option_id is not distinct from fos.option_id
      )
  ),
  -- Primary source (real reservations) plus read-only fallback obligations.
  combined_capacity_reservations as (
    select
      acr.registration_id,
      acr.capacity_unit_id,
      acr.option_id,
      coalesce(acr.option_title_snapshot, 'Option') as option_title_snapshot,
      acr.quantity,
      acr.seats_count
    from active_capacity_reservations acr
    union all
    select
      fcr.registration_id,
      fcr.capacity_unit_id,
      fcr.option_id,
      fcr.option_title_snapshot,
      fcr.quantity,
      fcr.seats_count
    from fallback_capacity_reservations fcr
  ),
  multi_meal_guests as (
    select count(*)::integer as registrations_count
    from (
      select ccr.registration_id
      from combined_capacity_reservations ccr
      group by ccr.registration_id
      having count(distinct ccr.capacity_unit_id) > 1
    ) grouped
  ),
  bucket_stat_rows as (
    select
      ccr.capacity_unit_id,
      coalesce(sum(ccr.seats_count), 0)::integer as occupied_seats,
      count(*)::integer as reservations_count
    from combined_capacity_reservations ccr
    group by ccr.capacity_unit_id
  ),
  bucket_option_rows as (
    select
      ccr.capacity_unit_id,
      ccr.option_id,
      coalesce(ccr.option_title_snapshot, 'Option') as option_title,
      count(distinct ccr.registration_id)::integer as registrations_count,
      coalesce(sum(ccr.quantity), 0)::integer as quantity,
      coalesce(sum(ccr.seats_count), 0)::integer as seats_count
    from combined_capacity_reservations ccr
    group by
      ccr.capacity_unit_id,
      ccr.option_id,
      coalesce(ccr.option_title_snapshot, 'Option')
  ),
  bucket_options_json as (
    select
      bor.capacity_unit_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'optionId', bor.option_id,
            'title', bor.option_title,
            'registrationsCount', bor.registrations_count,
            'quantity', bor.quantity,
            'seatsCount', bor.seats_count,
            'isDonation', false,
            'countsTowardCapacity', true
          )
          order by lower(bor.option_title) asc
        ),
        '[]'::jsonb
      ) as option_breakdown,
      coalesce(
        jsonb_agg(to_jsonb(bor.option_title) order by lower(bor.option_title) asc),
        '[]'::jsonb
      ) as option_titles
    from bucket_option_rows bor
    group by bor.capacity_unit_id
  ),
  bucket_values as (
    select
      ecu.id as capacity_unit_id,
      ecu.key,
      ecu.title,
      ecu.capacity,
      coalesce(ecu.capacity, v_scope_capacity) as effective_capacity,
      ecu.sort_order,
      ecu.created_at,
      coalesce(bsr.occupied_seats, 0)::integer as occupied_seats,
      coalesce(bsr.reservations_count, 0)::integer as reservations_count,
      coalesce(boj.option_breakdown, '[]'::jsonb) as option_breakdown,
      coalesce(boj.option_titles, '[]'::jsonb) as option_titles
    from public.event_capacity_units ecu
    left join bucket_stat_rows bsr
      on bsr.capacity_unit_id = ecu.id
    left join bucket_options_json boj
      on boj.capacity_unit_id = ecu.id
    where ecu.event_id = p_event_id
  ),
  bucket_values_with_metrics as (
    select
      bv.*,
      case
        when bv.capacity is null then null
        else greatest(0, bv.capacity - bv.occupied_seats)
      end as remaining_seats,
      case
        when bv.effective_capacity is null then null
        else greatest(0, bv.effective_capacity - bv.occupied_seats)
      end as effective_remaining_seats,
      case
        when bv.capacity is not null and bv.capacity > 0 then
          least(100, round((bv.occupied_seats::numeric / bv.capacity::numeric) * 100))::integer
        else null
      end as fill_percent,
      case
        when bv.effective_capacity is not null and bv.effective_capacity > 0 then
          least(
            100,
            round((bv.occupied_seats::numeric / bv.effective_capacity::numeric) * 100)
          )::integer
        else null
      end as effective_fill_percent
    from bucket_values bv
  ),
  buckets_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'capacityUnitId', bvm.capacity_unit_id,
          'capacity_unit_id', bvm.capacity_unit_id,
          'key', bvm.key,
          'code', bvm.key,
          'title', bvm.title,
          'capacity', bvm.capacity,
          'effectiveCapacity', bvm.effective_capacity,
          'occupiedSeats', bvm.occupied_seats,
          'remainingSeats', bvm.remaining_seats,
          'freeSeats', bvm.effective_remaining_seats,
          'effectiveRemainingSeats', bvm.effective_remaining_seats,
          'fillPercent', bvm.fill_percent,
          'effectiveFillPercent', bvm.effective_fill_percent,
          'effectiveFreePercent', case
            when bvm.effective_fill_percent is null then null
            else greatest(0, 100 - bvm.effective_fill_percent)
          end,
          'reservationsCount', bvm.reservations_count,
          'optionTitles', bvm.option_titles,
          'optionBreakdown', bvm.option_breakdown,
          'isUnlimited', bvm.capacity is null,
          'usesFallbackCapacity', bvm.capacity is null and bvm.effective_capacity is not null
        )
        order by bvm.sort_order asc, bvm.created_at asc, bvm.title asc
      ),
      '[]'::jsonb
    ) as payload
    from bucket_values_with_metrics bvm
  ),
  bucket_aggregate_values as (
    select
      coalesce(sum(bvm.occupied_seats), 0)::integer as occupied_seats,
      coalesce(
        sum(bvm.occupied_seats) filter (where bvm.effective_capacity is not null),
        0
      )::integer as limited_occupied_seats,
      coalesce(
        sum(bvm.effective_capacity) filter (where bvm.effective_capacity is not null),
        0
      )::integer as known_capacity,
      coalesce(
        sum(bvm.effective_remaining_seats) filter (where bvm.effective_capacity is not null),
        0
      )::integer as remaining_seats,
      count(*) filter (where bvm.effective_capacity is not null)::integer as limited_bucket_count,
      count(*) filter (where bvm.effective_capacity is null) > 0 as has_unlimited_buckets
    from bucket_values_with_metrics bvm
  ),
  bucket_aggregate_json as (
    select jsonb_build_object(
      'occupiedSeats', bagv.occupied_seats,
      'knownCapacity', bagv.known_capacity,
      'remainingSeats', bagv.remaining_seats,
      'fillPercent', case
        when bagv.known_capacity > 0 then
          least(
            100,
            round((bagv.limited_occupied_seats::numeric / bagv.known_capacity::numeric) * 100)
          )::integer
        else null
      end,
      'freePercent', case
        when bagv.known_capacity > 0 then
          greatest(
            0,
            100 - least(
              100,
              round((bagv.limited_occupied_seats::numeric / bagv.known_capacity::numeric) * 100)
            )::integer
          )
        else null
      end,
      'limitedBucketCount', bagv.limited_bucket_count,
      'hasUnlimitedBuckets', bagv.has_unlimited_buckets
    ) as payload
    from bucket_aggregate_values bagv
  ),
  active_guest_counts as (
    select count(*)::integer as unique_guest_count
    from active_guest_names
  ),
  totals_json as (
    select jsonb_build_object(
      'totalRegistrations', sc.total_registrations,
      'totalRegistrationsCount', sc.total_registrations,
      'statusCounts', jsonb_build_object(
        'confirmed', sc.confirmed_count,
        'pending', sc.pending_count,
        'waitlisted', sc.waitlisted_count,
        'cancelled', sc.cancelled_count,
        'rejected', sc.rejected_count,
        'attended', sc.attended_count,
        'no_show', sc.no_show_count
      ),
      'confirmedCount', sc.confirmed_count,
      'pendingCount', sc.pending_count,
      'waitlistedCount', sc.waitlisted_count,
      'cancelledCount', sc.cancelled_count,
      'rejectedCount', sc.rejected_count,
      'attendedCount', sc.attended_count,
      'noShowCount', sc.no_show_count,
      'activeRegistrationsCount', sc.active_registrations_count,
      'activeSeatsCount', sc.active_seats_count,
      'uniqueRegisteredUsersCount', sc.unique_registered_users_count,
      'uniqueGuestsCount', agc.unique_guest_count,
      'uniquePeopleCount', sc.unique_registered_users_count + agc.unique_guest_count,
      'multiMealGuestsCount', mmg.registrations_count,
      'sponsorsDonationsCount', dc.donation_selections_count,
      'donationsCount', dc.donation_selections_count,
      'donationQuantity', dc.donation_quantity,
      'donationRegistrationsCount', dc.donation_registrations_count,
      'capacity', v_scope_capacity,
      'remainingSeats', case
        when v_scope_capacity is null then null
        else greatest(0, v_scope_capacity - sc.active_seats_count)
      end,
      'freeSeats', case
        when v_scope_capacity is null then null
        else greatest(0, v_scope_capacity - sc.active_seats_count)
      end,
      'fillPercent', case
        when v_scope_capacity is not null and v_scope_capacity > 0 then
          least(100, round((sc.active_seats_count::numeric / v_scope_capacity::numeric) * 100))::integer
        else null
      end,
      'freePercent', case
        when v_scope_capacity is not null and v_scope_capacity > 0 then
          greatest(
            0,
            100 - least(
              100,
              round((sc.active_seats_count::numeric / v_scope_capacity::numeric) * 100)
            )::integer
          )
        else null
      end
    ) as payload
    from status_counts sc
    cross join active_guest_counts agc
    cross join multi_meal_guests mmg
    cross join donation_counts dc
  )
  select
    p_event_id,
    p_occurrence_id,
    tj.payload,
    baj.payload,
    bj.payload,
    osj.payload,
    doj.payload
  from totals_json tj
  cross join bucket_aggregate_json baj
  cross join buckets_json bj
  cross join option_stats_json osj
  cross join donation_options_json doj;
end;
$$;

revoke all on function public.admin_get_registration_capacity_analytics(uuid, uuid) from public;
grant execute on function public.admin_get_registration_capacity_analytics(uuid, uuid) to authenticated;

-- Backfill legacy event registrations that predate event_occurrences.
--
-- Safe matches only:
--   1. The parent event has exactly one event_occurrences row.
--   2. Or exactly one event_occurrences row starts at the same timestamp as
--      events.starts_at.
--
-- Ambiguous or unmatched legacy rows stay untouched. To inspect those rows,
-- use the diagnostics documented in docs/admin-events-rpc.md.

drop table if exists pg_temp.legacy_registration_occurrence_matches;

create temp table legacy_registration_occurrence_matches on commit drop as
with legacy_rows as (
  select
    r.id as registration_id,
    r.event_id,
    e.starts_at as event_starts_at
  from public.event_registrations r
  join public.events e
    on e.id = r.event_id
  where r.occurrence_id is null
    and exists (
      select 1
      from public.event_occurrences eo
      where eo.event_id = r.event_id
    )
),
occurrence_counts as (
  select
    eo.event_id,
    count(*)::integer as occurrence_count
  from public.event_occurrences eo
  group by eo.event_id
),
candidates as (
  select
    lr.registration_id,
    eo.id as occurrence_id,
    case
      when oc.occurrence_count = 1 then 'single_occurrence'
      when eo.starts_at = lr.event_starts_at then 'event_starts_at'
      else null
    end as match_reason
  from legacy_rows lr
  join occurrence_counts oc
    on oc.event_id = lr.event_id
  join public.event_occurrences eo
    on eo.event_id = lr.event_id
  where oc.occurrence_count = 1
    or eo.starts_at = lr.event_starts_at
)
select
  lr.registration_id,
  lr.event_id,
  case
    when count(distinct c.occurrence_id) = 1 then (
      array_agg(distinct c.occurrence_id)
        filter (where c.occurrence_id is not null)
    )[1]
    else null::uuid
  end as matched_occurrence_id,
  count(distinct c.occurrence_id)::integer as candidate_occurrence_count,
  coalesce(
    array_agg(distinct c.match_reason order by c.match_reason)
      filter (where c.match_reason is not null),
    array[]::text[]
  ) as match_reasons
from legacy_rows lr
left join candidates c
  on c.registration_id = lr.registration_id
group by lr.registration_id, lr.event_id;

do $$
declare
  v_legacy_rows integer;
  v_backfillable_rows integer;
  v_ambiguous_or_unmatched_rows integer;
  v_updated_rows integer;
begin
  select count(*)::integer
  into v_legacy_rows
  from pg_temp.legacy_registration_occurrence_matches;

  select count(*)::integer
  into v_backfillable_rows
  from pg_temp.legacy_registration_occurrence_matches
  where matched_occurrence_id is not null;

  select count(*)::integer
  into v_ambiguous_or_unmatched_rows
  from pg_temp.legacy_registration_occurrence_matches
  where matched_occurrence_id is null;

  raise notice
    'Legacy registration occurrence backfill planned: legacy_rows=%, backfillable_rows=%, ambiguous_or_unmatched_rows=%',
    v_legacy_rows,
    v_backfillable_rows,
    v_ambiguous_or_unmatched_rows;

  with updated as (
    update public.event_registrations r
    set occurrence_id = m.matched_occurrence_id
    from pg_temp.legacy_registration_occurrence_matches m
    where r.id = m.registration_id
      and r.occurrence_id is null
      and m.matched_occurrence_id is not null
    returning 1
  )
  select count(*)::integer
  into v_updated_rows
  from updated;

  raise notice
    'Legacy registration occurrence backfill applied: updated_rows=%',
    v_updated_rows;
end $$;

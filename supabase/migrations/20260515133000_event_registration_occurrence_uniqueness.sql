-- Allow one user to register for multiple occurrences of the same parent event.
-- Duplicates are blocked only for active registration targets:
--   (event_id, user_id, occurrence_id) for occurrence registrations,
--   (event_id, user_id) when occurrence_id is null.

alter table public.event_registrations
  drop constraint if exists event_registrations_event_id_user_id_key;

drop index if exists event_registrations_event_user_occurrence_active_unique;
drop index if exists event_registrations_event_user_no_occurrence_active_unique;

create unique index event_registrations_event_user_occurrence_active_unique
  on public.event_registrations(event_id, user_id, occurrence_id)
  where occurrence_id is not null
    and status in ('pending', 'confirmed', 'waitlisted', 'attended');

create unique index event_registrations_event_user_no_occurrence_active_unique
  on public.event_registrations(event_id, user_id)
  where occurrence_id is null
    and status in ('pending', 'confirmed', 'waitlisted', 'attended');

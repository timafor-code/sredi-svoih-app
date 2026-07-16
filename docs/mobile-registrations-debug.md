# Mobile registrations debug

> Historical pre-PR 38 debugging record. Mobile production now uses only the
> Python API; the Supabase values and SQL checks below are not runtime
> configuration.

This note is for checking a historical mobile "My registrations" mismatch
against the local Supabase database.

## Goal

Mobile, web-admin, Excel, and SQL must agree on the number of `event_registrations` rows for the same auth user.

For the David Lisus case:

- expected Supabase URL in Expo logs: `http://192.168.1.11:54321`
- expected auth user id: `bacd5c54-f9f4-40d7-8e26-4d79c37d383c`
- expected email: `timaforcoin@gmail.com`
- expected registration row id: `9a1646ce-0bec-4628-9154-cef852278ee6`
- expected event title: `Шаббат открыто`
- expected registrations count: `1`

## SQL checks

Run this first when you know one registration id and need all registrations for that user.

```sql
with target_user as (
  select user_id
  from public.event_registrations
  where id = '9a1646ce-0bec-4628-9154-cef852278ee6'
)
select
  p.display_name,
  p.email,
  r.user_id,
  r.id,
  r.event_id,
  e.title,
  r.occurrence_id,
  eo.starts_at as occurrence_starts_at,
  eo.title as occurrence_title,
  r.status,
  r.seats_count,
  r.payment_status,
  r.payment_id,
  r.registered_at,
  r.created_at,
  r.updated_at
from public.event_registrations r
join target_user tu on tu.user_id = r.user_id
join public.events e on e.id = r.event_id
left join public.event_occurrences eo on eo.id = r.occurrence_id
left join public.profiles p on p.id = r.user_id
order by r.registered_at desc, r.created_at desc;
```

Then verify the selected options attached to those rows.

```sql
select
  p.display_name,
  p.email,
  r.id as registration_id,
  r.event_id,
  e.title,
  r.occurrence_id,
  eo.starts_at as occurrence_starts_at,
  r.status,
  r.seats_count,
  r.registered_at,
  os.title_snapshot,
  os.quantity,
  os.unit_price_amount,
  os.total_amount,
  os.seats_count as option_seats_count,
  os.is_donation
from public.event_registrations r
join public.events e on e.id = r.event_id
left join public.event_occurrences eo on eo.id = r.occurrence_id
left join public.profiles p on p.id = r.user_id
left join public.event_registration_option_selections os on os.registration_id = r.id
where r.user_id = 'bacd5c54-f9f4-40d7-8e26-4d79c37d383c'
order by r.registered_at desc, os.created_at asc;
```

## Mobile dev logs

The mobile app logs extra diagnostics only in `__DEV__`. They are not shown to production users.

After `loadMyRegistrationsService()` completes, look for:

- `[mobile registrations] loadMyRegistrationsService result`
- `supabaseUrl`: must match `EXPO_PUBLIC_SUPABASE_URL`
- `authUser.id` and `authUser.email`: must match the user being checked
- `registrationsCount`: number of rows returned by `event_registrations`
- `registrations`: each row as `id`, `eventId`, `occurrenceId`, `status`, `registeredAt`, `title`
- `debugEventGroup`: details for `Шаббат открыто`, including registration ids, occurrence ids, and selected option titles

On the "My registrations" screen, look for:

- `[mobile registrations] my-registrations groups`
- `sourceRegistrationsCount`: rows currently in `myRegistrations`
- `activeRegistrationRowsAfterBuildMyRegistrationGroups`: active registration rows represented after grouping
- `activeGroupsCount`: event cards shown by the active screen grouping
- `debugEventGroup.totalRegistrationsCount`: rows for `Шаббат открыто`

On the event group detail screen, look for:

- `[mobile registrations] registration-group detail`
- `totalRegistrationsCount`: rows shown inside the selected event group
- `registrationIds`: row ids displayed by the detail screen
- `selectedOptionTitles`: options displayed inside each registration row

## How to read the David case

For David Lisus, the healthy path is:

- SQL query A returns one `event_registrations` row.
- SQL query B returns selected options for that one row.
- Mobile `loadMyRegistrationsService result.registrationsCount` is `1`.
- Mobile `debugEventGroup.registrationIds` contains only `9a1646ce-0bec-4628-9154-cef852278ee6`.
- Mobile `debugEventGroup.selectedOptions` contains `Пятничная вечерняя трапеза` and `Подарить нуждающимся` inside that same registration.
- Mobile `activeRegistrationRowsAfterBuildMyRegistrationGroups` counts registration rows, not selected options.

Donation options are option selections inside a registration. They must not create extra registrations and must not increase `seats_count`.

For Reuven Kolin, if SQL returns two distinct `event_registrations.id` values, mobile should show two registration rows for that event group.

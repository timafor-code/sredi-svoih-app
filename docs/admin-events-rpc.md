# Admin Events RPC Flow

This is the backend foundation for the future Admin Events Center. It adds RPCs
and client service/types only; it does not add UI, routes, dashboard screens, or
client-side admin Supabase access.

## Source Of Truth

Website import data should flow through review tables before becoming app
events:

```text
website -> event_import_runs -> event_import_items -> admin review -> events
```

The importer stores scraped items in `event_import_items` with the raw parser
payload. Review hints live under `raw_payload.importReview`, including
`dateConfidence`, `dateStatus`, `reason`, and optional suggested dates.

Import items are not automatically published by the Admin Events Center RPCs.
An admin or event manager must explicitly publish or ignore each item.

## Access Model

Supabase Auth only identifies the user. Community membership controls admin
permissions.

The admin event RPCs use the normal authenticated Supabase client session and
check that the current user has an active `admin` or `event_manager` role in the
relevant community through `has_community_role(...)`.

The React Native client must not use a service role key, must not call the
Supabase admin API, and must not freely write to `events` for admin workflows.

## RPCs

- `admin_list_import_items_needing_review(limit_count integer default 50)`
  returns import items that still need manual review.
- `admin_get_import_item(import_item_id uuid)` returns one import item for a
  detail/review screen.
- `admin_create_event(payload jsonb)` creates a manual event with
  `source_type = 'manual'` and `manual_override = true`.
- `admin_update_event(event_id uuid, payload jsonb)` updates allowed event fields
  for an existing event in a community where the caller is an `admin` or
  `event_manager`.
- `admin_list_registration_events()` returns event cards for communities where
  the caller is an `admin` or `event_manager`, with occurrence and registration
  status counters for the future registrations screen.
- `admin_list_event_registrations(payload jsonb)` returns registration rows for
  one event, optionally filtered by occurrence, status, and search text.
- `admin_update_registration_status(registration_id uuid, next_status text,
  reason text default null)` moves a registration between queue/review states.
- `admin_mark_registration_attendance(registration_id uuid, attendance_status
  text)` marks a registration as attended or no-show.
- `register_for_paid_event_simulated(payload jsonb)` creates an authenticated
  MVP/dev-only paid registration simulation for `internal_paid` events.
- `admin_list_community_locations()` returns community event locations visible
  to the authenticated caller. `admin` receives active and archived rows for
  their communities; `event_manager` receives active rows only.
- `admin_create_community_location(payload jsonb)`,
  `admin_update_community_location(location_id uuid, payload jsonb)`, and
  `admin_archive_community_location(location_id uuid)` manage the event
  location dictionary for callers with an active `admin` role in that
  community.
- `admin_publish_import_item(import_item_id uuid, payload jsonb)` creates or
  updates/links an event from a reviewed import item with
  `source_type = 'website_scrape'` and `manual_override = true`.
- `admin_ignore_import_item(import_item_id uuid, reason text default null)`
  marks an import item as ignored and stores ignore metadata under
  `raw_payload.adminReview`.

Execute grants are limited to authenticated users. Guest and regular member
accounts should receive permission errors or empty review lists because they do
not have the required community role.

## `admin_update_event`

Signature:

```sql
admin_update_event(event_id uuid, payload jsonb) returns public.events
```

The RPC loads the target `events` row, rejects missing events with
`Event not found`, requires an authenticated user, then verifies that the user
has an active `admin` or `event_manager` membership in the event's
`community_id`.

The payload may use either camelCase or snake_case keys for fields that already
have both forms in the admin create flow. Only these event fields are updated:

```text
title
subtitle
short_description / shortDescription
description
starts_at / startsAt
ends_at / endsAt
is_permanent / isPermanent
timezone
location_name / locationName
address
latitude
longitude
image_url / imageUrl
category
audience
visibility
status
registration_mode / registrationMode
registration_url / registrationUrl
capacity
waitlist_enabled / waitlistEnabled
requires_approval / requiresApproval
price_amount / priceAmount
price_currency / priceCurrency
manual_override / manualOverride
```

The RPC does not allow changing `id`, `community_id`, `created_at`,
`created_by`, `source_type`, `source_external_id`, `source_url`, or
`published_at` directly. `updated_by` is controlled by the RPC and is set to the
current authenticated user.

Validation mirrors the existing admin create/import values: `title` and
`timezone` cannot be empty when passed; `starts_at` must cast to
`timestamptz`; `ends_at` must be null or later than the effective `starts_at`;
`is_permanent` defaults to `false` and, when true, clears `ends_at` to `null`;
`status` is limited to `draft`, `published`, `cancelled`, `archived`;
`visibility` is limited to `public`, `members_only`, `hidden`;
`registration_mode` is limited to `none`, `external_link`, `internal_free`,
`internal_paid`; `external_link` requires a non-empty `registration_url`;
`capacity` must be null or positive; `price_amount` must be null or `>= 0`; and
`price_currency` defaults to `RUB` when a price amount is set without an
existing currency.

When `status` changes to `published` and the event has no `published_at`, the
RPC sets `published_at = now()`. Moving a published event back to
`draft`, `cancelled`, or `archived` preserves the historical `published_at`.
If `status` is not changed, `published_at` is not changed.

`is_permanent` is for parent/card/series events such as courses, Shabbat
series, or recurring event containers that should stay active in admin time
grouping even when a technical end date is absent or would otherwise be in the
past. It is stored on `events`; concrete dated sessions still belong in
`event_occurrences`.

Every successful admin update stores `manual_override = true`. This matches the
website importer protection: later imports skip events marked as manual
overrides, so an admin edit cannot be overwritten by the importer. Passing
`manualOverride: false` is rejected.

Example:

```json
{
  "title": "Updated lecture title",
  "startsAt": "2026-05-12T19:00:00+03:00",
  "endsAt": null,
  "isPermanent": true,
  "timezone": "Europe/Moscow",
  "status": "published",
  "visibility": "members_only",
  "registrationMode": "external_link",
  "registrationUrl": "https://example.com/register",
  "capacity": 80,
  "priceAmount": 0,
  "priceCurrency": "RUB"
}
```

## Registration Management RPCs

The registrations foundation supports the three-column web-admin view from
`docs/prototype/admin-events-center.html`: events on the left, registrations in
the center, and participant details on the right. The web-admin UI is wired to
these RPCs in `apps/admin/src/pages/RegistrationsPage.tsx`.

`admin_list_registration_events()` returns one row per event the authenticated
caller can manage:

```text
event_id
title
starts_at
event_kind
registration_mode
occurrence_count
confirmed_count
pending_count
waitlisted_count
cancelled_count
rejected_count
attended_count
no_show_count
```

`admin_list_event_registrations(payload jsonb)` accepts camelCase or snake_case
event and occurrence keys:

```json
{
  "eventId": "event uuid",
  "occurrenceId": "optional occurrence uuid",
  "status": "pending",
  "search": "name, email, phone, comment, or guest",
  "limit": 100,
  "offset": 0
}
```

`eventId`/`event_id` is required. `occurrenceId`/`occurrence_id`, `status`,
`search`, `limit`, and `offset` are optional. `status: "all"` is treated as no
status filter. The RPC clamps `limit` to `1..200`.

Registration rows are row-based: each `event_registrations.id` returned by the
RPC is one UI/export row. The RPC must not collapse multiple rows for the same
`user_id`, `event_id`, `occurrence_id`, email, or profile. When `occurrenceId`
is passed, the RPC returns every registration row for that occurrence.

Registration rows include the registration id, event and occurrence ids,
participant profile display name, email, phone, status, seat count, guest names,
comment, payment status/id, registration timestamps, occurrence
starts/ends/title, selected participation options as a JSONB array, and
`total_amount` when it can be summed from option selections.

### Occurrence IDs And Legacy Registrations

`event_registrations.id` is the source of truth for one registration row.
For events with concrete dates in `event_occurrences`, current registration
flows store the selected session in `event_registrations.occurrence_id`.
Web-admin and Excel selected-occurrence views filter by that `occurrence_id`.

Older rows may have `occurrence_id is null` because they were created before
the occurrence model existed. Mobile can still show those rows under the parent
event because it reads `event_registrations` directly and can fall back to the
parent `events.starts_at` date. A selected-occurrence admin/export request is
stricter: it returns rows whose normalized `occurrence_id` is the selected
occurrence.

Migration
`20260518193000_backfill_legacy_registration_occurrences.sql` normalizes only
legacy rows that can be matched safely:

- the event has exactly one `event_occurrences` row; or
- exactly one occurrence has `event_occurrences.starts_at = events.starts_at`.

Rows with multiple possible occurrences, no timestamp match, or otherwise
ambiguous evidence are not updated automatically. This avoids turning one
uncertain legacy row into a false selected-occurrence registration. After this
normalization, selected-occurrence export contains only registration rows for
the selected occurrence; ambiguous legacy rows remain event-level until they
are reviewed and corrected deliberately.

Status transitions:

```text
admin_update_registration_status:
  allowed next_status values: pending, confirmed, waitlisted, cancelled, rejected
  confirmed sets confirmed_at when it was empty
  cancelled/rejected set cancelled_at when it was empty
  pending/confirmed/waitlisted clear cancelled_at

admin_mark_registration_attendance:
  allowed attendance_status values: attended, no_show
  writes event_registrations.status to attended/no_show
```

The `reason` parameter on `admin_update_registration_status` is reserved for a
future audit/notification layer. The current schema has no dedicated reason
column, so the RPC accepts the value but does not persist it.

All registration management RPCs require `auth.uid()` and verify the
registration event's community through `has_community_role(...)` with
`array['admin', 'event_manager']`. Execute grants are limited to
`authenticated`.

CSV export is intentionally not part of this foundation. Web-admin uses Excel
`.xlsx` for registration exports.

## Paid Registration Simulation RPC

`register_for_paid_event_simulated(payload jsonb)` is a temporary MVP/dev flow
for mobile testing of `internal_paid` events. It is not a production payment
integration: no real gateway, `create_payment`, checkout redirect, or
`payment_webhook` is implemented.

The RPC requires `auth.uid()` and accepts camelCase or snake_case payload keys:

```json
{
  "eventId": "event uuid",
  "occurrenceId": "optional occurrence uuid",
  "optionSelections": [
    { "optionId": "participation option uuid", "quantity": 1 }
  ],
  "seatsCount": 1,
  "guestNames": ["optional guest"],
  "comment": "optional comment"
}
```

The backend validates that the event is published and
`registration_mode = 'internal_paid'`. If the event has rows in
`event_occurrences`, `occurrenceId` is required and must point to an active
occurrence for that event. Selected participation options must belong to the
event, be active, and have `quantity > 0`.

`seats_count` is calculated from selected option quantities. Donation options
never reserve seats, even if their stored capacity flag is true. The RPC stores
option snapshots in `event_registration_option_selections` and sums
`total_amount` from the selected options.

Capacity is checked per occurrence when an occurrence is selected; otherwise it
uses event-level capacity. Pending and confirmed registrations consume capacity.
If capacity is available, `requires_approval = true` creates a `pending`
registration; otherwise the registration is `confirmed`. If capacity is full
and waitlist is enabled, the registration is `waitlisted`; if waitlist is not
enabled, the RPC raises `No seats available for this event`.

For the simulation, the registration is marked with
`payment_status = 'succeeded'` and `payment_id = 'simulated:<registration_id>'`.
The `payment_id` on `event_registrations` is text so web-admin and Excel export
can display the simulated marker directly. This value is not a row in
`payments`.

## Community Event Locations

`community_event_locations` is the DB-backed dictionary for web-admin event
location selection. It replaces manual typing in the event create/edit form
without removing the legacy `events.location_name` and `events.address`
columns.

Each row belongs to one `community_id` and stores `title`, `address`,
`is_default`, `is_active`, `sort_order`, and timestamps. At most one row per
community can be marked default. A dev/test fallback row is inserted for
communities that have no locations yet; it is deliberately labelled as a
placeholder and must be replaced by an admin in Settings.

The web-admin form reads locations through `admin_list_community_locations()`
using the normal authenticated Supabase client. On save, the selected location
is copied into the event payload as:

```text
locationName = community_event_locations.title
address = community_event_locations.address
```

Archived locations are not offered for new selections. If an existing event has
legacy `locationName` / `address` values that do not match an active dictionary
row, the UI shows a fallback option named "Текущее место из события" so the old
data is not lost before an admin chooses a new dictionary address.

## Capacity Model

Capacity currently spans three layers:

- `events.capacity` is the event-level fallback/default. For a single event it
  is the only total event capacity. For recurring parents it is the parent
  default used when a concrete occurrence does not set its own capacity.
- `event_occurrences.capacity` is the correct total limit for a concrete
  Shabbat, course session, holiday session, or other dated occurrence. If it is
  `null`, registration code should fall back to `events.capacity`.
- `event_participation_options` define price/type/quantity choices and may have
  option-level `seat_limit` values. These option limits are not a replacement
  for total occurrence capacity.
- Donation options do not consume seats. In the paid simulation RPC,
  `is_donation = true` forces selected option `seats_count = 0`, even if the
  option's stored capacity flag is true.

Current enforcement:

- `register_for_event(event_id, seats_count, comment)` is the legacy internal
  free registration RPC. It checks only `events.capacity`, stores no
  `occurrence_id`, and is not occurrence-aware.
- `register_for_paid_event_simulated(payload)` is occurrence-aware for
  `internal_paid`: when an event has occurrences, `occurrenceId` is required,
  and capacity is checked against `coalesce(event_occurrences.capacity,
  events.capacity)`.
- Admin registration UI reads `occurrence_id`, occurrence title/date, and
  selected participation option snapshots, but it does not create new
  capacity rules.
- Option-level `seat_limit` is stored and shown in admin constructors, but the
  current backend does not fully enforce aggregate per-option limits during
  registration.

Known limitation: recurring event capacity is only fully correct for the
existing `internal_paid` simulated registration path. `internal_free` recurring
registration still needs a follow-up RPC that accepts an occurrence and option
selections consistently. The next PR should normalize registration around a
concrete occurrence target and enforce occurrence total capacity plus
option-level limits without changing mobile behavior in this PR.

## Client Service

Use `src/services/adminEventsService.ts` for the React Native admin/event import
foundation. It calls `supabase.rpc(...)` with the normal app Supabase client
from `src/services/supabaseClient.ts` and normalizes RPC rows from snake_case to
camelCase app types in `src/types/events.ts`.

For web-admin, use `apps/admin/src/services/adminEventsService.ts`. The
registration service methods are:

```text
listRegistrationEvents()
listEventRegistrations(params)
updateRegistrationStatus(registrationId, nextStatus, reason?)
markRegistrationAttendance(registrationId, attendanceStatus)
```

The web-admin registration DTOs live in
`apps/admin/src/types/registrations.ts`: `AdminRegistrationEventSummary`,
`AdminEventRegistrationRow`, `AdminRegistrationStatus`, and
`AdminRegistrationOptionSelectionSummary`.

## Web Admin Registrations Screen

`apps/admin` exposes the working registrations screen through the existing
sidebar section "Registrations" / "Регистрации". The screen uses the normal
authenticated Supabase client session and does not use service-role keys,
Supabase Admin API, or direct database credentials.

The UI loads event counters with `listRegistrationEvents()`, filters the event
list client-side, and loads registrations with
`listEventRegistrations({ eventId, occurrenceId, status, search, limit,
offset })`. When a concrete occurrence/date is selected, the table is scoped to
that occurrence and renders each returned `event_registrations.id` as its own
row. Selected-date counters count registration rows, not unique users.
Registration rows show participant contacts, status, occurrence date/title,
seat count, selected participation options, payment status/amount, registration
time, and an actions menu.

The detail panel shows participant contact data, event/occurrence details,
selected options, guests, comment, payment metadata, timestamps, and action
buttons. Status changes call `updateRegistrationStatus(...)` for `pending`,
`confirmed`, `waitlisted`, `cancelled`, and `rejected`; attendance changes call
`markRegistrationAttendance(...)` for `attended` and `no_show`. Destructive
changes (`cancelled`, `rejected`, `no_show`) require confirmation in the UI.

## Web Admin Registrations Excel Export

`apps/admin` exports registrations as an Excel `.xlsx` workbook. CSV is
intentionally not used in web-admin.

The export button calls `admin_list_event_registrations` through
`listEventRegistrations(...)` with pagination: `limit` is `200`, `offset` starts
at `0`, and fetching continues while the RPC returns a full page. Current table
status/search filters are not applied.

If a concrete occurrence is selected in the registrations screen, Excel export
passes that `occurrenceId` to the RPC. The workbook's "Все регистрации" sheet
then contains only registration rows whose normalized `occurrence_id` is that
selected occurrence/date, and the workbook does not add per-occurrence sheets.
This is the default path for recurring/series events while the admin is working
inside one selected session.

If no occurrence is selected or the event does not use occurrences, export stays
event-level: the workbook contains all registration rows for the selected event.
The workbook always contains a sheet named "Все регистрации". In event-level
export, if returned rows include `occurrence_id` or `occurrence_starts_at`, the
workbook also includes safe Excel sheet names for each occurrence, capped to
Excel's 31-character sheet name limit. A future PR may add an explicit
"export all dates" action for series events. No backend storage, migrations, or
additional RPCs are required for the export.

## Registration Occurrence Diagnostics

Use these SQL checks when investigating mismatches between mobile
event-level registrations and web-admin selected-occurrence registrations.
They read only public event/profile/registration tables and do not require
Supabase Admin API access.

Find legacy rows without `occurrence_id` for events that already have
occurrences:

```sql
select
  r.id,
  r.event_id,
  e.title,
  e.starts_at as event_starts_at,
  r.occurrence_id,
  r.user_id,
  p.display_name,
  p.email,
  r.status,
  r.registered_at,
  r.created_at
from public.event_registrations r
join public.events e on e.id = r.event_id
left join public.profiles p on p.id = r.user_id
where r.occurrence_id is null
  and exists (
    select 1
    from public.event_occurrences eo
    where eo.event_id = r.event_id
  )
order by r.registered_at desc, r.created_at desc;
```

Compare all registration rows for Shabbat-like events by `event_id` and
`occurrence_id`:

```sql
select
  r.id,
  r.event_id,
  r.occurrence_id,
  eo.starts_at as occurrence_starts_at,
  e.starts_at as event_starts_at,
  p.display_name,
  p.email,
  r.status,
  r.seats_count,
  r.registered_at,
  r.created_at
from public.event_registrations r
join public.events e on e.id = r.event_id
left join public.event_occurrences eo on eo.id = r.occurrence_id
left join public.profiles p on p.id = r.user_id
where e.title ilike '%Шаб%'
order by p.display_name nulls last, r.registered_at desc;
```

Compare the known problematic/control people if those rows exist locally:

```sql
select
  p.display_name,
  p.email,
  r.id,
  r.event_id,
  e.title,
  r.occurrence_id,
  eo.starts_at as occurrence_starts_at,
  e.starts_at as event_starts_at,
  r.status,
  r.seats_count,
  r.payment_status,
  r.payment_id,
  r.registered_at,
  r.created_at,
  r.updated_at
from public.event_registrations r
join public.events e on e.id = r.event_id
left join public.event_occurrences eo on eo.id = r.occurrence_id
left join public.profiles p on p.id = r.user_id
where e.title ilike '%Шаб%'
  and (
    p.display_name ilike '%Давид%'
    or p.display_name ilike '%Лисус%'
    or p.display_name ilike '%Рувен%'
    or p.display_name ilike '%Колин%'
    or p.email ilike '%timafor%'
  )
order by p.display_name, r.registered_at desc, r.created_at desc;
```

Check selected participation options for the same event family:

```sql
select
  p.display_name,
  p.email,
  r.id as registration_id,
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
where e.title ilike '%Шаб%'
order by p.display_name, r.registered_at desc, os.created_at asc;
```

Compare rows mobile can show for a user/event with rows web-admin returns for
a selected occurrence:

```sql
with params as (
  select
    '<user uuid>'::uuid as user_id,
    '<event uuid>'::uuid as event_id,
    '<occurrence uuid>'::uuid as occurrence_id
),
mobile_visible as (
  select
    'mobile_event_rows' as source,
    r.id,
    r.event_id,
    r.occurrence_id,
    r.user_id,
    r.status,
    r.seats_count,
    r.registered_at,
    r.created_at
  from public.event_registrations r
  join params p
    on p.user_id = r.user_id
   and p.event_id = r.event_id
),
admin_visible as (
  select
    'admin_occurrence_rows' as source,
    r.id,
    r.event_id,
    r.occurrence_id,
    r.user_id,
    r.status,
    r.seats_count,
    r.registered_at,
    r.created_at
  from public.event_registrations r
  join params p
    on p.event_id = r.event_id
   and p.occurrence_id = r.occurrence_id
)
select *
from mobile_visible
union all
select *
from admin_visible
order by source, registered_at desc, created_at desc;
```

Preview which legacy rows the backfill can normalize and which rows stay
ambiguous:

```sql
with legacy_rows as (
  select
    r.id as registration_id,
    r.event_id,
    e.title,
    e.starts_at as event_starts_at,
    p.display_name,
    p.email,
    r.status,
    r.registered_at,
    r.created_at
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  left join public.profiles p on p.id = r.user_id
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
    eo.starts_at as occurrence_starts_at,
    case
      when oc.occurrence_count = 1 then 'single_occurrence'
      when eo.starts_at = lr.event_starts_at then 'event_starts_at'
      else null
    end as match_reason
  from legacy_rows lr
  join occurrence_counts oc on oc.event_id = lr.event_id
  join public.event_occurrences eo on eo.event_id = lr.event_id
  where oc.occurrence_count = 1
    or eo.starts_at = lr.event_starts_at
),
summary as (
  select
    lr.registration_id,
    count(distinct c.occurrence_id)::integer as candidate_occurrence_count,
    (
      array_agg(distinct c.occurrence_id)
        filter (where c.occurrence_id is not null)
    )[1] as matched_occurrence_id,
    min(c.occurrence_starts_at) as matched_occurrence_starts_at
  from legacy_rows lr
  left join candidates c on c.registration_id = lr.registration_id
  group by lr.registration_id
)
select
  lr.*,
  case
    when s.candidate_occurrence_count = 1 then s.matched_occurrence_id
    else null
  end as safe_occurrence_id,
  case
    when s.candidate_occurrence_count = 1 then s.matched_occurrence_starts_at
    else null
  end as safe_occurrence_starts_at,
  s.candidate_occurrence_count,
  s.candidate_occurrence_count <> 1 as stays_ambiguous
from legacy_rows lr
join summary s on s.registration_id = lr.registration_id
order by stays_ambiguous desc, lr.registered_at desc, lr.created_at desc;
```

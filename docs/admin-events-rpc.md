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

Registration rows include the registration id, event and occurrence ids,
participant profile display name, email, phone, status, seat count, guest names,
comment, payment status/id, registration timestamps, occurrence
starts/ends/title, selected participation options as a JSONB array, and
`total_amount` when it can be summed from option selections.

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
list client-side, and loads the selected event's registrations with
`listEventRegistrations({ eventId, status, search, limit, offset })`.
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

`apps/admin` exports registrations for the currently selected event as an Excel
`.xlsx` workbook. CSV is intentionally not used in web-admin.

The export button calls `admin_list_event_registrations` through
`listEventRegistrations(...)` with pagination: `limit` is `200`, `offset` starts
at `0`, and fetching continues while the RPC returns a full page. Current table
status/search filters are not applied, so the workbook contains all
registrations for the selected event.

The workbook always contains a sheet named "Все регистрации". If returned rows
include `occurrence_id` or `occurrence_starts_at`, the workbook also includes
safe Excel sheet names for each occurrence, capped to Excel's 31-character sheet
name limit. No backend storage, migrations, or additional RPCs are required for
the export.

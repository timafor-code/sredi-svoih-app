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

Every successful admin update stores `manual_override = true`. This matches the
website importer protection: later imports skip events marked as manual
overrides, so an admin edit cannot be overwritten by the importer. Passing
`manualOverride: false` is rejected.

Example:

```json
{
  "title": "Updated lecture title",
  "startsAt": "2026-05-12T19:00:00+03:00",
  "endsAt": "2026-05-12T21:00:00+03:00",
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

## Client Service

Use `src/services/adminEventsService.ts`. It calls `supabase.rpc(...)` with the
normal app Supabase client from `src/services/supabaseClient.ts` and normalizes
RPC rows from snake_case to camelCase app types in `src/types/adminEvent.ts`.

The web-admin edit UI and any dedicated `apps/admin` update service wiring can
be connected in the next UI PR by calling `admin_update_event` with the normal
authenticated Supabase client session.

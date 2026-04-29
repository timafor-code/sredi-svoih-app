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
- `admin_publish_import_item(import_item_id uuid, payload jsonb)` creates or
  updates/links an event from a reviewed import item with
  `source_type = 'website_scrape'` and `manual_override = true`.
- `admin_ignore_import_item(import_item_id uuid, reason text default null)`
  marks an import item as ignored and stores ignore metadata under
  `raw_payload.adminReview`.

Execute grants are limited to authenticated users. Guest and regular member
accounts should receive permission errors or empty review lists because they do
not have the required community role.

## Client Service

Use `src/services/adminEventsService.ts`. It calls `supabase.rpc(...)` with the
normal app Supabase client from `src/services/supabaseClient.ts` and normalizes
RPC rows from snake_case to camelCase app types in `src/types/adminEvent.ts`.

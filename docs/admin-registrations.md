# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

The admin registrations workspace uses the regular authenticated Supabase client. Admin reads and writes stay behind RPC/RLS policies; the browser code must not use privileged server keys, Supabase Admin API, server-only database connection strings, or direct access to `auth.users`.

## Current architecture

- `RegistrationsPage.tsx` owns page state, loading, filtering, pagination, Excel export, toasts, occurrence selection, and registration status actions.
- `apps/admin/src/components/registrations/RegistrationEventsPanel.tsx` renders the events list and event search.
- `RegistrationCapacityBucketsOverview.tsx` renders capacity totals, option stats, and capacity bucket rows from `admin_get_registration_capacity_analytics`.
- `RegistrationsTable.tsx` renders the registrations table. A row click opens the participant detail modal; row action buttons keep their own click handling.
- `RegistrationDetailPanel.tsx` renders participant profile, contacts, event/session data, selected options, guests/comment, payment data, history, and status controls. It is now used inside the modal instead of a permanent right-side panel.

## v15 reference

The UX reference prototype is committed at:

`docs/prototype/registrations-improved-seating-v15.html`

This file is a reference document only. Production code should not copy the prototype's full HTML, CSS, JavaScript, seating editor, drag-and-drop, table templates, persistence, or mock data.

## This PR

- Adds `admin_get_registration_capacity_analytics(p_event_id uuid, p_occurrence_id uuid default null)` as the server-side source of truth for the "Места и регистрации" capacity overview.
- Migrates the admin capacity service away from client-side bucket analytics. `listAdminRegistrationCapacityBuckets` is now a compatibility wrapper around the analytics RPC.
- Keeps the v15 layout shell, registration detail modal, seating placeholder button, export, refresh, pagination, and status actions unchanged.
- Keeps seating editor/backend work out of production scope.

## Capacity analytics RPC

`admin_get_registration_capacity_analytics` is called from the regular authenticated Supabase client. It is a `security definer` RPC guarded by the event's `admin` / `event_manager` community role checks; browser code must not use service-role credentials or Supabase Admin API for this data.

The RPC returns one row:

- `event_id`
- `occurrence_id`
- `totals`
- `bucket_aggregate`
- `buckets`
- `option_stats`
- `donation_options`

`totals` includes:

- total registrations in the requested event/occurrence scope;
- status counts for `confirmed`, `pending`, `waitlisted`, `cancelled`, `rejected`, `attended`, and `no_show`;
- active registration and active seat counts using the existing capacity-occupied status set: `confirmed`, `pending`, `attended`, `no_show`;
- best-effort unique registered users, unique guest names, and unique people counts;
- multi-meal guest count based on active registrations that reserve more than one capacity unit;
- sponsor/donation counts and quantities;
- legacy scope capacity, remaining/free seats, and fill/free percentages.

`buckets` includes one entry per `event_capacity_units` row:

- `capacityUnitId`, `key` / `code`, and `title`;
- raw capacity unit `capacity` without changing `event_capacity_units.capacity` semantics;
- effective capacity fields based on the current event/occurrence fallback capacity;
- occupied seats from `event_registration_capacity_reservations`;
- remaining/free seats, fill/free percentages, reservation count, option titles, and option breakdown.

Seat occupancy for mapped capacity units comes from `event_registration_capacity_reservations`. This preserves the current registration flow behavior where one registration can create multiple seat obligations, for example a package option reserving both `friday_dinner` and `shabbat_lunch`.

Donation options and options with `counts_toward_capacity = false` do not occupy seats and do not create capacity reservations. They are returned in `option_stats` and `donation_options` with `isDonation` / `countsTowardCapacity` markers so the UI can display them without counting them as occupied capacity.

The detailed v15 capacity card UI is intentionally deferred to PR 4: `feature/admin-registrations-capacity-v15-ui`.

## Next seating work

The seating editor, seating data types, backend/RPC/RLS changes, canvas, drag-and-drop, table templates, and save flow should be implemented in separate follow-up PRs.

# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

The registrations workspace uses the regular authenticated Supabase client.
Admin reads/writes stay behind RPC/RLS policies; browser code must not use
privileged server keys, Supabase Admin API access, server-only database
connection strings, or direct access to `auth.users`.

## Status

Registrations v15 is implemented for the admin workflow and now includes Phase
3 / PR 24 beta UX polish:

- event list/search and selected event workspace;
- clearer loading, empty, and error states for beta admins;
- explicit selected event/occurrence context;
- occurrence selector with active/past date wording;
- compact/collapsible capacity card;
- capacity analytics from `admin_get_registration_capacity_analytics`;
- bucket breakdown with list and donut/chart modes;
- registrations table with row click/keyboard access and participant detail
  modal;
- status and attendance actions;
- Excel export from the registrations table header;
- seating editor opened from capacity buckets.

The seating editor is an implemented part of the registrations workspace. Details
are documented in `docs/admin-seating.md`.

## Architecture

- `RegistrationsPage.tsx` owns selected event/occurrence state, data loading,
  filters, pagination, toasts, status actions, Excel export, and seating modal
  state.
- `RegistrationEventsPanel.tsx` renders the event list and event search.
- `RegistrationCapacityBucketsOverview.tsx` renders capacity totals, capacity
  modes, bucket rows, bucket breakdown, donation/non-seat markers, and the
  seating entry point.
- `RegistrationsTable.tsx` renders the registration table. Row activation opens
  the detail modal.
- `RegistrationDetailPanel.tsx` renders participant profile, contacts,
  event/session data, selected options, guests/comment, payment data, history,
  and status controls.
- `SeatingLayoutEditor.tsx` handles bucket-specific seating layouts, templates,
  auto seating, manual drag/drop, reserves, capacity summary, and capacity sync.

## Beta UX Context

The page should make the current scope obvious before showing operational data:

- no mock/fake data is displayed for empty states;
- if no events are available, the left panel and main workspace explain that
  there are no events with accessible registrations for the current admin
  context;
- if no event is selected, the main workspace asks the admin to select an event;
- if the selected event has occurrences, the table, capacity card, and Excel
  export are scoped to the selected occurrence;
- if an event has occurrences but no occurrence is selected, the page must not
  imply that all registrations for the series are being shown;
- if only past occurrences exist, the admin is guided to enable the date archive;
- real load errors stay visible and include the underlying error message.

## Table Filters And Search

The registrations table filters server results by the selected event/occurrence
context, status filter, search string, page size, and offset. Search/filters do
not change the selected event or occurrence.

Empty table states distinguish between:

- no registrations for the selected event;
- no registrations for the selected occurrence;
- no matches for the current status filter or search;
- registration load failure for the current context.

## Excel Export

`apps/admin/src/services/registrationExcelExport.ts` builds the workbook from
the same registration service data the page already uses. This PR does not
change the export service or Excel schema.

The export action respects the current selected context:

- event without occurrences: export the currently selected event;
- event with occurrences: export the selected occurrence only;
- event with occurrences and no selected occurrence: export should remain
  unavailable until a concrete date/session is selected.

The workbook keeps the existing operational columns:

- event and occurrence;
- participant name, email, and phone;
- registration status and payment status;
- selected participation options;
- occupied capacity seats;
- capacity/session obligations;
- guests and comments;
- donation details;
- amount/currency;
- registration/confirmation/cancellation timestamps;
- multi-meal marker.

Seat-by-seat seating assignment export is not implemented in this scope.

## Capacity Analytics RPC

`admin_get_registration_capacity_analytics` is the source of truth for the
capacity card. Client code should not rebuild bucket occupancy from registration
rows when the analytics payload already contains bucket data.

The RPC returns one analytics row for the selected event/occurrence scope:

- `event_id`;
- `occurrence_id`;
- `totals`;
- `bucket_aggregate`;
- `buckets`;
- `option_stats`;
- `donation_options`.

Mapped capacity units use `event_registration_capacity_reservations` as the
primary occupancy source. For legacy/test rows without reservation rows, the RPC
adds a read-only fallback from option-to-capacity-unit mappings. That fallback
does not insert reservations, change registration state, or change
`event_capacity_units.capacity`.

## Capacity Limit Vs Physical Seats

`event_capacity_units.capacity` is the registration limit for a capacity
unit/bucket. It is not automatically the number of physical chairs in a seating
layout.

The seating layout helps admins manually seat guests for the selected bucket. It
does not become the automatic source of capacity truth, and changing a capacity
limit must not change the seating algorithm.

## Donations

Donation options and options with `counts_toward_capacity = false` do not occupy
seats. A donation registration does not create a seating guest by itself and
must not enter the seating guest pool as a physical place.

A donation-only registration therefore exports as zero occupied seats with no
multi-meal marker.

## Seating Integration

The capacity bucket row opens `SeatingLayoutEditor` for the concrete selected
slot: `(event_id, occurrence_id, capacity_unit_id)`.

The seating flow keeps the registration capacity invariant from
`docs/admin-seating.md`: table geometry does not automatically change
`event_capacity_units.capacity`.

## Manual Smoke Checklist

Not run by Codex. Manual smoke is performed by the project owner.

1. Open Registrations page as admin.
2. Confirm events list loading/empty/error states are readable.
3. Select event without occurrences and confirm registrations context is clear.
4. Select event with occurrences and confirm selected occurrence context is clear.
5. Confirm "no active dates" state explains archived/past occurrences.
6. Confirm registrations empty state explains filters/search.
7. Confirm Excel export note says export is scoped to selected event/occurrence.
8. Confirm capacity hint says registration capacity limit is not necessarily
   physical seats.
9. Confirm donation hint says donations do not occupy seats.
10. Open seating editor for a slot with empty guest pool.
11. Confirm empty guest pool warning is readable and does not auto-create guests.
12. Confirm status/attendance actions still work as before.
13. Confirm no RPC/schema/seating algorithm/Excel schema changes were made.
14. Confirm no browser smoke was run by Codex.

## Out Of Scope

- RPC changes;
- Supabase schema or migrations;
- Excel schema changes;
- seating algorithm changes;
- auto-seat/manual-seat behavior changes;
- capacity reservation business logic changes;
- donation business logic changes;
- registration status transition or attendance logic changes.

## Next PR

`feature/admin-feedback-review-list`

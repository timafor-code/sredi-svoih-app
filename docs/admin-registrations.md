# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

Final state for registrations v15 after PRs #192-#198 and the follow-up seating
series through PR #213. The page uses the regular authenticated Supabase client.
Admin reads/writes stay behind RPC/RLS policies; browser code must not use
privileged server keys, Supabase Admin API access, server-only database
connection strings, or direct access to `auth.users`.

## Status

Registrations v15 is implemented for the admin workflow:

- event list/search and selected event workspace;
- occurrence selector;
- compact/collapsible capacity card;
- capacity analytics from `admin_get_registration_capacity_analytics`;
- bucket breakdown with list and donut/chart modes;
- registrations table with row click/keyboard access and participant detail
  modal;
- status and attendance actions;
- Excel export from the registrations table header;
- seating editor opened from capacity buckets.

The seating editor is now an implemented part of the registrations workspace,
not future work or a placeholder. Details are documented in
`docs/admin-seating.md`.

## Architecture

- `RegistrationsPage.tsx` owns selected event/occurrence state, data loading,
  filters, pagination, toasts, status actions, Excel export, and seating modal
  state.
- `RegistrationEventsPanel.tsx` renders the event list and event search.
- `RegistrationCapacityBucketsOverview.tsx` renders capacity totals, capacity
  modes, bucket rows, bucket breakdown, and the seating entry point.
- `RegistrationsTable.tsx` renders the registration table. Header actions include
  refresh/export; row activation opens the detail modal.
- `RegistrationDetailPanel.tsx` renders participant profile, contacts,
  event/session data, selected options, guests/comment, payment data, history,
  and status controls.
- `SeatingLayoutEditor.tsx` handles bucket-specific seating layouts, templates,
  auto seating, manual drag/drop, reserves, capacity summary, and capacity sync.

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

`totals` includes registration status counts, active registration/seat counts,
unique registered users, unique guest/person counts, multi-meal guests,
sponsor/donation counts, legacy capacity values, remaining/free seats, and
fill/free percentages.

`buckets` includes one row per `event_capacity_units` entry:

- `capacityUnitId`, `key`/`code`, and title;
- raw `event_capacity_units.capacity`;
- effective capacity values for the selected scope;
- occupied seats;
- remaining/free seats;
- fill/free percentages;
- reservation/obligation count;
- option titles and `optionBreakdown`.

Mapped capacity units use `event_registration_capacity_reservations` as the
primary occupancy source. For legacy/test rows without reservation rows, the RPC
adds a read-only fallback from option-to-capacity-unit mappings. That fallback
does not insert reservations, change registration state, or change
`event_capacity_units.capacity`.

Donation options and options with `counts_toward_capacity = false` do not occupy
seats. They are returned for display with donation/non-seat markers.

## Capacity Card Modes

The capacity card starts compact and can expand into detailed modes:

- by capacity slots: one row per bucket with occupied/capacity, remaining seats,
  fill percentage, reservation count, breakdown, and seating editor action;
- all seats for selected date: aggregate occupied/capacity/free/fill values;
- by participation options: seat-taking option rows aggregated from
  `buckets[].optionBreakdown`, plus donation/non-seat rows from `option_stats`
  and `donation_options`;
- unique guests: unique people/guest metrics, multi-meal guests, sponsors,
  donations, and occupied-seat totals.

Null/unlimited capacity renders as no limit and must not produce `NaN`,
negative-only noise, or a fake zero-capacity state.

## Bucket Breakdown

Bucket breakdown is driven by the analytics payload.

The default view is the donut/chart breakdown after PR #213, with a list view
available through the local toggle. The chart uses CSS `conic-gradient` and does
not add Chart.js, CDN scripts, or a new npm dependency.

Each breakdown uses `optionBreakdown` rows for:

- option title;
- registration count;
- quantity count;
- occupied seat count;
- contribution percentage inside the bucket;
- donation/non-seat marker when relevant.

The UI also shows a free-seat row when remaining seats are known. If a bucket has
occupied seats but no option detail, the UI keeps the bucket total visible and
shows a safe fallback row instead of reconstructing source-of-truth client-side.

## Excel Export

`apps/admin/src/services/registrationExcelExport.ts` builds the workbook from
the same `listEventRegistrations` data the page already loads. It does not need
a separate migration or a seating RPC call.

After PR #213, the export action lives in the registrations table header, not in
the page-level main action cluster. It respects the selected occurrence scope
when one is selected, or exports all event registrations otherwise.

The workbook includes the existing operational columns:

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

Donation and non-capacity options stay out of occupied-seat totals and
capacity/session obligations. A donation-only registration therefore exports as
zero occupied seats with no multi-meal marker.

Seat-by-seat seating assignment export is not implemented in this scope. The
current Excel export reports registration and capacity obligations, not final
table/chair placements.

## Seating Integration

The capacity bucket row opens `SeatingLayoutEditor` for the concrete selected
slot: `(event_id, occurrence_id, capacity_unit_id)`.

Implemented seating integration:

- load/save bucket layout instances;
- built-in and saved templates;
- real guest pool from the selected bucket;
- deterministic auto seating;
- manual drag/drop;
- reserves;
- edit-preserve reconcile;
- capacity summary;
- explicit capacity sync confirmation.

The seating flow keeps the registration capacity invariant from
`docs/admin-seating.md`: table geometry does not automatically change
`event_capacity_units.capacity`.

## Manual Smoke Checklist

Not run by Codex. Manual smoke is performed by the project owner.

1. Open web-admin -> Registrations.
2. Select an event.
3. Select an occurrence.
4. Check the capacity card.
5. Switch capacity card modes.
6. Check bucket breakdown donut/list views.
7. Click Excel export from the registrations table header.
8. Open the seating modal for a capacity bucket.
9. Create and edit tables.
10. Verify the rabbi table.
11. Save the layout.
12. Save as template.
13. Apply the template to another slot.
14. Run auto seating.
15. Manually drag a guest.
16. Add a reserve.
17. Change geometry and verify the reconcile warning.
18. Check the capacity summary.
19. Check the capacity sync confirmation.
20. Confirm the registration limit does not change without explicit action.

## Out of Scope / Next PR

- seat-by-seat seating assignment export;
- print/PDF seating chart;
- family/group seating;
- mobile seating;
- payment gateway;
- advanced conflict/audit reports.

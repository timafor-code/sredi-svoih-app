# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

The registrations workspace uses the authenticated Python API. Admin
reads/writes remain community-scoped; browser code must not use privileged
server keys, Supabase Admin API access, server-only database connection strings,
or direct access to `auth.users`.

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
- canonical registration-source badges for mobile, public web, and admin-created
  registrations, plus a server-side source filter;
- dynamic capacity-unit tabs with server-side registration classification;
- status and attendance actions;
- Excel export from the registrations table header;
- seating editor opened from capacity buckets.

The seating editor is an implemented part of the registrations workspace. Details
are documented in `docs/admin-seating.md`.

## Architecture

- `RegistrationsPage.tsx` owns selected event/occurrence state, data loading,
  search/source filters, pagination, toasts, status actions, Excel export, and
  seating modal state. It renders the web-registration operations panel only
  when `useAdminAuth()` reports `isAdmin === true`.
- `WebRegistrationOperationsPanel.tsx` owns the aggregate admin-only summary
  and coordinates refreshes with the conflict queue.
- `IdentityConflictsPanel.tsx` owns the paged open/resolved conflict queue and
  its status-only confirmation flow.
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

The registrations table requests server results by the selected
event/occurrence context, capacity unit, search string, registration source,
page size, and offset. Registration source is the canonical API value `mobile`,
`public_web`, or `admin`; it is never inferred from profile, contact, or
registration data.
The visible source badges are `Mobile`, `Web`, and `Admin`, with the full Russian
source name available in the table and registration details.

Source filtering is performed by FastAPI through the `source_channel` query
parameter, not by filtering one already loaded page in the browser. Capacity
unit filtering is performed through the optional `capacity_unit_id=<uuid>`
query parameter on `GET /admin/events/{event_id}/registrations`. Omitting it
keeps the unfiltered `Общее` view. The API validates that the unit belongs to
the manageable event before applying search, source, status, occurrence, limit,
and offset filters.

A registration qualifies for a capacity-unit tab through its persisted
`event_registration_capacity_reservations` row or, when the matching persisted
row is absent, through a non-donation, capacity-counting selected option mapped
by `event_participation_option_capacity_units`. The fallback is read-only. A
multi-unit option can therefore place the same registration in multiple tabs,
while donation and non-capacity options do not qualify it. Status does not
change this classification.

Search, source, and capacity-unit filters can be combined with occurrence
selection. Changing the source or capacity-unit filter resets pagination and
closes selected-registration details. Event changes reset the capacity-unit tab
to `Общее`; occurrence changes preserve it only while the unit remains valid.

Empty table states distinguish between:

- no registrations for the selected event;
- no registrations for the selected occurrence;
- no matches for the current search or source filter;
- registration load failure for the current context.

Mobile and public-web registrations remain records in the same canonical
`event_registrations` table. Source visibility/filtering does not affect
capacity, status transitions, attendance, payment state, seating, selected
options, or notification behavior.

## Excel Export

`apps/admin/src/services/registrationExcelExport.ts` builds the workbook from
the same registration service data the page already uses. The Excel schema is
unchanged.

The export action respects the current selected context:

- event without occurrences: export the currently selected event;
- event with occurrences: export the selected occurrence only;
- event with occurrences and no selected occurrence: export should remain
  unavailable until a concrete date/session is selected.
- selected capacity-unit tab: export only registrations in that unit, combined
  with the selected occurrence context;
- `Общее`: preserve the existing event/occurrence export behavior.

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

## Admin-Only Web-Registration Operations

The Registrations page includes an operations panel between the page header
and the existing event/registration workspace for active admins only.
`event_manager` users do not render the panel and therefore do not call its
admin-only endpoints. Their existing registration list, source filtering,
status, attendance, capacity, seating, and Excel workflows are unchanged.

The summary displays only four aggregate counts: active email-verification
intents, open identity conflicts, open privacy requests, and overdue privacy
requests. Active intents have `email_verification_required` status and a future
expiry; expired and confirmed intents are excluded. Zero is displayed as zero,
without invented trends or comparisons. The privacy due-date list below the
conflict queue provides the read-only detail behind the privacy counts.

The conflict queue requests 20 rows at a time with an explicit `open` or
`resolved` filter and an offset. It exposes only allowlisted technical metadata:
conflict/intent lifecycle state, event and optional occurrence ids, masked
technical user ids, and timestamps. It does not display names, contact data,
submitted answers/comments, verification material, flow credentials, or
request/idempotency fingerprints. Unsupported conflict categories or statuses
fail as a controlled client error instead of being relabelled.

Resolve and reopen actions change only the conflict's operational status after
the API confirms the mutation. Resolving does not merge users, and neither
action edits profiles, login email/phone, intents, or registrations. The queue
and summary are refreshed after success while preserving the selected filter;
if the current page becomes empty, pagination returns to the previous page.
Automatic identity merge remains prohibited.

The compact privacy due-date list uses the authenticated
`GET /admin/privacy/requests` endpoint and normalizes only request id, request
type, status, creation time, and `due_at`. The default `Все` filter omits
`overdue_only`; `Просроченные` reloads through FastAPI with
`overdue_only=true`. The API-provided `due_at` is authoritative: the browser
does not calculate a legal deadline from the creation time. A non-terminal
request with a non-null past deadline is marked `Просрочено`; resolved,
rejected, and closed requests are terminal, and a null deadline is shown as
`Срок не установлен`.

This admin-only list is visibility, not privacy-request management. It is
read-only, shows shortened technical request ids, and does not display request
contents, resolution notes, names, email addresses, phone numbers, user ids,
or lifecycle execution fields. It offers no status changes, erasure, restore
replay, or other privacy execution action. `event_manager` users neither render
the panel nor call the endpoint. The panel does not join or call profile,
event-participation, or prayer data; the prayer tracker remains private.

Together, canonical registration source/status, the conflict queue, and this
privacy due-date list complete the web-registration PR 10 admin operations
scope.

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
- general privacy-request management or lifecycle execution UI;
- user/profile/login-identity editing or merging.

## Next PR

`feature/web-event-questionnaires-basic`

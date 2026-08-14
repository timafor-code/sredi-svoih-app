# Admin seating

The seating editor is available from the web-admin registrations capacity bucket
UI. This document describes the implemented seating flow, including party-aware
automatic placement and the manual administrator override for protected
rabbi-table seats.

The seating service uses the shared browser-safe admin `apiClient` and the
Python `/admin/seating/*` endpoints. The canvas, geometry model, editor UX,
template flow, assignments, and print model keep the same frontend service
contract.

It requires no privileged server keys, Supabase Admin API access, direct
database access from `apps/admin`, or direct access to `auth.users`.

## Status

The seating feature is implemented end to end for admin/event-manager use from
the registrations capacity bucket UI:

- schema, RLS, read RPCs, and write RPCs;
- typed TypeScript service layer;
- pure geometry layer for tables, seats, seams, rabbi seats, and spread indexes;
- modal layout editor with table creation, movement, rotation, side-seat
  controls, zoom/fit, loading/error states, and keyboard shortcuts;
- built-in and user template library;
- real guest pool for the selected capacity bucket;
- deterministic party-aware auto seating;
- manual drag/drop seating;
- operational reserves;
- edit-preserve reconcile when geometry changes after seating;
- display capacity summary;
- explicit capacity sync action with confirmation;
- empty guest-pool warning for beta admins;
- print-ready A4 landscape seating document from the current completed seating;
- responsive modal polish for smaller admin viewports.

## Manual Tool Boundary

The seating editor remains a manual operational tool. It helps admins build a
physical layout and place guests for one selected slot:
`(event_id, occurrence_id, capacity_unit_id)`.

Manual drag/drop is an explicit administrator operation and may place any
registered participant or guest on a rabbi-table seat. This does not change the
automatic seating algorithm: rabbi seats remain protected from ordinary auto
placement. Capacity reservation logic, donation logic, backend RPCs, and schema
are unchanged. The editor must not auto-create guests, auto-seat empty pools, or
infer missing registrations.

## Backend Architecture

The persisted seating model is split into reusable geometry templates and
concrete layout instances.

Tables:

| Table | Purpose |
| --- | --- |
| `event_seating_layout_templates` | Community-scoped reusable geometry snapshots. |
| `event_seating_layouts` | One layout instance for one `(event_id, occurrence_id, capacity_unit_id)` slot. |
| `event_seating_tables` | Tables in a layout instance. |
| `event_seating_table_connections` | Seams/connections between tables in a layout instance. |
| `event_seating_assignments` | Guest and reserve placements for a layout instance. |

RLS is enabled on all seating tables. Template/layout rows carry
`community_id`; child rows are authorized through their parent layout. Access is
limited to admins and event managers through the same community-role pattern as
the registration capacity tables. Browser code does not get direct table write
access.

Read RPCs:

| Function | Purpose |
| --- | --- |
| `admin_list_seating_templates()` | Lists active templates available to the caller's managed communities. |
| `admin_get_seating_template(p_template_id uuid)` | Reads one template after role and community checks. |
| `admin_get_seating_layout(p_event_id uuid, p_occurrence_id uuid, p_capacity_unit_id uuid)` | Reads one slot layout with tables, connections, and assignments. Returns an empty layout envelope when no instance exists yet. |

Write RPCs:

| Function | Purpose |
| --- | --- |
| `admin_save_seating_layout(payload jsonb)` | Upserts the slot layout and replaces geometry tables/connections. Assignments are not changed. |
| `admin_save_seating_assignments(payload jsonb)` | Replaces guest/reserve assignments for an existing layout. |
| `admin_create_seating_template_from_layout(p_layout_id uuid, p_title text)` | Saves geometry from a layout as a reusable template. |
| `admin_delete_seating_template(p_template_id uuid)` | Soft-deletes a user template. Built-ins are protected. |
| `admin_create_seating_layout_from_template(p_event_id uuid, p_occurrence_id uuid, p_capacity_unit_id uuid, p_template_id uuid)` | Forks template geometry into a fresh slot layout instance. |
| `admin_update_capacity_unit_limit(capacity_unit_id uuid, new_capacity integer)` | Explicitly changes the registration limit after confirmation. This is the only seating-related capacity update path. |

## Service And Geometry Layers

`apps/admin/src/services/adminSeatingService.ts` is the typed provider facade
used by the seating UI. In Supabase mode it calls the read/write seating RPCs.
In API mode it delegates to `adminSeatingApiService.ts`, which calls the Python
admin seating endpoints through `apiClient`. Both paths normalize snake_case
rows into camelCase frontend models and serialize the v15 payload contract on
writes.

API mode keeps these existing v15 payload keys unchanged: `eventId`,
`occurrenceId`, `capacityUnitId`, `layout`, `customTables`, `tableConnections`,
`selectedTableId`, `seatingDone`, `activeTemplateId`, `reserveIds`, `capacity`,
`chairs`, and `pool`.

`apps/admin/src/lib/seatingGeometry.ts` is pure and has no IO. Related pure
helpers handle deterministic auto assignment, drag/drop moves, assignment
reconcile, and display-only capacity math.

## Capacity Limit Vs Physical Seats

This invariant must stay true across seating work:

- `capacity_unit.capacity` / `event_capacity_units.capacity` is the business
  limit for public registration.
- `physicalSeatCount` is the number of physical chairs produced by the current
  seating geometry.
- `Занято` is the number of actual guests currently seated on physical chairs.
- `Свободно по лимиту` is registration capacity remaining and continues to use
  the capacity bucket occupancy rather than current canvas occupants.
- `Физически свободно` is the physical chair count minus all current guest and
  reserve occupants.
- A manual reserve consumes a physical chair but is not a person in `Занято`.
- Hidden preserved assignments during table editing are restoration state, not
  current seating occupancy.
- A placed manual reserve is already a physical occupant and is deducted from
  `freePhysical` exactly once. Rabbi reserve remains a separate informational
  reservation metric; an empty rabbi-reserved chair is still physically free.
- Changing table geometry never automatically changes the registration limit.
- Limit 70 / physical seats 80 is valid: the extra 10 physical seats are an
  operational reserve buffer.
- Limit 70 / physical seats 60 is an operational problem: the UI should surface
  that there are not enough physical seats for the configured registration
  limit/occupied demand.
- Raising or lowering the registration limit is allowed only through the
  explicit capacity sync action and confirmation dialog.

The capacity summary is display math. It does not write anything. Capacity sync
calls `admin_update_capacity_unit_limit` only after admin confirmation and does
not change layouts, assignments, registrations, payments, or donations.

## Guest Pool

The guest pool is built for the selected capacity bucket from confirmed/active
seat-taking registrations and their guests. In the current service this means
registrations in seating-active statuses (`confirmed`, `pending`, `attended`)
whose capacity obligations map to the selected bucket.

The guest pool may be empty. The UI should make the likely causes readable:

- there are no confirmed/active registrations for the selected slot;
- the admin selected the wrong event, occurrence, or capacity bucket;
- donation-only registrations do not occupy seats;
- the capacity slot currently contains no guests for the seating pool.

An empty pool warning is informational. It must not create guests, change
registrations, auto-seat, or change the seating algorithm.

The right-column metrics are intentionally compact so the inline `Не
рассажены` pool can grow through the remaining desktop sidebar height while
keeping its own scroll. The display omits `Свободно по лимиту`; the underlying
`freeByLimit` calculation and all capacity semantics remain unchanged.

The inline `Не рассажены` pool contains only registration guests who currently
have no seat. `Весь список` instead shows the complete loaded registration guest
roster for the selected slot, so the same roster remains visible before, during,
and after seating. It uses the existing loaded `guestPool` without a second API
request. Registration guests are grouped by their existing `registrationId`,
with participant and guest rows, party-level option/status/payment metadata,
named guests where available, and readable fallback guest labels. Operational
reserves appear in a separate section and remain unrelated to registrations.

Assignment behavior:

- auto seating groups active seat-taking rows only by their existing
  `registrationId`; participant rows are placed before guests, with guests ordered
  by `guestIndex` and then stable guest key;
- a complete party first uses one fitting table, preferring the smallest excess
  eligible capacity and a compact deterministic seat subset;
- when one table cannot fit a party, directly connected tables are preferred,
  followed by the minimum practical number of eligible tables; physical
  shortages still return every unresolved person to the unassigned pool;
- ordinary auto seating excludes rabbi-table seats;
- manual drag/drop supports pool-to-seat, seat-to-seat, occupied-seat swap, and
  seat-to-pool;
- manual drag/drop may place or swap ordinary participants and registration
  guests onto rabbi-table seats as an explicit administrator override;
- manually placed guests are saved as manual/locked assignments;
- repeat auto seating preserves manual/locked assignments and placed reserves,
  then prefers eligible seats on the locked party member's table and connected
  tables without moving the lock;
- a manually locked ordinary guest may remain on a rabbi seat, but the rest of
  that party cannot automatically consume other protected rabbi seats;
- assignments are saved through `saveSeatingAssignments()` /
  `admin_save_seating_assignments`;
- reopening a layout restores saved assignments from the backend.

## Donations

Donation-only and non-seat options do not enter the guest pool. A donation
registration does not consume a registration seat, does not create a seating
guest by itself, and must not be treated as a physical place.

## Templates Vs Instances

These concepts are intentionally separate.

- A template is reusable geometry only. It contains canvas/table/connection data
  and is community-scoped, not tied to a specific event slot.
- A layout instance is the concrete seating plan for one `event_id`,
  `occurrence_id`, and `capacity_unit_id`.
- Save-as-template copies only geometry from the current layout instance.
- Apply-template forks a copy of template geometry into the target layout
  instance.
- Assignments, guests, reserves, registration ids, occupancy, and capacity
  limits are never copied into a template.
- Deleting a template is a soft delete (`is_active = false`). Built-in templates
  are protected and cannot be deleted.

After a template is applied, later edits affect only the current layout
instance. There is no live binding back to the template.

## Rabbi Table And Reserves

Every valid layout has exactly one rabbi table. Its head seat is visually marked
with a star, and ordinary auto seating does not place guests at the rabbi table.
Administrators may nevertheless place any participant, registration guest, or
operational reserve there through manual drag/drop, including occupied-seat
displacement and swaps. Those placements remain manual/locked and survive
reopen and repeat auto seating. Explicit rabbi guest and rabbi-head automatic
behavior are unchanged.

Reserves are operational placeholders for physical chairs:

- a reserve occupies one physical seat when placed;
- a reserve does not create an `event_registration`;
- a reserve does not increase occupied registration seats;
- a reserve does not change `event_capacity_units.capacity`;
- auto seating never seats reserve pool items; reserves are added and placed
  manually.

## Edit-Preserve Reconcile

When admins edit tables after seating has already been done, the editor preserves
the current assignments while geometry is being changed. Returning to seating or
running auto seating reconciles those preserved assignments against the new
physical seats.

Reconcile never changes `event_capacity_units.capacity`.

## Print Document

The seating editor has a `Печать рассадки` toolbar action for completed seating.
It builds a client-only print model from the current computed geometry,
occupants, and unseated guest/reserve pool. No print data is sent to the server,
and there is no PDF generation library.

Print behavior:

- printing uses the browser print dialog (`window.print()`);
- the editor renders a temporary `SeatingPrintDocument`, applies the body
  `seat-print-mode` class, and removes the print document/class after
  `afterprint`;
- CSS uses A4 landscape `@page` rules and print-only `.seat-print-*` classes;
- browser `Save as PDF` may still show browser-controlled headers/footers such
  as date, page number, URL, or title depending on the user's print dialog
  settings;
- the header includes event title, occurrence/slot subtitle, capacity bucket
  title, and the print timestamp;
- the first print page is an A4-safe page with compact header, selected slot
  info, and a scaled scheme viewport; large layouts are scaled down instead of
  pushing the scheme to page 2;
- print seat numbers are visual/table-based, not internal geometry
  `seatIndex` values: tables are ordered by visual rows top-to-bottom and
  left-to-right, then each table is numbered clockwise from its visual top-left
  seat;
- occupied seats show only initials plus the physical seat number, for example
  `ТГ 12`;
- empty seats show only the print number;
- the compact legend is sorted by print number and uses dense 3/4-column rows
  with full guest/reserve labels, for example `12 — Тимур Губайдуллин`;
- if the full legend does not fit below the scheme, it moves to page 2 under
  `Полная легенда`;
- reserves are clearly marked with `Резерв`;
- remaining unseated guests and pooled reserves are shown in a separate
  `Не рассажены` section;
- email and phone are never included in the print model or document.

## Manual Smoke Checklist

Not run by Codex. Manual smoke is performed by the project owner.

Prepare approximately five seats for registration A, three for B, and one each
for C and D.

1. Run automatic seating.
2. Confirm all five A members sit at one table when a fitting eligible table exists.
3. Confirm all three B members sit together where possible.
4. Confirm C and D use remaining eligible seats without splitting A unnecessarily.
5. Confirm party members occupy compact nearby positions rather than being spread
   deliberately around a table.
6. Use a layout where A cannot fit one table but two connected tables can fit it.
7. Confirm A prefers those connected tables.
8. Confirm A uses the minimum practical number of tables.
9. Manually move one A member to a regular table seat.
10. Run automatic seating again.
11. Confirm that manual placement remains.
12. Confirm remaining A members prefer that same table when enough eligible seats
    exist.
13. Repeat with the locked table lacking enough room.
14. Confirm remaining A members prefer connected tables.
15. Manually place one A member on a protected rabbi seat.
16. Run automatic seating again.
17. Confirm the manually placed person remains there.
18. Confirm ordinary remaining A members do not automatically occupy the other
    protected rabbi seats.
19. Confirm explicit rabbi guest behavior remains correct.
20. Confirm rabbi head behavior remains unchanged.
21. Confirm operational reserves remain unchanged.
22. Confirm a layout with insufficient physical seats leaves the correct guests in
    the unassigned pool.
23. Confirm the shortage warning and count remain correct.
24. Confirm single-person registrations still auto-seat normally.
25. Confirm the complete registration roster still appears in the full-list view.
26. Confirm metrics remain correct.
27. Save.
28. Close and reopen.
29. Confirm seating persists.
30. Confirm printing remains correct.
31. Confirm manual drag/drop still works.
32. Confirm capacity limits and capacity sync are unchanged.

## Out Of Scope

- RPC changes;
- Supabase schema or migrations;
- capacity reservation business logic changes;
- donation business logic changes;
- seat-by-seat seating assignment export;
- PDF seating chart generation;
- household, surname, or relationship-based party inference;
- advanced preference, demographic, VIP, or generalized optimization models;
- mobile seating;
- payment gateway;
- advanced conflict/audit reports.

## Next PR

None — the seating UX, rabbi override, and party auto-seating series is complete.

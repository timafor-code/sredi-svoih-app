# Admin seating

The seating editor is available from the web-admin registrations capacity bucket
UI. This document describes the implemented seating flow and the Phase 3 / PR 24
beta UX polish around guest-pool clarity.

The feature uses the regular authenticated Supabase browser client, role-checked
RPCs, and RLS. It does not require privileged server keys, Supabase Admin API
access, or direct access to `auth.users`.

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
- deterministic auto seating;
- manual drag/drop seating;
- operational reserves;
- edit-preserve reconcile when geometry changes after seating;
- display capacity summary;
- explicit capacity sync action with confirmation;
- empty guest-pool warning for beta admins;
- responsive modal polish for smaller admin viewports.

## Manual Tool Boundary

The seating editor remains a manual operational tool. It helps admins build a
physical layout and place guests for one selected slot:
`(event_id, occurrence_id, capacity_unit_id)`.

This PR does not change the seating algorithm, auto-seat behavior, manual-seat
behavior, capacity reservation logic, donation logic, backend RPCs, or schema.
The editor must not auto-create guests, auto-seat empty pools, or infer missing
registrations.

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

`apps/admin/src/services/adminSeatingService.ts` is the typed client for the
read/write seating RPCs. It normalizes RPC snake_case rows into camelCase
frontend models, serializes the v15 payload contract on writes, and centralizes
Supabase error handling.

`apps/admin/src/lib/seatingGeometry.ts` is pure and has no IO. Related pure
helpers handle deterministic auto assignment, drag/drop moves, assignment
reconcile, and display-only capacity math.

## Capacity Limit Vs Physical Seats

This invariant must stay true across seating work:

- `capacity_unit.capacity` / `event_capacity_units.capacity` is the business
  limit for public registration.
- `physicalSeatCount` is the number of physical chairs produced by the current
  seating geometry.
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

Assignment behavior:

- auto seating is deterministic and uses `spreadSeatIndexes` so people are spread
  across available physical seats instead of filling the first seats only;
- ordinary auto seating excludes rabbi-table seats;
- manual drag/drop supports pool-to-seat, seat-to-seat, occupied-seat swap, and
  seat-to-pool;
- manually placed guests are saved as manual/locked assignments;
- repeat auto seating preserves manual/locked assignments and placed reserves,
  then fills only free eligible seats;
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

## Manual Smoke Checklist

Not run by Codex. Manual smoke is performed by the project owner.

1. Open Registrations page as admin.
2. Select an event and occurrence with a capacity bucket.
3. Open the seating editor from that bucket.
4. Confirm the modal states that seating is a manual tool for the selected slot.
5. Open a slot where the guest pool is empty.
6. Confirm the empty guest pool warning explains possible causes.
7. Confirm donation-only registrations are described as non-seat items.
8. Confirm empty guest pool does not auto-create guests.
9. Confirm empty guest pool does not auto-seat anyone.
10. Confirm capacity limit is described separately from physical seats.
11. Confirm existing layout editing still works.
12. Confirm manual drag/drop still works when guests exist.
13. Confirm auto seating still uses the existing behavior when guests exist.
14. Confirm no RPC/schema/seating algorithm/Excel schema changes were made.
15. Confirm no browser smoke was run by Codex.

## Out Of Scope

- RPC changes;
- Supabase schema or migrations;
- seating algorithm changes;
- auto-seat/manual-seat behavior changes;
- capacity reservation business logic changes;
- donation business logic changes;
- seat-by-seat seating assignment export;
- print/PDF seating chart;
- family/group seating;
- mobile seating;
- payment gateway;
- advanced conflict/audit reports.

## Next PR

`feature/admin-feedback-review-list`

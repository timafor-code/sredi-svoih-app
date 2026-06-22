# Admin seating

Final state for registrations + seating v15. This document describes the
implemented web-admin seating flow after PRs #199-#212 and the PR #213
registrations/export polish. It is documentation only: the seating flow uses the
regular authenticated Supabase browser client, role-checked RPCs, and RLS. It
does not require privileged server keys, Supabase Admin API access, or direct
access to `auth.users`.

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
- responsive modal polish for smaller admin viewports.

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

Validation enforced by the write layer:

- caller must be an admin or event manager for the slot's community;
- event, occurrence, and capacity unit must belong to the same event/community;
- a layout must contain exactly one rabbi table;
- table geometry uses supported seat/angle values;
- guest assignments must reference registrations for the same slot/bucket;
- reserve assignments cannot carry `registration_id`;
- save-layout and save-assignments payloads cannot change the registration
  capacity limit.

## Service Layer

`apps/admin/src/services/adminSeatingService.ts` is the typed client for the
read/write seating RPCs. It normalizes RPC snake_case rows into camelCase
frontend models, serializes the v15 payload contract on writes, and centralizes
Supabase error handling.

The service layer is paired with:

- `apps/admin/src/types/seating.ts` for geometry, template, layout, assignment,
  guest-pool, reserve, and RPC types;
- `apps/admin/src/services/adminRegistrationCapacityService.ts` for capacity
  analytics, bucket data, reservations, and the seating guest pool;
- `apps/admin/src/services/adminCapacityService.ts` for explicit capacity sync
  through `admin_update_capacity_unit_limit`.

## Geometry Layer

`apps/admin/src/lib/seatingGeometry.ts` is pure and has no IO. It computes table
bounds, endpoints, seams, chairs, blocked seats, rabbi head/reserved seats,
stable seat keys, and deterministic spread indexes. The editor persists table
identity by `client_table_id`; seat keys and connections are based on that stable
client id, not on volatile database row ids.

Related pure helpers:

- `seatingAutoAssign.ts` runs deterministic auto seating and converts results
  into assignment payloads;
- `seatingDragDrop.ts` applies pool-to-seat, seat-to-seat, swap, and seat-to-pool
  moves;
- `seatingAssignmentReconcile.ts` preserves or returns assignments after
  geometry edits;
- `seatingCapacity.ts` derives display-only capacity summary values.

## Layout Editor

The seating editor opens from a capacity bucket in web-admin registrations. The
slot is always the concrete selected `(event_id, occurrence_id,
capacity_unit_id)`.

Implemented editor behavior:

- load existing layout or initialize a valid layout with one rabbi table;
- add, move, rotate, delete, and resize supported table geometry;
- keep exactly one rabbi table;
- save layout geometry separately from assignments;
- load real guest pool for the selected bucket;
- run auto seating;
- manually drag guests/reserves between the pool and seats;
- create and place reserves;
- edit geometry after seating and reconcile preserved placements;
- show capacity metrics and capacity-sync affordance when physical seats differ
  from the registration limit;
- remain usable in smaller viewport sizes with scroll-safe canvas and side
  panels.

## Templates vs Instances

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

## Capacity Invariant

This is the product invariant that must stay true across seating work:

- `capacity_unit.capacity` / `event_capacity_units.capacity` is the business
  limit for public registration.
- `physicalSeatCount` is the number of physical chairs produced by the current
  seating geometry.
- Changing table geometry never automatically changes the registration limit.
- Limit 70 / physical seats 80 is valid: the extra 10 physical seats are an
  operational reserve buffer.
- Limit 70 / physical seats 60 is an operational problem: the UI must highlight
  that there are not enough physical seats for the configured registration
  limit/occupied demand.
- Raising or lowering the registration limit is allowed only through the
  explicit capacity sync action and confirmation dialog.

The capacity summary is display math. It shows the difference between the
business limit and physical chairs, including reserve seats and missing physical
seats, but it does not write anything.

Capacity sync calls `admin_update_capacity_unit_limit` only after admin
confirmation. It updates `event_capacity_units.capacity`; it does not change
layouts, assignments, registrations, payments, or donations. The UI blocks a
lowering action when the new limit would fall below already occupied registration
seats, and the RPC enforces the same safety rule.

## Rabbi Table

Every valid layout has exactly one rabbi table.

- The rabbi table is marked with `isRabbiTable`.
- Its head seat is visually marked with a star.
- The remaining rabbi-table seats are reserved for manual operational control.
- Auto seating does not place ordinary guests at the rabbi table.
- Manual placement rules keep rabbi-table seats protected for explicit admin
  decisions, including reserves and any intentionally managed rabbi/head-seat
  case.

## Guest Pool and Assignments

The guest pool is built for the selected capacity bucket from confirmed/active
seat-taking registrations and their guests. In the current service this means
registrations in seating-active statuses (`confirmed`, `pending`, `attended`)
whose capacity obligations map to the selected bucket. Donation-only and
non-seat options do not enter the pool.

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

## Reserves

Reserves are operational placeholders for physical chairs.

- A reserve occupies one physical seat when placed.
- A reserve does not create an `event_registration`.
- A reserve does not increase occupied registration seats.
- A reserve does not change `event_capacity_units.capacity`.
- A placed reserve reduces physically free seats and blocks that chair from auto
  seating.
- Auto seating never seats reserve pool items; reserves are added and placed
  manually.

## Edit-Preserve Reconcile

When admins edit tables after seating has already been done, the editor preserves
the current assignments while geometry is being changed. Returning to seating or
running auto seating reconciles those preserved assignments against the new
physical seats.

Reconcile rules:

- keep an assignment only if its seat still exists and is still active/valid;
- keep manual/locked assignments and reserves ahead of auto-filled assignments
  when there is a conflict;
- return guests/reserves to the pool when their seat disappeared, became
  blocked, became a protected rabbi seat for an ordinary guest, or conflicts with
  a higher-priority assignment;
- show a warning/count summary for preserved versus returned placements;
- never change `event_capacity_units.capacity` as part of geometry reconcile.

## Capacity Summary and Sync

The seating modal shows compact metrics for:

- physical seats from geometry;
- registration limit from `event_capacity_units.capacity`;
- occupied registration seats from the selected bucket;
- placed reserves;
- free seats by limit;
- free physical seats;
- missing physical seats;
- physical overflow beyond the registration limit.

The summary makes the operating cases visible:

- 70 limit / 80 physical seats: valid reserve buffer, no automatic limit change.
- 70 limit / 60 physical seats: capacity mismatch that should be highlighted.

When physical seats differ from the business limit, authorized admins/event
managers can choose the capacity sync action. The confirmation explains whether
the action opens additional public registration seats or lowers the public
registration limit. Nothing is synced automatically when tables are edited,
saved, templated, auto-seated, or manually dragged.

## Responsive Polish

The final modal polish keeps the editor usable on smaller admin screens:

- header, toolbar, canvas, assignments panel, metrics, and footer stay in a
  scroll-safe modal layout;
- canvas and assignments areas manage their own overflow;
- narrow screens stack the assignments panel below the canvas;
- toolbar actions expose clearer disabled/loading/error states;
- keyboard shortcuts are scoped away from inputs/selects/contenteditable fields;
- zoom and fit controls inspect larger layouts without changing saved geometry.

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
10. Verify exactly one rabbi table and the starred head seat.
11. Save the layout.
12. Save the layout as a template.
13. Apply that template to another slot.
14. Run auto seating.
15. Manually drag a guest between pool/seats.
16. Add a reserve and place it on a seat.
17. Change geometry and verify the reconcile warning/returned pool items.
18. Check the seating capacity summary.
19. Check the capacity sync confirmation.
20. Confirm the registration limit does not change without explicit capacity
    sync approval.

## Out of Scope / Next PR

- seat-by-seat seating assignment export;
- print/PDF seating chart;
- family/group seating;
- mobile seating;
- payment gateway;
- advanced conflict/audit reports.

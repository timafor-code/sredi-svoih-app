# Admin seating

This document describes the backend foundation for event seating: the database
schema, row level security model, and read-only RPC. It is built across the
block B PRs and may be extended in later ones.

- **PR 7 (this document, initial version):** schema + RLS + read RPC. Database
  layer only — no UI, no mutations, no auto-seating.
- **PR 8:** seating write RPC (create/update layouts, tables, connections,
  assignments) plus the manage RLS policies and write grants.
- **Later PRs:** auto-seating, locked/manual assignments, extra assignment
  types.

The browser admin client talks to all of this through the normal authenticated
Supabase session. No service role or Admin API is used anywhere in the seating
flow.

## Templates vs instances

There are two distinct concepts, and keeping them apart is the core of the
model.

- **Template** (`event_seating_layout_templates`) — reusable *geometry only*.
  It is **community scoped**: it belongs to a community, not to any event,
  occurrence, or capacity slot, and it carries **no guests and no slot**. A
  template is a saved arrangement of tables (and their connections) that an
  admin can apply to many seating instances. Built-in templates
  (`is_builtin = true`) cover the prototype's `builtin:holiday_p_row`,
  `builtin:grid`, and `builtin:blank` starting points; saved templates cover the
  prototype's `saved:*` entries. `is_active` is a soft-delete flag.

- **Instance / layout** (`event_seating_layouts`) — one concrete seating
  arrangement bound to a single **capacity slot**: `(event_id, occurrence_id,
  capacity_unit_id)`. The slot is unique (`event_seating_layouts_slot_unique`),
  so there is at most one seating instance per slot. `occurrence_id` may be
  `null` for legacy single-occurrence registrations; Postgres treats `null`
  occurrences as distinct, which is the intended behaviour for that one
  null-occurrence slot. `template_id` is nullable, mirroring the prototype
  `activeTemplateId`: a builtin/grid/blank choice has no saved-template row, so
  the instance keeps its own geometry. `capacity_limit_snapshot` is nullable and
  `null` means *no limit*, matching `event_capacity_units.capacity`.

An instance owns three child collections:

- `event_seating_tables` — the tables placed in this instance.
- `event_seating_table_connections` — seams joining two tables.
- `event_seating_assignments` — guests and reserves placed on chairs.

## Payload contract

Field shapes mirror the v15 prototype localStorage payload in
`docs/prototype/registrations-improved-seating-v15.html`
(`seatMockV15:*` and the `seatLayoutTemplatesV14` template list). The runtime
prototype payload is:

```
{ layout, customTables[], tableConnections[], selectedTableId, seatingDone,
  activeTemplateId, reserveIds[], capacity, chairs[], pool[] }
```

The persisted shapes drawn from it:

- **Table** (prototype `customTables[]`, and `tables[]` inside a template
  snapshot):
  `{ id, cx, cy, w, h, angle, sideSeats, isRabbiTable }`.
  Stored in `event_seating_tables` as `client_table_id` (= prototype `id`),
  `cx`, `cy`, `w`, `h`, `angle` (one of `0/90/180/270`), `long_side_seats`
  (= prototype `sideSeats`, one of `2/3`), and `is_rabbi_table`. The prototype
  has no round tables, so there is no `is_round` column.

- **Connection** (prototype `tableConnections[]`):
  `{ aTableId, aEnd, bTableId, bEnd, x, y }`.
  Stored in `event_seating_table_connections` as `from_client_table_id`,
  `from_end`, `to_client_table_id`, `to_end`, `anchor_x`, `anchor_y`.

- **Assignment** (prototype `occByKey` entries placed onto `chairs[]`):
  each `occByKey` value is `{ type: 'guest' | 'reserve', name, initials }`.
  Stored in `event_seating_assignments` as `assignment_type`
  (`'guest'` or `'reserve'`), `guest_label` (= `name`), `guest_initials`
  (= `initials`), and `seat_key` (`client_table_id` + seat index, `null` when
  the entry is unplaced in the prototype `pool[]`). Reserves have no
  `registration_id` (nullable); guests reference `event_registrations`.

### Template snapshot

`event_seating_layout_templates.snapshot` is a jsonb object:

```
{ version, canvas: { width, height }, tables: [...], connections: [...] }
```

where `tables[]` and `connections[]` follow the table and connection shapes
above. A template snapshot is geometry only — it never contains guests, a slot,
or assignments.

## RLS model (parent -> children)

Every one of the five tables has row level security enabled and an explicit
membership check; none rely on a parent table's policy implicitly. Membership is
checked with `public.has_community_role(community_id, array['admin',
'event_manager'])`, reused exactly as the capacity tables do. No service role.

- `event_seating_layout_templates` and `event_seating_layouts` carry
  `community_id` directly and are scoped by it.
- `event_seating_tables`, `event_seating_table_connections`, and
  `event_seating_assignments` have **no** `community_id` of their own. Each is
  reached through its parent `layout_id`: its policy joins
  `event_seating_layouts` and checks that layout's `community_id`.

PR 7 ships **SELECT** policies and **SELECT** grants only (read layer). The
manage (`for all`) policies, the write grants, and the seating write RPC are
added in PR 8.

## Tables

| Table | Purpose |
| --- | --- |
| `event_seating_layout_templates` | Reusable, community-scoped geometry (no guests, no slot). |
| `event_seating_layouts` | One seating instance per capacity slot `(event_id, occurrence_id, capacity_unit_id)`. |
| `event_seating_tables` | Tables of one instance (`layout_id` -> CASCADE). |
| `event_seating_table_connections` | Seams between two tables (`layout_id` -> CASCADE). |
| `event_seating_assignments` | Guests / reserves on chairs (`layout_id` -> CASCADE). |

## Read RPC

All three are `security definer`, gate on `auth.uid()` and
`has_community_role(..., array['admin', 'event_manager'])`, and follow the
existing admin read RPC pattern.

| Function | Returns |
| --- | --- |
| `admin_list_seating_templates()` | Active templates across the caller's admin/event_manager communities. |
| `admin_get_seating_template(p_template_id uuid)` | A single template (404-style error if missing, 403-style if not a manager). |
| `admin_get_seating_layout(p_event_id uuid, p_occurrence_id uuid, p_capacity_unit_id uuid)` | The instance for one slot, with its `tables`, `connections`, and `assignments` as jsonb. Returns a single row with a `null` layout when no instance exists yet for the slot. |

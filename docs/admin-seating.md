# Admin seating

This document describes the backend foundation for event seating: the database
schema, row level security model, and read-only RPC. It is built across the
block B PRs and may be extended in later ones.

- **PR 7:** schema + RLS + read RPC. Database layer only — no UI, no mutations,
  no auto-seating.
- **PR 8 (this revision):** seating write RPC (save layout, save assignments,
  create/delete templates, create layout from template). No UI, no full typed
  service layer — only minimal wrappers in `adminSeatingService.ts`.
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

PR 7 ships **SELECT** policies and **SELECT** grants only (read layer).

PR 8 adds the seating write RPC **without** opening direct table writes. There
are deliberately **no** `for all` manage policies and **no** write grants on the
five seating tables. All mutations flow exclusively through the SECURITY DEFINER
write RPC below, which runs as the function owner and therefore bypasses RLS for
its own validated inserts/updates/deletes. Because clients hold no write grant,
they cannot reach these tables with a hand-crafted PostgREST call — the RPC
validation layer (role, single-community scope, exactly-one-rabbi-table,
capacity untouched) is the only write path and cannot be bypassed.

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

## Write RPC (PR 8)

All five are `security definer` with `set search_path = public`, gate on
`auth.uid()`, and require `has_community_role(community_id, array['admin',
'event_manager'])`. They are the **only** write path (see the RLS note above). No
service role, no Admin API, and `auth.users` is never touched. The minimal
client wrappers live in `apps/admin/src/services/adminSeatingService.ts`; the
full typed service layer is PR 10.

| Function | What it writes |
| --- | --- |
| `admin_save_seating_layout(payload jsonb)` | Upserts the layout row for the slot and **replaces** its tables and connections. Saves only geometry: `template_id`, `seating_done`, and a server-derived `capacity_limit_snapshot`. **Assignments are untouched.** |
| `admin_save_seating_assignments(payload jsonb)` | **Replaces** the layout's assignments from `chairs[]` (placed) and `pool[]` (unplaced). The layout must already exist. Returns `{ layoutId, placedCount, pooledCount, reserveCount }`. |
| `admin_create_seating_template_from_layout(p_layout_id uuid, p_title text)` | Copies **geometry only** (tables + connections) from a layout into a fresh, community-scoped template snapshot. Guests / assignments are never copied. |
| `admin_delete_seating_template(p_template_id uuid)` | **Soft delete** (`is_active = false`). Built-in templates (`is_builtin = true`) cannot be deleted. |
| `admin_create_seating_layout_from_template(p_event_id uuid, p_occurrence_id uuid, p_capacity_unit_id uuid, p_template_id uuid)` | Forks a **new** layout instance for the slot from a template snapshot: copies tables / connections, snapshots the current real limit, copies **no** assignments. Raises if the slot already has a layout. |

### Slot routing in the save payload

The v15 contract (`{ layout, customTables[], tableConnections[],
selectedTableId, seatingDone, activeTemplateId, reserveIds[], capacity,
chairs[], pool[] }`) carried the slot in the prototype's localStorage *key*, not
in the body. The save RPC therefore also reads three routing keys from the
payload: `eventId`, `occurrenceId` (nullable), and `capacityUnitId`. They are
resolved through `seating_slot_community(...)`, which confirms event, occurrence
and capacity unit all hang off the same event (hence the same community) and
returns that community id for the role check.

- `admin_save_seating_layout` reads `customTables[]` → `event_seating_tables`,
  `tableConnections[]` → `event_seating_table_connections`, and
  `activeTemplateId` → `template_id` (honoured only when it is a real
  same-community template uuid; builtin/grid/blank ids stay `null`).
- `admin_save_seating_assignments` reads `chairs[]` (each placed entry needs a
  `seatKey`) and `pool[]` (unplaced, `seatKey` is `null`). Each entry is
  `{ seatKey?, registrationId?, type, name, initials }`. `reserveIds[]` is
  accepted for parity; reserves are simply the entries with `type = 'reserve'`.

### Validations

Every write RPC enforces:

- the caller has role `admin` or `event_manager` in the slot's community;
- `event_id` / `occurrence_id` / `capacity_unit_id` belong to **one** community
  (all tied to the same event via `seating_slot_community`);
- `layout_id` (template-from-layout) belongs to that same community;
- **exactly one** table with `is_rabbi_table = true`
  (`seating_assert_valid_tables`);
- `long_side_seats ∈ {2, 3}` and `angle ∈ {0, 90, 180, 270}` for every table
  (also backed by table CHECK constraints);
- `assignment_type ∈ {'guest', 'reserve'}`;
- a `reserve` assignment carries **no** `registration_id`;
- a `guest` assignment's registration belongs to **this**
  event / occurrence / capacity unit, verified against
  `event_registration_capacity_reservations`;
- the payload neither contains nor can change `event_capacity_units.capacity`.

### Capacity is never changed

`event_capacity_units.capacity` is the authoritative registration limit and is
**never written** by any function in the write-RPC migration. The save and
create-from-template RPC derive `event_seating_layouts.capacity_limit_snapshot`
**server-side** from the current capacity unit (`select capacity from
event_capacity_units`), ignoring any `capacity` value in the payload. The
snapshot is a non-authoritative display value only; the real limit lives in
`event_capacity_units.capacity` and changing it is a separate, explicit admin
action (planned for PR 19). A seating save can therefore never silently raise or
lower who may register.

## Manual smoke checklist (PR 8)

Run by the project owner; not executed by Codex.

1. As an `admin` / `event_manager`, build a layout for a slot and call
   `admin_save_seating_layout` — verify tables/connections are stored and
   `capacity_limit_snapshot` matches the unit's real `capacity`.
2. Save a layout with **zero** or **two** rabbi tables — expect a clear
   "exactly one rabbi table" error and no rows written.
3. Confirm `event_capacity_units.capacity` is unchanged after any seating save
   (it must never move).
4. Call `admin_save_seating_assignments` with a guest whose registration is for
   another slot — expect rejection; with a `reserve` carrying a
   `registration_id` — expect rejection.
5. `admin_create_seating_template_from_layout` then
   `admin_create_seating_layout_from_template` into a fresh slot — geometry
   copies, assignments do not.
6. `admin_delete_seating_template` on a user template flips `is_active = false`;
   on a built-in template it is rejected.
7. As a non-manager (or member of another community), every call is rejected.

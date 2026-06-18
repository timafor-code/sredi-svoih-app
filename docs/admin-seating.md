# Admin seating

This document describes the backend foundation for event seating: the database
schema, row level security model, and read-only RPC. It is built across the
block B PRs and may be extended in later ones.

- **PR 7:** schema + RLS + read RPC. Database layer only — no UI, no mutations,
  no auto-seating.
- **PR 8:** seating write RPC (save layout, save assignments, create/delete
  templates, create layout from template). No UI, no full typed service layer —
  only minimal wrappers in `adminSeatingService.ts`.
- **PR 9:** pure seating geometry layer (`apps/admin/src/lib/seatingGeometry.ts`)
  and the geometry types in `apps/admin/src/types/seating.ts`. No IO, no UI.
- **PR 10:** the full **typed service layer** over the read/write
  RPC (`adminSeatingService.ts` + the service-layer types in `types/seating.ts`).
  Still no canvas and no UI — see "Service layer" below.
- **PR 11:** the first web-admin seating layout editor UI for
  registration capacity buckets. It adds the modal, toolbar, canvas/stage and
  table-geometry controls only. No guests, auto-seating, manual guest drag/drop,
  reserves, real template library, capacity summary or capacity sync.
- **PR 12:** the real seating template library in the editor:
  client-side built-in templates, user templates from the existing seating
  service/RPC, apply, save current layout as template, and soft delete user
  templates. Still no guests, assignments UI, auto-seating, reserves, capacity
  summary or capacity sync.
- **PR 13:** seating assignments foundation for the selected
  registration capacity bucket. The editor now loads the real read-only guest
  pool and renders the "Не рассажены" panel, but it still does not place guests,
  save assignments, auto-seat, drag/drop, create reserves or change capacity.
- **PR 14:** deterministic auto seating for the selected
  registration capacity bucket. The editor adds "Сделать рассадку", distributes
  active guests across the physical geometry, saves generated assignments through
  the existing seating RPC, renders occupied seats with initials and leaves
  overflow guests in "Не рассажены".
- **PR 15 (this revision):** manual drag/drop seating management on top of auto
  seating. The editor lets an admin drag a guest from "Не рассажены" onto a free
  seat, move a seated guest to another free seat, swap two seated guests, and drag
  a seated guest back to "Не рассажены". Manual placements are marked manual/locked,
  saved through the existing assignment RPC, restored on reopen, and preserved by a
  repeat auto seating. No reserves, no geometry-change reconcile, no capacity
  summary/sync, and no change to `event_capacity_units.capacity`.
- **PR 16:** operational reserves (`+ Резерв`) placed on physical seats without
  changing the registration count.
- **PR 17 (this revision):** edit-preserve / reconcile after a table geometry
  change. Entering "Редактировать столы" hides guests/reserves and keeps the
  current assignments; returning to seating (or "Сделать рассадку") reconciles the
  preserved placements with the new geometry — valid seats are kept (manual/locked
  and reserves win conflicts), missing/blocked/duplicate occupants return to
  "Не рассажены", and a short warning reports how many placements were preserved vs
  returned. No change to `event_capacity_units.capacity`.
- **PR 18 (this revision):** display-only capacity summary in the seating modal.
  It makes the difference between the physical seats from the table geometry and
  the registration limit explicit, and changes nothing else: no capacity sync, no
  new RPC, no migration, and no change to `event_capacity_units.capacity`.
- **PR 19 (this revision):** explicit admin capacity sync action. The seating
  modal can update `event_capacity_units.capacity` to the current number of
  physical seats only after a confirmation dialog and the role-checked
  `admin_update_capacity_unit_limit` RPC. There is still no auto-sync when
  tables are edited or saved.
- **PR 20 (this revision):** responsive polish for the web-admin seating modal:
  smaller viewport behavior, scroll-safe canvas/assignments areas, minimal
  zoom/fit controls, keyboard shortcuts, clearer loading/empty/error states and
  stricter disabled toolbar states. The same polish pass moves the
  capacity/status metrics into compact cards in the right column and uses the
  footer for keyboard shortcuts, including `N` to add a table. No backend,
  capacity, registration, seating algorithm or RPC behavior changes.
- **Later PRs:** docs and checklists (PR 21).

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

Applying a template always writes geometry into the current slot's layout
instance. It does not bind future edits back to the template: after apply,
moving or rotating a table changes only the layout instance. Built-in templates
do not create backend template rows. User templates are read from
`event_seating_layout_templates`; deleting one flips `is_active = false` and
does not delete or rewrite any existing layout instance.

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

  **Table identity is `client_table_id`, not the DB row `id`.** Every seat key,
  connection endpoint and saved assignment is built from `client_table_id`, so it
  is the only stable handle across a save → reopen cycle. The read RPC returns
  `to_jsonb(st.*)`, which carries *both* the volatile `event_seating_tables.id`
  uuid and `client_table_id`; `normalizeTable` therefore prefers
  `client_table_id` (falling back to `id` only for template snapshots, whose v15
  camelCase rows have no `client_table_id`). Re-keying tables to the DB uuid on
  reopen would orphan every saved `seat_key` — the canvas would reopen empty, the
  status line would show 0 occupied, and the editor would raise the false "часть
  сохранённых мест больше не существует" warning even though geometry is
  unchanged.

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
action (PR 19). A seating save can therefore never silently raise or
lower who may register.

## Capacity limit RPC (PR 19)

`admin_update_capacity_unit_limit(capacity_unit_id uuid, new_capacity integer)`
is the only PR 19 backend write. It is `security definer`, gates on `auth.uid()`,
checks `has_community_role(community_id, array['admin', 'event_manager'])`, and
first proves that the capacity unit belongs to an event in a community available
to that admin/event_manager.

The RPC updates only `event_capacity_units.capacity`. It does not touch seating
layouts, seating assignments, registrations, reservations, payment or donation
data. `new_capacity` may be `null` because the column allows it, but the PR 19 UI
does not expose a generic editor; the visible action sets the limit to the
current physical seat count.

Validation:

- rejects anonymous calls;
- rejects missing `capacity_unit_id`;
- rejects `new_capacity <= 0` when a numeric limit is provided;
- locks the capacity unit row before counting/updating, matching the public
  registration capacity check's concurrency shape;
- counts active registration capacity reservations for the unit with statuses
  `confirmed`, `pending`, `attended`, `no_show`;
- because the RPC has no occurrence argument, treats the safe occupied floor as
  the maximum occupied seats in any occurrence/null scope for that unit;
- blocks lowering the limit below that occupied floor.

## Service layer (PR 10)

`apps/admin/src/services/adminSeatingService.ts` is the full typed client over the
read RPC (PR 7) and write RPC (PR 8). It replaces the minimal pass-through
wrappers from PR 8 with typed inputs/outputs, snake_case → camelCase
normalisation, camelCase → v15 payload serialisation, and centralised RPC error
handling. The model types live in `apps/admin/src/types/seating.ts` (service-layer
section), built on top of and reusing the geometry types (`SeatingTable`,
`SeatingConnection`) so a loaded layout feeds straight into `seatingGeometry.ts`
without translation.

PR 10 had no canvas and no UI. The first layout editor UI lands in PR 11. PR 12
uses this service layer for the real template selector: list templates, save the
current layout before creating a user template, soft-delete a user template, and
apply user-template geometry through the existing save-layout contract. PR 13
adds the real guest pool, and PR 14 uses `saveSeatingAssignments()` for the
first generated assignment flow. Manual drag/drop, user reserves and the
capacity summary are still later PRs (15–18). `SeatingCapacitySummary` here is a
**type only** — its formulas and UI arrive in PR 18.

Through PR 18, the seating service never changed the registration limit. The
`capacity` field on the save payload is accepted for v15 parity only; the seating
write RPC ignores it and derives `capacity_limit_snapshot` server-side (see
"Capacity is never changed" above).

PR 19 adds a separate `apps/admin/src/services/adminCapacityService.ts` wrapper
for `admin_update_capacity_unit_limit(capacity_unit_id, new_capacity)`. It uses
the normal authenticated Supabase client and writes only through the RPC/RLS
path. It is not part of `saveSeatingLayout()` and is never called by table
editing, drag/drop, reserves or auto seating.

### Public service functions

| Function | RPC | Returns |
| --- | --- | --- |
| `listSeatingTemplates()` | `admin_list_seating_templates` | `SeatingTemplate[]` |
| `getSeatingTemplate(templateId)` | `admin_get_seating_template` | `SeatingTemplate` |
| `getSeatingLayout(params)` | `admin_get_seating_layout` | `SeatingLayout \| null` (null = no instance for the slot yet) |
| `createSeatingLayoutFromTemplate(params)` | `admin_create_seating_layout_from_template` | `SeatingLayoutRow` |
| `saveSeatingLayout(payload)` | `admin_save_seating_layout` | `SeatingLayoutRow` |
| `saveSeatingAssignments(payload)` | `admin_save_seating_assignments` | `SeatingAssignmentsSaveResult` |
| `createSeatingTemplateFromLayout(layoutId, title)` | `admin_create_seating_template_from_layout` | `SeatingTemplate` |
| `deleteSeatingTemplate(templateId)` | `admin_delete_seating_template` | `SeatingTemplate` |

`getSeatingLayout` / `createSeatingLayoutFromTemplate` take a `SeatingSlotParams`
(`{ eventId, occurrenceId, capacityUnitId }`, plus `templateId` for the fork). The
routing keys (`eventId` / `occurrenceId` / `capacityUnitId`) live **inside** the
save payload by design (PR 8); the service types them explicitly rather than
hiding them.

## Layout editor UI (PR 11–14)

PR 11 added the first production React UI for the seating layout editor in
web-admin registrations. PR 12 replaces the placeholder template controls with
the real template library. PR 13 adds the read-only guest pool foundation. PR 14
adds deterministic auto seating and assignment save. The
source of truth for visual behaviour is
`docs/prototype/registrations-improved-seating-v15.html`, ported into React
components rather than mounted as prototype HTML.

Implemented scope:

- `SeatingLayoutEditor` modal opened from each registration capacity bucket.
- `SeatingTemplateSelector` with built-in templates and user templates from the
  existing seating service/RPC.
- `SeatingToolbar` with table editing buttons.
- `SeatingCanvas` with fit/scale behaviour, editable tables, potential physical
  seats, rabbi table styling and the centered head-seat star.
- Geometry-only editing: add/select/move/delete tables, rotate by 90 degrees,
  switch selected/all tables between 2 and 3 long-side seats.
- Built-in templates:
  - `builtin:blank` / "Пустой конструктор": a safe default constructor with one
    rabbi table.
  - `builtin:holiday_p_row` / "П + ряд — праздничная схема": generated from the
    prototype holiday layout, using geometry constants rather than hardcoded UI
    pixels.
  - `builtin:grid` / "Сетка отдельных столов": generated as a table grid sized
    from the current slot capacity when available.
- User templates:
  - listed via `listSeatingTemplates()`;
  - saved via `saveSeatingLayout()` followed by
    `createSeatingTemplateFromLayout(layoutId, title)`;
  - soft-deleted via `deleteSeatingTemplate(templateId)`;
  - applied by cloning the template snapshot into the current layout instance
    and saving through `saveSeatingLayout()`.
- Save through `saveSeatingLayout`, using the existing v15-compatible payload
  and the authenticated admin Supabase client.
- `SeatingAssignmentsPanel` in the editor side panel.
- Real "Не рассажены" guest pool for the selected
  `(event_id, occurrence_id, capacity_unit_id)` bucket.
- Guest chips with display name, initials, source label (participant/guest),
  registration status/payment labels already available in the registration UI,
  and selected option labels when available.
- `seatingAutoAssign` pure logic for deterministic generated assignments.
- "Сделать рассадку" action in the seating editor.
- Occupied physical seats rendered with guest initials after auto seating.
- The "Не рассажены" panel filtered to overflow/unassigned guests after auto
  seating.
- Assignment save through the existing `saveSeatingAssignments()` service and
  `admin_save_seating_assignments` RPC.

### Guest pool model (PR 13)

The guest pool is a read-only view over existing registration/capacity data. It
is not `event_seating_assignments` and opening the modal does not write seating
assignment rows.

The pool is built from:

- active registrations returned by the existing `admin_list_event_registrations`
  RPC, paged by status;
- durable `event_registration_capacity_reservations` rows for the selected
  capacity unit, read through the authenticated Supabase client and RLS;
- read-only option-capacity obligations from
  `event_participation_option_capacity_units` for active, non-donation,
  capacity-counting selected options when a matching durable reservation row is
  not present.

This mirrors the registration capacity analytics fallback. The fallback is still
bucket-level identity, not title matching: the client uses `option_id`,
`event_id`, `occurrence_id`, and `capacity_unit_id` to prove that the selected
option maps to the current bucket. The `admin_save_seating_assignments` RPC
validates the same two accepted obligation sources: durable reservation rows or
active mapped option selections. Donation-only selections, non-capacity options,
and inactive registration statuses are rejected/excluded.

Active pool statuses for PR 13 are `confirmed`, `pending`, and `attended`.
`cancelled`, `rejected`, `waitlisted`, and `no_show` are not rendered as active
guests. Pending is included because the current registration capacity analytics
already treats pending registrations as seat obligations.

Donation options and non-capacity options do not create guest pool items. A pool
item is one seat obligation in the selected bucket: the main participant first,
then registration guests by index/name. If a registration has more seat
obligations than named guests, the remaining real obligations are shown as
numbered unnamed guests tied to the registration.

Mapped multi-meal options such as "Весь шабат" appear in buckets such as
`friday_dinner` or `shabbat_lunch` only when the selected option has a mapping
to that capacity unit (or a durable reservation row for it). Guests from other
capacity units are not included in the seating pool for the selected bucket.

Initials are derived from the first two non-empty name parts, using locale-aware
uppercase for Russian/Latin names and `?` as the safe fallback for empty names.

Explicitly not included in PR 13:

- placing guests on seats;
- auto-seating;
- manual guest drag/drop;
- reserves;
- saving real seating assignments;
- capacity summary, capacity sync or any change to
  `event_capacity_units.capacity`.

### Auto seating (PR 14)

PR 14 is the first real assignment flow. It ports the v15 prototype behaviour
from `seatMakeSeating`, `autoArrange`, `spreadSeatIndexes`,
`rabbiSeatIndexes`, `pickRabbiHeadIndex` and the post-auto rendering rules, but
keeps it as production React and pure TypeScript rather than copying prototype
HTML.

Algorithm:

- The input is the current seating geometry (`tables` + `connections`, computed
  through `computeTableSeats`) and the current active guest pool for the
  selected `(event_id, occurrence_id, capacity_unit_id)` bucket.
- Guests are not randomized and are not read from the DOM. The same input yields
  the same assignments.
- The rabbi/head seat is computed by the geometry layer. All seats belonging to
  the rabbi table are blocked for ordinary guests.
- If the guest pool contains an explicit rabbi guest marker, that real guest is
  placed on the head seat. If there is no explicit rabbi guest, the head seat
  remains visually marked/reserved by geometry and no fake "Раввин" assignment
  is created.
- Regular guests are distributed over non-rabbi, non-blocked seats using
  `spreadSeatIndexes`, so auto seating spreads people across the physical
  figure instead of filling the first N chairs.
- If physical seats are insufficient, the overflow guests remain in
  "Не рассажены" and a warning is shown. They are also sent in the v15-compatible
  `pool[]` payload.
- If the guest pool is empty or there are no tables, the editor shows a
  no-op/warning state and does not crash.

Persistence:

- Clicking "Сделать рассадку" first saves the current layout geometry through
  `saveSeatingLayout()` so the layout row exists for the slot.
- It then saves generated `chairs[]` and overflow `pool[]` through
  `saveSeatingAssignments()` / `admin_save_seating_assignments`.
- After assignment save succeeds, the layout is saved with `seatingDone = true`
  and the table figure is locked in the editor.
- Assignment rows reference only registrations from the selected bucket. No
  user reserve rows are created in PR 14.
- Auto seating does not create `event_registration`, does not change
  registration statuses, does not touch payment, and does not write
  `event_capacity_units.capacity`.

Explicitly not included in PR 14:

- manual drag/drop, swap, seat-to-pool or any `wireSeatDnD` / `seatDrop` flow
  (PR 15);
- user reserves or `SeatingReserveDialog` (PR 16);
- edit-preserve/reconcile after geometry changes (PR 17);
- capacity summary or capacity sync (PR 18/19).

When an admin chooses to edit tables after auto seating, the UI shows a
confirmation. If confirmed, guests are hidden while editing and the current
assignments remain saved as the current state; full reconcile is intentionally
left for PR 17.

The editor always keeps exactly one `isRabbiTable` in local UI state before
save. A new empty slot starts with one rabbi table. If the selected rabbi table
is removed while other tables exist, the next remaining table becomes the single
rabbi table; the last remaining table cannot be deleted.

Templates remain geometry-only. Save-as-template stores tables, connections and
snapshot canvas metadata through the backend template RPC. It does not store
guests, assignments, the future unplaced pool, reserves, or capacity as source
of truth. Apply-template replaces the current slot's tables/connections and
sets `template_id` only for real user-template UUIDs; built-in choices stay
`null`. Every apply/save path keeps exactly one rabbi table before calling the
write RPC.

### Manual drag/drop (PR 15)

PR 15 adds manual seating on top of the PR 14 auto flow. It ports the v15
prototype's `wireSeatDnD` / `seatDrop` / `persistSeat` / `restoreSeat` behaviour
into pure TypeScript and production React, without mounting prototype HTML or
touching the DOM globally. The pure logic lives in
`apps/admin/src/lib/seatingDragDrop.ts` (`applySeatingDragDrop`) and is covered by
`apps/admin/src/lib/__tests__/seatingDragDrop.test.ts`.

Manual drag/drop is available only in the occupied ("рассадка сделана") view, in
the **current, unchanged geometry**. The drag handlers are wired on the canvas
seats (`SeatingCanvas`) and on the pool chips / pool drop zone
(`SeatingAssignmentsPanel`); the orchestration lives in `SeatingLayoutEditor`.

Supported moves (mirroring the prototype `seatDrop`):

- **pool → free seat** — place an unassigned guest on an empty physical seat.
- **seat → free seat** — move a seated guest to another empty seat.
- **seat → occupied seat** — swap the two seated guests.
- **pool → occupied seat** — seat the dragged guest and return the displaced one
  to "Не рассажены".
- **seat → "Не рассажены"** — unassign a seated guest back to the pool.

Seat validity (rejected as no-ops, surfaced as a short message where useful):

- a drop on the **same** seat is a no-op;
- an ordinary guest cannot be dropped on a **rabbi-reserved** seat; only an
  explicit rabbi guest (an existing rabbi marker in the pool data) may sit there,
  matching auto seating — the editor never invents a rabbi;
- an out-of-range / non-existent seat is rejected;
- a guest already seated cannot be placed a second time (no duplicate
  assignment); each occupied seat holds at most one assignment.

#### One source of truth

The editor keeps a single `assignments` array. The canvas occupants, the
"Не рассажены" panel and the status line all derive from it through
`deriveSeatingAssignmentRestoreState`, so the panel and canvas can never drift
apart. A manual move computes the next array with `applySeatingDragDrop` and feeds
it straight back into the same state; unassigned guests are always
`guestPool − placed assignments`, and the occupied count is the placed
assignments.

#### Manual / locked metadata

A manual placement is marked `placementSource: "manual"` and `locked: true` on the
assignment (and carried on the derived occupant). This is **UI-safe** metadata:
`admin_save_seating_assignments` only reads the known v15 entry keys, so the
markers are sent for client round-tripping and are **not** persisted as DB
columns — no new migration and no new write RPC. Because the marker cannot be
read back from the database, after a reopen the editor treats **every currently
placed assignment as locked** for the next auto seating. That is the documented,
conservative behaviour: a saved arrangement is never silently reshuffled.

#### Persistence

"Сохранить" persists the current `assignments` through the existing
`saveSeatingAssignments()` / `admin_save_seating_assignments` (placed entries in
`chairs[]`, pooled entries in `pool[]`), exactly as PR 14 did — manual moves only
change which entries are placed. Success is shown only after the assignment save
succeeds; a failure keeps the editor in an error state and logs the raw backend
detail to the console. Seat keys are always built from the stable
`client_table_id` (via `seatingSeatKey`), never the volatile DB row id, so manual
placements survive a save → reopen cycle just like auto ones (this is the PR 14
bugfix that PR 15 must not break).

#### Repeat auto seating

Clicking the auto-seating action again after manual placements keeps every
currently placed guest where they are and only seats the still-unassigned pool
guests into the remaining empty seats:

- `autoAssignSeating` accepts `lockedAssignments`; their seats are treated as
  occupied (blocked) and their guests are dropped from the queue;
- the editor passes all currently placed assignments as locked and merges the new
  auto assignments on top;
- ordinary guests still never land on rabbi-reserved seats, and overflow stays in
  "Не рассажены".

Explicitly **not** included in PR 15 (kept for later PRs):

- user reserves, `+ Резерв`, or `SeatingReserveDialog` — **PR 16**;
- edit-preserve / reconcile after a geometry change — **PR 17**;
- capacity summary or capacity sync — **PR 18/19**;
- family/group seating; and no change to `event_capacity_units.capacity`.

### Reserves (PR 16)

PR 16 adds **operational reserves** on top of the manual seating from PR 15. A
reserve is the answer to the "80 physical seats, limit 70" scenario (PLAN §1):
the extra physical seats are slack for the rabbi's guests, the габай, or
unregistered "свои", and a reserve fills one of those seats **without touching the
registration count**.

What a reserve is:

- A **UI-created placeholder** with a human label (`Гость раввина`, `Резерв 1`,
  `Габай`). The `+ Резерв` action next to "Не рассажены" opens
  `SeatingReserveDialog`, which collects only the label.
- It is **not** a registration. A reserve creates **no** `event_registration`, no
  participant, no profile, and no `event_registration_capacity_reservations` row.
  It never changes `event_capacity_units.capacity`.

Data model:

- A reserve is persisted as an `event_seating_assignments` row with
  `assignment_type = 'reserve'`, `registration_id IS NULL`, and the label/initials
  in `guest_label` / `guest_initials`. No migration was needed — PR 7's schema
  already allows `assignment_type in ('guest','reserve')` with a nullable
  `registration_id`, and PR 8/14's `admin_save_seating_assignments` already accepts
  `type='reserve'`, **requires** `registration_id IS NULL` for it, and does **not**
  require capacity-reservation membership for reserves.
- In the editor a reserve lives in the same `assignments` array as a pooled entry
  (`seatKey === null`, `type: "reserve"`) until placed. Its stable identity is the
  assignment `id` (a client `reserve_…` id while unsaved; the DB row id after a
  reopen), used as the pool drag key and for delete.

Behaviour (all through the existing PR 15 drag/drop, `applySeatingDragDrop`):

- **Pool → seat:** a reserve drags onto any free physical seat (source kind
  `reserve`).
- **Seat → seat / swap:** a seated reserve moves or swaps like any occupant
  (generic `seat` source). A reserve can never be on two seats — there is exactly
  one pooled entry per reserve id (a second placement is a `missing_reserve`
  no-op).
- **Seat → pool:** a seated reserve unassigns back to "Не рассажены".
- **Rabbi-reserved seats:** reserves **are** the rabbi/admin reserve, so they are
  allowed onto rabbi-table seats; ordinary registration guests are still blocked
  there (unchanged from PR 14/15).
- **Delete:** the pooled reserve chip has a delete (×) action. Removing a reserve
  never touches registrations; after Save it does not come back.

Counts (status line):

- `occupiedCount` (occupied **registration** seats) is unchanged by reserves — it
  still counts only `type === "guest"` assignments with a `registrationId`.
- A placed reserve **does** occupy a physical seat: the "свободно" (free physical)
  count subtracts reserves, and a small `резервов N` counter is shown when any
  reserve is seated.
- The full capacity summary (physical vs limit formulas) is still **PR 18**, and
  capacity sync is still **PR 19** — this PR only adjusts the existing status line.

Auto seating interaction:

- A repeat auto seating (`Дорассадить свободных`) treats every placed reserve seat
  as **blocked** (it is carried in `lockedAssignments`) and carries unseated
  reserves forward, so auto never removes a reserve.
- Auto seats only registration guests from the unassigned/unlocked pool; it never
  seats a reserve. Donation-only options stay excluded and mapped "Весь шабат"
  still works.

Save / reopen:

- `+ Резерв` → seat → `Сохранить` → reopen restores the seated reserve on the
  canvas with its label/initials; the registration occupied count does not grow.
- Unseated reserves are also persisted (they go to the `pool[]` of
  `admin_save_seating_assignments` as `type='reserve'` entries) and reappear in
  "Не рассажены" after reopen.
- A note/comment field is intentionally **not** included: the backend has no
  metadata column for assignments and adding one would be out of scope for this
  PR. Only the UI label is collected and persisted.

### Edit-preserve / reconcile (PR 17)

PR 17 adds a correct edit-mode cycle so an admin can fix the table figure after a
seating without losing the work: **«Редактировать столы» → гости скрыты → схема
меняется → «Сделать рассадку» / «Вернуться к рассадке» → старая рассадка
восстановлена насколько возможно.** The pure logic lives in
`apps/admin/src/lib/seatingAssignmentReconcile.ts`
(`reconcileSeatingAssignments`) and is covered by
`apps/admin/src/lib/__tests__/seatingAssignmentReconcile.test.ts`. It ports the
spirit of the v15 prototype `applyGeometry(st,{preserveIndex})` /
`seatEditTables` / `seatMakeSeating` behaviour, but reconciles on the **stable
`client_table_id`-based seat keys** rather than positional chair indexes, so a
table that merely moves keeps its occupants while a table that is deleted frees
them.

Edit mode:

- Clicking "Редактировать столы" leaves seating mode (`seatingDone = false`) but
  **does not delete assignments** — they are preserved in editor state and are
  never wiped by an accidental empty `admin_save_seating_assignments`.
- While editing geometry the canvas hides occupants and the panel is
  non-interactive (no drag/drop), so the admin edits tables, not people. Add /
  move / rotate / delete tables and the 2↔3 seat controls work exactly as in the
  layout editor (PR 11).

Reconcile (on "Вернуться к рассадке" or "Сделать рассадку"):

- The physical seats are recomputed for the new geometry, then
  `reconcileSeatingAssignments` reconciles the preserved assignments:
  - seat key still resolves to a seat → **keep** the placement;
  - seat key no longer resolves (table/seat gone) → **return to "Не рассажены"**;
  - seat became rabbi-reserved or is otherwise blocked → ordinary guests are
    returned; **reserves and explicit rabbi guests may stay** on rabbi seats;
  - two placements resolve to the same seat → the higher-priority one stays, the
    other is returned;
  - the same guest/reserve placed twice → the higher-priority placement stays, the
    redundant one is dropped;
  - a guest whose registration is no longer in the active bucket (donation-only,
    cancelled, foreign slot) is surfaced as an orphan and **not rendered as
    occupied**.
- **Manual/locked placements (PR 15) and reserves (PR 16) win every conflict**, so
  a reconcile never reshuffles them. Mapped "Весь шабат" obligations stay valid
  while the bucket obligation exists; donation-only options remain excluded from
  the pool and can never be seated.
- "Вернуться к рассадке" restores only (freed occupants stay in the pool);
  "Сделать рассадку" runs the same reconcile **first** and then auto-seats only the
  still-unassigned / unlocked registration guests into the remaining free seats,
  preserving manual/locked and reserve placements.

Single source of truth and counts:

- `currentAssignments` stays the only source of truth; the canvas, panel and
  status line all derive from it, the unassigned pool is `active guestPool − valid
  placements`, the occupied **physical** count includes guests + reserves, and the
  **registration** occupied count still excludes reserves.
- After a reconcile the editor shows a short status block:
  «После изменения схемы сохранено N посадок, M гостей/резервов вернулись в
  список.» When nothing was lost there is no warning, only a calm success message.
  The full capacity summary is still **PR 18** and capacity sync is **PR 19**.

Persistence:

- A reconcile saves the layout geometry and the reconciled assignments through the
  existing `saveSeatingLayout()` / `saveSeatingAssignments()` — no new migration and
  no new write RPC. The save layout RPC never touches assignments, and the
  assignments payload after reconcile contains only valid entries (reserves remain
  `assignment_type='reserve'`, `registration_id IS NULL`). Success is shown only
  after both relevant saves succeed.

### Capacity summary (PR 18)

PR 18 adds a **display-only** summary to the seating modal so an admin can see,
at a glance, the difference between the physical seats produced by the table
geometry and the registration limit. This is the core of the "limit 70 / 80
physical seats" question (PLAN §1): the two numbers are **independent**, and
editing the table geometry must never change `event_capacity_units.capacity`.

- `capacityLimit` = the registration business limit (the gate for public
  sign-up), read from the bucket. `null` means *без лимита* (no limit).
- `physicalSeatCount` = how many chairs the current geometry yields
  (`geometry.physicalSeatCount`).

The pure math lives in `apps/admin/src/lib/seatingCapacity.ts`
(`computeSeatingCapacitySummary`) and is covered by
`apps/admin/src/lib/__tests__/seatingCapacity.test.ts`. The current modal renders
these numbers through `SeatingMetricsPanel` as compact cards in the right column,
next to the assignments panel, and does no IO. `occupiedSeats` is the bucket's
registration occupancy; `reserveSeats` is the count of reserves currently placed
on physical seats (reserves take a chair but are **not** registration occupancy).

Formulas (all guard a `null` limit before any arithmetic — never `null − число`,
so no `NaN` reaches the UI):

```
seatsNeeded      = occupiedSeats + reserveSeats
freeByLimit      = capacityLimit === null ? null : capacityLimit − occupiedSeats
freePhysical     = max(0, physicalSeatCount − occupiedSeats − reserveSeats)
missingPhysical  = max(0, seatsNeeded − physicalSeatCount)
physicalOverflow = capacityLimit === null ? 0 : max(0, physicalSeatCount − capacityLimit)
```

`null` limit (без лимита):

```
freeByLimit      = null      (not 0, not NaN — the UI prints "без лимита")
physicalOverflow = 0         (nothing to overflow without a limit)
missingPhysical  = computed as usual (still max(0, seatsNeeded − physicalSeatCount))
```

All numeric inputs are sanitised to finite, non-negative values, and a
non-positive or non-finite limit collapses to `null`, so the summary can never
render `NaN` or a negative count.

UI strings (PR 20 presents these as right-column metric cards instead of a long
footer status line):

- normal cards include physical seats, limit, occupied seats, free by limit and
  physically free seats;
- no limit: the limit card shows `∞` / `без лимита` and the `свободно по лимиту`
  card is omitted;
- shortage (`missingPhysical > 0`): a compact red warning appears under the
  cards: `Не хватает физических мест: 68 гостей на 60 стульев`;
- spare physical seats (`physicalOverflow > 0`, no shortage): no extra note — the
  slack simply shows as positive `свободно по лимиту` / `физически свободно`.

PR 18 explicitly did **not**: change `event_capacity_units.capacity`; add a
capacity-sync button; add `admin_update_capacity_unit_limit`; add any migration;
or change the registration / seating-write / auto-seating / drag-drop / reserves
logic. It only reads the existing numbers for display.

### Capacity limit sync action (PR 19)

PR 19 adds one explicit admin action next to the PR 18/20 metrics:
`Обновить лимит слота до количества физических мест`. It appears only when a
selected capacity bucket has a `capacityUnitId`, the loaded layout has more than
zero physical seats, the physical count differs from the current
`event_capacity_units.capacity`, and the current admin UI user can perform admin
actions (`admin` or `event_manager`).

The button never runs automatically. Adding, deleting, moving or rotating tables,
applying/saving templates, saving the layout, auto seating, manual drag/drop and
reserves still leave `event_capacity_units.capacity` unchanged. The only write is
the confirmation dialog's call to `admin_update_capacity_unit_limit`, using the
normal authenticated Supabase client.

Confirmation cases:

```
Сейчас лимит регистрации: 70.
В схеме физических мест: 80.
Увеличить лимит регистрации до 80?
Это откроет 10 новых мест для публичной записи.
```

```
Сейчас лимит регистрации: 80.
В схеме физических мест: 70.
Понизить лимит регистрации до 70?
Это ограничит публичную запись.
```

```
Сейчас лимит регистрации: без лимита.
В схеме физических мест: 64.
Установить лимит регистрации 64?
```

If the physical count is below occupied registration seats, the dialog disables
the confirm action and shows:

```
Нельзя понизить лимит до 60: уже занято 68 мест. Сначала разберите регистрации или добавьте физические места.
```

The backend RPC enforces the same floor, so a crafted client cannot lower the
limit below already occupied seats. On success the seating modal updates its
local capacity summary immediately, the registrations page reloads capacity
analytics, and the existing toast pattern reports success.

### Responsive polish (PR 20)

PR 20 is a web-admin UI polish pass only. It does not change Supabase schema,
RPCs, seating persistence, capacity formulas, registration behavior, auto
seating, manual drag/drop assignment logic, reserves or reconcile formulas.

Responsive modal behavior:

- The seating modal uses a constrained viewport height so the header, top
  toolbar, canvas area, footer shortcut controls and assignments panel remain in
  the same modal flow on smaller windows.
- The canvas area owns its overflow and can scroll independently. The
  assignments panel also scrolls independently, and on narrow screens it moves
  below the canvas instead of squeezing the table geometry.
- Capacity/status metrics live in the right column as compact cards with the
  missing-physical warning and capacity-sync action attached to that block.
- Toolbar/shortcut rows can wrap and scroll within their own namespaced seating
  containers, so they do not overlap the canvas.

Canvas controls:

- The canvas keeps the existing table/chair coordinate model. PR 20 only changes
  the viewport shell around it.
- The canvas has minimal zoom controls (`-`, `+`, percent indicator) and
  `По размеру` fit-to-view. The scroll box size follows the current visual scale,
  so large layouts remain inspectable without changing saved geometry.

Keyboard shortcuts:

- `N` — добавить стол; works only when table editing is allowed.
- `Delete` / `Backspace`: delete the selected table only when table editing is
  allowed, a table is selected, and it is not the last required table.
- `Escape`: cancel current selection/drag/dialog state safely. If nothing inside
  the modal is active, Escape can close the seating modal as before.
- `R`: rotate the selected table by 90 degrees only when table editing is
  allowed.
- Shortcuts are ignored while focus is in `input`, `textarea`, `select` or a
  `contenteditable` element.

Disabled/loading/error states:

- Layout actions are disabled while the modal is loading, saving, auto seating,
  applying/saving/deleting templates, syncing capacity or loading the guest pool.
- Toolbar buttons are also disabled when no table is selected, when seating is
  done/locked, when there is no valid layout, or when deleting would remove the
  last required table.
- Layout loading, layout load failure, guest-pool loading/error and empty guest
  states render as readable inline states instead of relying on crashes or hidden
  failures.

### Field mapping (snake_case RPC ↔ camelCase model)

The read RPC return `to_jsonb(...)` of the DB rows (snake_case); the write RPC
return the same shapes. The service normalises them into the camelCase frontend
model. The table/connection normalisers accept **both** shapes, because a layout's
`tables` jsonb is a snake_case DB row while a template snapshot's `tables` already
use the v15 camelCase shape.

| Model | Frontend (camelCase) | RPC row (snake_case) |
| --- | --- | --- |
| `SeatingLayout` / `SeatingLayoutRow` | `communityId`, `eventId`, `occurrenceId`, `capacityUnitId`, `templateId`, `capacityLimitSnapshot`, `seatingDone`, `createdBy`, `createdAt`, `updatedAt` | `community_id`, `event_id`, `occurrence_id`, `capacity_unit_id`, `template_id`, `capacity_limit_snapshot`, `seating_done`, `created_by`, `created_at`, `updated_at` |
| `SeatingTemplate` | `isBuiltin`, `isActive`, `createdBy`, `snapshot` | `is_builtin`, `is_active`, `created_by`, `snapshot` |
| `SeatingTable` (= geometry type) | `id`, `cx`, `cy`, `w`, `h`, `angle`, `sideSeats`, `isRabbiTable` | `client_table_id`, `cx`, `cy`, `w`, `h`, `angle`, `long_side_seats`, `is_rabbi_table` |
| `SeatingConnection` (= geometry type) | `aTableId`, `aEnd`, `bTableId`, `bEnd`, `x`, `y` | `from_client_table_id`, `from_end`, `to_client_table_id`, `to_end`, `anchor_x`, `anchor_y` |
| `SeatingAssignment` | `layoutId`, `registrationId`, `seatKey`, `guestLabel`, `guestInitials`, `type` | `layout_id`, `registration_id`, `seat_key`, `guest_label`, `guest_initials`, `assignment_type` |

On the way out, `serializeSeatingLayoutPayload` / `serializeSeatingAssignmentsPayload`
rebuild the exact v15 contract (`{ layout, customTables[], tableConnections[],
selectedTableId, seatingDone, activeTemplateId, reserveIds[], capacity, chairs[],
pool[] }`) plus the routing keys, field by field, so unknown extra properties never
leak to the RPC and every contract key is always present with its canonical
default.

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

## Manual browser checklist (PR 12)

Run by the project owner; not executed by Codex.

1. Open web-admin registrations page.
2. Select an event/date with capacity buckets.
3. Click "Схема рассадки".
4. Confirm seating modal opens.
5. Confirm template dropdown shows built-in templates.
6. Select "Пустой конструктор".
7. Confirm empty/default constructor layout is applied safely.
8. Select "П + ряд — праздничная схема".
9. Confirm generated tables appear.
10. Confirm exactly one rabbi table exists.
11. Select "Сетка отдельных столов".
12. Confirm generated grid appears.
13. Move/rotate/change seats on tables.
14. Save current layout as a user template with a custom title.
15. Confirm the new template appears in the dropdown under user templates.
16. Apply the saved user template to the current slot.
17. Confirm guests/assignments are not copied.
18. Delete the user template.
19. Confirm built-in templates cannot be deleted.
20. Confirm `event_capacity_units.capacity` did not change.
21. Confirm registrations table/detail modal/export/refresh still work.
22. Confirm browser smoke was not run by Codex.

## Manual smoke checklist (PR 13)

Not run by Codex. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Select an event/date with capacity buckets.
3. Click "Схема рассадки" for a bucket with registrations.
4. Confirm seating modal opens.
5. Confirm panel "Не рассажены" appears.
6. Confirm real participant/guest names from the selected bucket appear in the
   panel.
7. Confirm initials render correctly for Russian and Latin names.
8. Confirm empty state appears for a bucket without guests.
9. Confirm donation-only options do not create seat guests.
10. Confirm cancelled/rejected/no_show registrations are not shown as active
    guests.
11. Confirm no guests are placed on seats automatically.
12. Confirm no drag/drop behavior is available yet.
13. Confirm no seating assignment rows are created by just opening the modal.
14. Confirm template selector from PR 12 still works.
15. Confirm table editing from PR 11 still works.
16. Confirm `event_capacity_units.capacity` did not change.
17. Confirm registrations table/detail modal/export/refresh still work.
18. Confirm browser smoke was not run by Codex.

## Manual smoke checklist (PR 14)

Not run by Codex. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Select an event/date with capacity buckets.
3. Click "Схема рассадки" for a bucket with registrations.
4. Confirm seating modal opens.
5. Confirm panel "Не рассажены" shows real guests.
6. Confirm button "Сделать рассадку" appears.
7. Click "Сделать рассадку".
8. Confirm guests are placed on physical seats.
9. Confirm initials render on occupied seats.
10. Confirm ordinary guests are not placed at the rabbi table.
11. Confirm rabbi/head seat behavior follows the current data/geometry.
12. Confirm overflow guests remain in "Не рассажены" if seats are insufficient.
13. Confirm no drag/drop behavior is available yet.
14. Confirm no user reserves UI is available yet.
15. Confirm generated assignments persist after save/reopen if backend save is
    in scope and succeeds.
16. Confirm `event_capacity_units.capacity` did not change.
17. Confirm template selector from PR 12 still works.
18. Confirm table editing from PR 11 still works before auto seating.
19. Confirm registrations table/detail modal/export/refresh still work.
20. Confirm browser smoke was not run by Codex.

## Manual smoke checklist (PR 15)

Not run by Claude Code. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open the seating modal for a bucket with guests.
3. Click "Сделать рассадку".
4. Confirm auto seating still works and survives save/reopen.
5. Drag a guest from "Не рассажены" onto an empty seat.
6. Confirm the seat becomes occupied with initials.
7. Drag an occupied seat to another empty seat.
8. Confirm the guest moves.
9. Drag one occupied seat onto another occupied seat.
10. Confirm the two guests swap seats.
11. Drag an occupied seat back to "Не рассажены".
12. Confirm the guest returns to the pool and the seat becomes empty.
13. Save, close, reopen the same bucket.
14. Confirm manual placements are restored.
15. Click "Дорассадить свободных" (repeat auto) after manual placement.
16. Confirm manual/locked placements are preserved and only free seats are filled.
17. Confirm ordinary guests cannot be dropped onto rabbi-reserved seats.
18. Confirm mapped "Весь шабат" still works without slot mismatch.
19. Confirm donation-only options do not enter the pool.
20. Confirm `event_capacity_units.capacity` did not change.
21. Confirm no reserves UI is available yet.
22. Confirm registrations table/detail modal/export/refresh still work.
23. Confirm browser smoke was not run by Claude Code.

## Manual smoke checklist (PR 16)

Not run by Claude Code. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open the seating modal for a bucket with guests and run "Сделать рассадку".
3. Click `+ Резерв`.
4. Create a reserve named `Гость раввина`.
5. Confirm the reserve appears in "Не рассажены" as a distinct (dashed) item.
6. Drag the reserve onto an empty ordinary seat.
7. Confirm the reserve appears on the canvas and occupies one physical seat.
8. Confirm the registration occupied count does not increase.
9. Drag the reserve seat to another empty seat and confirm it moves.
10. Drag the reserve onto an occupied guest seat and confirm the swap works when
    both seats are valid.
11. Drag the reserve back to "Не рассажены" and confirm the physical seat empties.
12. Delete the reserve from the pool.
13. Save, close, reopen the same bucket; confirm the deleted reserve does not
    return.
14. Create and seat another reserve, then Save / close / reopen; confirm the
    reserve assignment is restored with its label/initials.
15. Run "Дорассадить свободных"; confirm the reserve placement is preserved and
    blocks its physical seat, and that only registration guests are auto-seated.
16. Confirm ordinary guests still cannot be dropped onto rabbi-reserved seats,
    while a reserve can.
17. Confirm mapped "Весь шабат" still works without slot mismatch.
18. Confirm donation-only options do not enter the pool.
19. Confirm `event_capacity_units.capacity` did not change.
20. Confirm no capacity summary/sync UI is available yet.
21. Confirm registrations table/detail modal/export/refresh still work.
22. Confirm browser smoke was not run by Claude Code.

## Manual smoke checklist (PR 17)

Not run by Claude Code. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open the seating modal for a bucket with guests.
3. Click "Сделать рассадку".
4. Save, close, reopen, confirm assignments still restore.
5. Drag a guest manually to another seat.
6. Add and seat a reserve.
7. Click "Редактировать столы".
8. Confirm guests/reserves are hidden or disabled while editing geometry.
9. Move a table without changing its seats.
10. Exit edit-mode / return to seating ("Вернуться к рассадке" or "Сделать
    рассадку").
11. Confirm existing placements are preserved.
12. Save, close, reopen, confirm placements are still restored.
13. Click "Редактировать столы" again.
14. Delete or change a table so one assigned seat disappears.
15. Exit edit-mode / return to seating.
16. Confirm the guest/reserve from the missing seat returns to "Не рассажены".
17. Confirm the warning shows how many placements were preserved/returned.
18. Confirm manual/locked placements have priority when still valid.
19. Run "Дорассадить свободных".
20. Confirm preserved manual/reserve placements are not overwritten.
21. Confirm ordinary guests still cannot be placed on rabbi-reserved seats.
22. Confirm mapped "Весь шабат" still works without slot mismatch.
23. Confirm donation-only options do not enter the pool.
24. Confirm `event_capacity_units.capacity` did not change.
25. Confirm no capacity summary/sync UI is available yet.
26. Confirm registrations table/detail modal/export/refresh still work.
27. Confirm browser smoke was not run by Claude Code.

## Manual smoke checklist (PR 18)

Not run by Claude Code. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open the seating modal for a bucket that has a numeric limit and more physical
   seats than the limit (e.g. limit 70, geometry ~80 seats).
3. Confirm the capacity summary line reads like
   `80 физ. мест · лимит 70 · занято N · свободно по лимиту 70−N · физически свободно …`.
4. Confirm the numbers match the toolbar/status counts and the bucket occupancy.
5. Reduce the geometry below the occupied count (delete tables) so guests exceed
   chairs.
6. Confirm the line shows `не хватает N физических мест` and a red warning
   `Не хватает физических мест: X гостей на Y стульев`.
7. Open the modal for a bucket with **no** limit (capacity `null`).
8. Confirm the summary shows `без лимита`, omits `свободно по лимиту`, shows no
   overflow, and renders no `NaN`/negative numbers.
9. Make a seating, add and seat a reserve.
10. Confirm `физически свободно` drops by the number of seated reserves while
    `занято` (registration occupancy) does not change, and a `резервов N`
    segment appears.
11. Confirm the summary is display-only: there is no button to change the limit
    and no capacity-sync action.
12. Confirm `event_capacity_units.capacity` did not change after any of the above.
13. Confirm template selector, table editing, auto seating, drag/drop and
    reserves from earlier PRs still work.
14. Confirm registrations table/detail modal/export/refresh still work.
15. Confirm browser smoke was not run by Claude Code.

## Manual smoke checklist (PR 19)

Not run by Codex. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open seating modal for a bucket where physical seats differ from capacity
   limit.
3. Confirm button "Обновить лимит слота до количества физических мест" is
   visible.
4. For limit 70 / physical 80, confirm dialog warns that 10 new public
   registration seats will open.
5. Confirm after approval the capacity summary shows limit 80.
6. Confirm `event_capacity_units.capacity` changed only after explicit
   confirmation.
7. For physical seats below current limit, confirm dialog warns about lowering
   the limit.
8. If occupied seats exceed physical seats, confirm UI blocks the update and
   backend RPC rejects it.
9. For no-limit bucket, confirm dialog can set numeric limit to physical seats
   without `NaN`.
10. Confirm no auto-sync happens when adding/removing/moving tables.
11. Confirm no service role or Admin API is used in browser code.

## Manual smoke checklist (PR 20)

Not run by Codex. Manual smoke is performed by the project owner.

1. Open web-admin registrations page.
2. Open seating modal on desktop width.
3. Reduce browser height/width and confirm header, canvas, toolbar, footer and
   assignments panel remain usable.
4. Confirm the right column shows compact metric cards, the capacity-sync action
   remains next to them when applicable, and no long capacity/status line remains
   in the footer.
5. Confirm the footer shortcut legend wraps without horizontal overflow.
6. Confirm canvas can be scrolled/fit/zoomed according to implemented behavior.
7. Press N: a table is added only when editing is allowed.
8. Select a table and press R: table rotates only when editing is allowed.
9. Select a table and press Delete/Backspace: table deletes only when editing is
   allowed.
10. Press Escape during selection/drag/dialog states: state cancels safely without
   crash.
11. Focus an input/select and press shortcuts: shortcuts must not fire.
12. Confirm disabled states for no selected table, loading, saving, auto-assign,
   capacity sync, template apply and locked seating modes.
13. Confirm empty/loading/error states are readable.
14. Confirm no backend/network/security changes were introduced.

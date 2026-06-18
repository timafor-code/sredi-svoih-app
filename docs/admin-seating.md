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
- **Later PRs:** user reserves, geometry-change reconcile, capacity summary,
  capacity sync.

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
action (planned for PR 19). A seating save can therefore never silently raise or
lower who may register.

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

**This PR does not change the registration limit.** The service never reads or
writes `event_capacity_units.capacity`. The `capacity` field on the save payload
is accepted for v15 parity only; the RPC ignores it and derives
`capacity_limit_snapshot` server-side (see "Capacity is never changed" above).

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

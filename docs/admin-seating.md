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
database access from `apps/admin`, or direct access to authentication user
records.

## Status

The seating feature is implemented end to end for admin/event-manager use from
the registrations capacity bucket UI:

- FastAPI/PostgreSQL seating persistence through the server-side Admin API;
- typed TypeScript API service layer;
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
- responsive modal polish for smaller admin viewports;
- stable disabled physical seats and disabled-seat editing;
- compact header metrics and redesigned toolbar, right column, and bottom controls;
- auto-fit canvas, animated zoom, and middle-button rubber-band/momentum pan;
- full-list search/filter dialog, click-to-place, and native HTML5 drag/drop;
- template persistence and print representation for disabled seats.

## Manual Tool Boundary

The seating editor remains a manual operational tool. It helps admins build a
physical layout and place guests for one selected slot:
`(event_id, occurrence_id, capacity_unit_id)`.

Manual drag/drop is an explicit administrator operation and may place any
registered participant or guest on a rabbi-table seat. This does not change the
automatic seating algorithm: rabbi seats remain protected from ordinary auto
placement. Capacity reservation and donation business rules are unchanged. The
editor must not auto-create guests, auto-seat empty pools, or
infer missing registrations.

## Backend Architecture

The persisted seating model is split into reusable geometry templates and
concrete layout instances. Production uses one runtime path:

`Admin browser → browser-safe apiClient → FastAPI /admin/seating/* → SQLAlchemy → PostgreSQL`.

Tables:

| Table | Purpose |
| --- | --- |
| `event_seating_layout_templates` | Community-scoped reusable geometry snapshots. |
| `event_seating_layouts` | One layout instance for one `(event_id, occurrence_id, capacity_unit_id)` slot. |
| `event_seating_tables` | Tables in a layout instance. |
| `event_seating_table_connections` | Seams/connections between tables in a layout instance. |
| `event_seating_assignments` | Guest and reserve placements for a layout instance. |

Admin has no direct PostgreSQL, Supabase Admin API, or service-role access.
Authorization is server-side in FastAPI/service logic. Legacy Supabase seating
migrations and RPC artifacts are historical only, not current runtime.

The verified router is `apps/api/app/api/admin/seating.py`:

| Method | Route |
| --- | --- |
| GET | `/admin/seating/templates` |
| GET | `/admin/seating/templates/{template_id}` |
| POST | `/admin/seating/templates/from-layout` |
| DELETE | `/admin/seating/templates/{template_id}` |
| GET | `/admin/seating/layout` |
| POST | `/admin/seating/layout/from-template` |
| PATCH | `/admin/seating/layout` |
| PATCH | `/admin/seating/assignments` |

There is no capacity endpoint under `/admin/seating/*`. Capacity sync is an
explicit confirmed administrator action through the server-side Admin API path;
geometry never changes registration capacity automatically.

## Service And Geometry Layers

`apps/admin/src/services/adminSeatingService.ts` is only a thin re-export of
`adminSeatingApiService.ts`. The API service calls Python FastAPI through
`apiClient`, normalizes snake_case rows into camelCase frontend models, and
serializes the existing payload contract on writes.

API mode keeps these existing v15 payload keys unchanged: `eventId`,
`occurrenceId`, `capacityUnitId`, `layout`, `customTables`, `tableConnections`,
`selectedTableId`, `seatingDone`, `activeTemplateId`, `reserveIds`, `capacity`,
`chairs`, and `pool`.

`apps/admin/src/lib/seatingGeometry.ts` is pure and has no IO. Related pure
helpers handle deterministic auto assignment, drag/drop moves, assignment
reconcile, and display-only capacity math.

## Disabled Physical Seats

A disabled chair stays in `geometry.seats` with `isDisabled = true`; it is never
filtered out, because removal would renumber saved seat indexes/keys and corrupt
assignments. Stable parts per table are `side:a:0` through `side:a:2`,
`side:b:0` through `side:b:2`, `end:a`, and `end:b`. Persistence is
`event_seating_tables.disabled_seat_parts`, represented by frontend
`disabledSeats`.

`geometry.seats.length` is the structural chair count; `physicalSeatCount`
counts active chairs only. Disabled chairs are excluded from physical free-seat
metrics and rabbi-reserve capacity. Disabling/enabling never automatically
changes `event_capacity_units.capacity`; capacity sync remains explicit and
confirmed.

Auto seating skips disabled chairs, drag/drop rejects them, and they are not
click-to-place targets. Disabling an occupied chair returns its occupant to the
pool and removes its seat/locked-manual placement. Reconcile treats
`disabled_seat` as invalid even for manual, locked, and reserve assignments:
physical unavailability beats the normal manual-placement priority.

When the editor is not busy in geometry or completed-seating modes, toggle a
chair by: (1) enabling `Выключение мест` then plain left-clicking; (2) Alt +
left-clicking; or (3) right-clicking. Seat-edit mode takes priority over
click-to-place; Alt and right-click remain direct shortcuts.

## Editor Layout And Canvas Interaction

Header metrics are a compact strip, including `Выключено` when applicable.
`Сохранить схему рассадки` is the primary save action. The right column contains
`Рассадить гостей`, `Дорассадить свободных` after seating is complete, and
`Печать рассадки`. Bottom controls group table actions, selected-table `2 | 3`,
all-tables `2 | 3`, `Выключение мест`, and a shortcut legend on its own row.

Canvas starts in auto-fit and refits geometry/viewport changes while active.
`+`/`−` animate zoom, percentage resets to 100%, and `По размеру` restores
auto-fit and centers. Middle-button panning has rubber-band boundary resistance
and may continue with momentum after release. Table dragging remains distinct;
reduced-motion preference suppresses unnecessary animation.

## Capacity Limit Vs Physical Seats

This invariant must stay true across seating work:

- `capacity_unit.capacity` / `event_capacity_units.capacity` is the business
  limit for public registration.
- `physicalSeatCount` is the active physical-chair count, not total structural
  `geometry.seats.length` after disabled seats exist.
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
uses the current server-side Admin API path only after admin confirmation and
does not change layouts, assignments, registrations, payments, or donations.

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

The portal-based full-list dialog traps focus. Escape closes the child dialog
without closing the parent seating modal. Its header shows total people and total
registrations. Search placeholder is `Имя, трапеза, стол`; `Все`, `Рассажены`,
and `Не рассажены` filters compose with search across display name, source label,
option titles, registration status, payment status, and placement label, never
email or phone. Placement pills show `Стол N` or `Не рассажен`. Seated-member
click reports its table and stays open; unseated-member click selects the guest
for pending placement and closes the dialog.

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
- assignments are saved through `saveSeatingAssignments()` and the server-side
  Admin API; reopening restores saved assignments from the backend.

Click-to-place is the supported non-DnD flow: select an unseated pool/full-list
guest, enter pending placement, click one of the gold free active-chair targets,
and reuse the existing drag/drop domain operation to create an unsaved seating
change. Occupied and disabled chairs are not targets. `Выключение мест` and Alt
toggle take priority; Escape clears pending selection before the modal closes,
and native HTML5 dragstart clears it. Native HTML5 drag/drop remains supported;
reserves remain drag/manual rather than click-to-place.

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

Disabled state survives save → close → reopen through FastAPI/PostgreSQL.
`layout → Сохранить как шаблон → template snapshot → apply template` preserves
disabled stable parts. State is keyed by stable part, so currently valid parts
survive `2 ↔ 3 места/стор.` round-trips without transient array removal.

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

A disabled rabbi chair is unavailable, does not count as an active rabbi
reserve, and cannot hold a reserve placement. Disabling any occupied chair
returns that placement to the pool/reconcile path.

## Edit-Preserve Reconcile

Tables and guests share one workspace. Every committed table mutation (add,
move release, rotate, delete, seat-count change, and disabled-seat toggle)
reconciles the current assignments against the next physical geometry. Guests
whose stable seat keys still resolve remain seated; only occupants whose seats
disappear or become invalid return to `Не рассажены`, with a muted returned-count
message. Dragging a table updates its position live and reconciles only on release.

Applying a ready-made layout while seating exists asks for confirmation, then
persists the new geometry and cleared assignments together. All guests return to
the guest list and reserves remain pooled. There is no separate geometry-edit mode.

A saved disabled seat is invalid with reason `disabled_seat`, including manual,
locked, and reserve placements; it cannot be retained merely because it was a
manual placement.

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

Disabled chairs remain in the printed physical scheme as hollow circles with a
diagonal strike. They have no print number or occupant text; stale/malformed
disabled-chair occupant data is omitted. Their indexes are absent from
`printSeatNumberBySeatIndex`, they create no legend entry, and active numbering
remains contiguous and consistent between scheme and legend. Layouts with no
disabled chairs retain the previous output.

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
33. Verify `Выключение мест` plain click, Alt + click, and right click; confirm
    chair cross-out/re-enable and `Выключено` / physical/free metric updates.
34. Disable an occupied chair; confirm its occupant returns to `Не рассажены`,
    the chair rejects drag/drop and click-to-place, auto seating skips it, and
    re-enabling makes it available without restoring its previous occupant.
35. Verify disable → save → close → reopen preserves disabled chairs; confirm
    registration capacity did not change automatically, warning/sync uses active
    physical seats, and any capacity change still requires confirmation.
36. Verify disabled seat → save layout → save as template → apply template
    retains disabled state, including valid stable parts through `2 ↔ 3 места/стор.`.
37. Verify initial auto-fit, resize/geometry refit, animated `+` / `−`,
    percentage reset to 100%, `По размеру`, middle-button pan,
    momentum/boundary resistance, and separate normal left-button table movement.
38. Verify full-list totals, search, all/seated/unseated filters, `Стол N` /
    `Не рассажен` pills; seated click stays open/reports table; unseated click
    creates pending placement; target click seats; Escape clears; drag/drop works.
39. Verify print preview: disabled chair is hollow/crossed and visible, has no
    number or occupant label, active numbers remain contiguous, legend excludes
    disabled occupants, scheme/legend numbers match, and email/phone are absent.
40. With no disabled chairs, confirm auto seating, party grouping, rabbi
    protection/manual override, reserves, drag/drop, click-to-place, full list,
    save/reopen, print, and capacity sync continue to behave as expected.
41. After auto seating, move, rotate, and switch `2 | 3` without a mode switch;
    guests stay visible and valid placements remain seated.
42. On a fresh layout, manually place a guest before auto seating, save, and reopen;
    the manual placement remains.
43. Apply a ready-made layout while seated; confirm that guests and reserves return
    to their respective pools and no stale placement reappears after reopen.
44. Confirm there is no `Редактировать столы` or `Вернуться к рассадке` control and
    table controls remain available throughout.

## Out Of Scope

- automatic derived/recreated table connections; `feature/admin-seating-derived-connections`
  remains optional/deferred and is not part of v17 mandatory completion;
- capacity reservation business logic changes;
- donation business logic changes;
- seat-by-seat seating assignment export;
- PDF seating chart generation;
- household, surname, or relationship-based party inference;
- advanced preference, demographic, VIP, or generalized optimization models;
- mobile seating or touch drag/drop;
- payment gateway;
- advanced conflict/audit reports.

## Next PR

None mandatory for Admin Seating v17.
`feature/admin-seating-derived-connections` remains an optional/deferred
refinement and is not required for v17 completion.

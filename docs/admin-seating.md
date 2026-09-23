# Admin seating

Admin browser → browser-safe apiClient → FastAPI /admin/seating/* → SQLAlchemy → PostgreSQL.

Production Admin does not directly connect PostgreSQL and has no Supabase Admin API or service-role access. adminSeatingService.ts is a thin re-export of adminSeatingApiService.ts, which calls FastAPI through apiClient. Legacy Supabase migrations/RPC artifacts are history, not runtime. Authorization is server-side FastAPI/service logic.

## Status

Implemented v17: FastAPI/PostgreSQL persistence; stable disabled physical seats; compact header metrics; redesigned chrome; auto-fit canvas; animated zoom; rubber-band/momentum middle-pan; disabled editing; full-list search/filter; click-to-place; native HTML5 drag/drop; disabled-seat templates; disabled print.

## Backend Architecture

Verified router apps/api/app/api/admin/seating.py: GET /templates; GET /templates/{template_id}; POST /templates/from-layout; DELETE /templates/{template_id}; GET /layout; POST /layout/from-template; PATCH /layout; PATCH /assignments.

No /admin/seating/* capacity endpoint exists. Capacity sync is explicit, confirmed, server-side, and geometry never automatically changes registration capacity.

## Disabled Physical Seats

Disabled chairs remain in geometry.seats with isDisabled = true, never filtered: removal renumbers geometry and corrupts keys/assignments. Stable parts: side:a:0, side:a:1, side:a:2, side:b:0, side:b:1, side:b:2, end:a, end:b. Persistence is event_seating_tables.disabled_seat_parts; frontend representation is disabledSeats.

physicalSeatCount counts active physical chairs only. Disabled chairs do not count in physical free metrics or rabbi-reserve capacity. event_capacity_units.capacity never changes automatically. Auto seating skips disabled chairs; drag/drop and click-to-place reject them. Disabling occupied chair returns occupant to pool and removes its manual/locked seat. Reconcile invalidates disabled saved seats even manual, locked, or reserve: disabled invalidity beats manual-placement-wins.

Toggle when editor not busy in geometry or completed mode: (1) Выключение мест then left click; (2) Alt + left click; (3) right click. Toggle mode takes priority over placement; Alt/right-click remain shortcuts.

## Capacity Limit Vs Physical Seats

geometry.seats.length is structural chair count including disabled chairs; geometry.physicalSeatCount is active count. event_capacity_units.capacity is business registration capacity. Занято is guests on active chairs; Свободно по лимиту uses bucket occupancy; Физически свободно is active chairs less guests/reserves. Reserves do not create registrations. Geometry is never a capacity writer; sync remains explicit and confirmed.

## Editor Layout And Canvas Interaction

Header metrics are compact and show Выключено when applicable. Сохранить схему рассадки is primary save. Right side: Рассадить гостей, then Дорассадить свободных after completion, and Печать рассадки. Bottom: table actions, selected-table 2 | 3, all-tables 2 | 3, Выключение мест, shortcut legend row.

Canvas begins auto-fit and refits geometry/viewport changes while active. +/− animate zoom; percentage resets 100%; По размеру restores auto-fit and centers. Middle mouse pan has boundary resistance and release momentum. Table drag remains separate; reduced motion suppresses unnecessary animation.

## Guest Pool, Full List, And Click-To-Place

Не рассажены has only unseated registration guests. Весь список has complete loaded registration roster; reserves are separate non-registration. Portal dialog traps focus; Escape closes child only. Header totals people/registrations. Search placeholder Имя, трапеза, стол; filters Все, Рассажены, Не рассажены compose. Search includes display name, source label, option titles, registration/payment status, placement label; never email/phone. Pills show Стол N or Не рассажен. Seated click reports table and stays open; unseated click closes dialog and selects guest.

Click-to-place: choose unseated guest, enter pending state, free active chairs become gold targets, click target, and existing drag/drop domain operation creates unsaved change. Occupied/disabled seats are not targets. Toggle/Alt take priority; Escape clears pending before modal closes; native drag start clears it. Native HTML5 drag/drop remains supported; reserves remain drag/manual.

## Templates, Reconcile, And Print

Save → close → reopen persists disabled seats through FastAPI/PostgreSQL. layout → Сохранить как шаблон → template snapshot → apply template preserves disabled stable parts; valid parts survive 2 ↔ 3 места/стор. because identity is stable, not array removal. Ordinary auto seating excludes rabbi and disabled seats; reserve placement remains manual. Reconcile never changes capacity.

Print keeps disabled chairs visibly present as hollow circles with diagonal strike, without print number or occupant. Malformed disabled-seat occupants are omitted. Disabled indexes are absent from printSeatNumberBySeatIndex and have no legend entries. Active print numbering stays contiguous and scheme/legend match; email/phone are absent. No-disabled layouts retain previous behavior.

## Manual Smoke Checklist

1. Run automatic seating.
2. Confirm fitting parties sit together.
3. Confirm smaller parties sit together where possible.
4. Confirm remaining guests use eligible seats.
5. Confirm compact party positions.
6. Use party requiring connected tables.
7. Confirm connected tables are preferred.
8. Confirm minimum practical tables.
9. Manually move a guest.
10. Run auto seating again.
11. Confirm manual placement remains.
12. Confirm same-table preference.
13. Repeat with insufficient room.
14. Confirm connected-table preference.
15. Manually place rabbi seat guest.
16. Run auto seating again.
17. Confirm manual rabbi placement remains.
18. Confirm ordinary guests avoid other rabbi seats.
19. Confirm rabbi guest behavior.
20. Confirm rabbi head behavior.
21. Confirm reserves.
22. Confirm shortage pool.
23. Confirm shortage warning.
24. Confirm single-person seating.
25. Confirm full list.
26. Confirm metrics.
27. Save.
28. Close/reopen.
29. Confirm persistence.
30. Confirm print.
31. Confirm native drag/drop.
32. Confirm explicit confirmed capacity sync.
33. Verify Выключение мест plain click, Alt + click, and right click; cross-out/re-enable; Выключено / physical/free metrics update.
34. Verify disabling occupied chair returns it to Не рассажены; disabled chair rejects drag/drop/click-to-place; auto skips it; re-enable does not restore occupant.
35. Verify disable → save → close → reopen; registration capacity did not change automatically; warning/sync uses active physical count; changes require confirmation.
36. Verify disabled seat → save layout → save template → apply template; valid stable parts survive 2 ↔ 3 места/стор.
37. Verify auto-fit, resize refit, animated zoom, percentage reset, По размеру, middle pan, momentum/resistance, distinct left movement.
38. Verify full-list totals/search/filters/pills; seated click stays/reports; unseated click creates pending placement; target seats; Escape clears; native drag/drop works.
39. Verify disabled print: hollow crossed visible chair, no number/occupant; contiguous active numbers; legend exclusion; numbers match; email/phone absent.
40. With no disabled chairs, confirm auto seating, party grouping, rabbi protection/manual override, reserves, drag/drop, click-to-place, full list, save/reopen, print, capacity sync.

## Out Of Scope

Automatic derived/recreated table connections: feature/admin-seating-derived-connections is optional/deferred, not v17 mandatory. Also out: mobile seating, touch drag/drop, PDF library/server PDFs, household/surname/relationship inference, generalized optimization/preferences, payment changes, registration/donation business-rule changes.

## Next PR

None mandatory for Admin Seating v17. feature/admin-seating-derived-connections remains optional/deferred and is not required for v17 completion.

# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

The admin registrations workspace uses the regular authenticated Supabase client. Admin reads and writes stay behind RPC/RLS policies; the browser code must not use privileged server keys, Supabase Admin API, server-only database connection strings, or direct access to `auth.users`.

## Current architecture

- `RegistrationsPage.tsx` owns page state, loading, filtering, pagination, Excel export, toasts, occurrence selection, and registration status actions.
- `apps/admin/src/components/registrations/RegistrationEventsPanel.tsx` renders the events list and event search.
- `RegistrationCapacityBucketsOverview.tsx` renders capacity totals, option stats, and capacity bucket rows from `admin_get_registration_capacity_analytics`.
- `RegistrationsTable.tsx` renders the registrations table. A row click opens the participant detail modal; row action buttons keep their own click handling.
- `RegistrationDetailPanel.tsx` renders participant profile, contacts, event/session data, selected options, guests/comment, payment data, history, and status controls. It is now used inside the modal instead of a permanent right-side panel.

## v15 reference

The UX reference prototype is committed at:

`docs/prototype/registrations-improved-seating-v15.html`

This file is a reference document only. Production code should not copy the prototype's full HTML, CSS, JavaScript, seating editor, drag-and-drop, table templates, persistence, or mock data.

## This PR

- Adds detailed bucket breakdown inside the production "Места и регистрации" card.
- Uses the existing `admin_get_registration_capacity_analytics` service/RPC data as the source of truth for buckets, totals, options, unique guests, multi-meal guests, and donations.
- Shows which participation options contributed to each capacity bucket, including registration count, quantity count, seat count, and contribution percentage.
- Shows remaining/free seats as a separate row in each bucket breakdown.
- Marks donations and `counts_toward_capacity = false` options as "не занимает место" when those rows are present in the analytics payload.
- Adds a lightweight list/chart toggle for bucket breakdowns. The chart uses CSS `conic-gradient`; there is no Chart.js, CDN, or new npm dependency.
- Keeps the v15 layout shell, compact/collapsible capacity card, registration detail modal, row click/Enter behavior, seating placeholder button, export, refresh, pagination, occurrence selector, and status actions unchanged.
- Keeps backend/RPC, seating editor/backend work, Excel export changes, and registration business logic out of production scope.

## v15 capacity card UI

The card header shows "Места и регистрации" with the selected event date/session scope. The card starts in a compact state: quick-pills stay visible, while the detailed area can be expanded or collapsed from the header toggle.

Quick-pills show the main capacity buckets with occupied/capacity values and a progress bar. Buckets near capacity get an attention state. The compact strip also shows unique people and guests that occupy multiple meal/capacity slots when the analytics payload provides those values.

The detailed area has four modes:

- `По слотам мест`: renders one row per capacity bucket with title, key/code, occupied/capacity, remaining seats, fill percent, reservation count, detailed option breakdown, free-seat row, and the existing "Схема рассадки" button.
- `Все места выбранной даты`: renders total occupied seats, total capacity, remaining/free seats, and fill percent. Unlimited/null capacity is displayed as "без лимита" and never as `NaN`.
- `По вариантам участия`: for events with capacity buckets, renders seat-taking rows aggregated from `buckets[].optionBreakdown` so it stays consistent with `По слотам мест`; donation and `counts_toward_capacity = false` options are added as separate non-seat rows.
- `Уникальные гости`: renders unique people/guests, multi-meal guests, sponsors/donations, donation options when present, and total occupied seats with graceful fallbacks for missing analytics fields.

The "Схема рассадки" button remains a safe placeholder. It does not open a seating editor, create backend calls, or persist seating data; it only shows the existing toast that the seating editor will be added in a separate PR.

## Capacity analytics RPC

`admin_get_registration_capacity_analytics` is called from the regular authenticated Supabase client. It is a `security definer` RPC guarded by the event's `admin` / `event_manager` community role checks; browser code must not use service-role credentials or Supabase Admin API for this data.

The RPC returns one row:

- `event_id`
- `occurrence_id`
- `totals`
- `bucket_aggregate`
- `buckets`
- `option_stats`
- `donation_options`

`totals` includes:

- total registrations in the requested event/occurrence scope;
- status counts for `confirmed`, `pending`, `waitlisted`, `cancelled`, `rejected`, `attended`, and `no_show`;
- active registration and active seat counts using the existing capacity-occupied status set: `confirmed`, `pending`, `attended`, `no_show`;
- best-effort unique registered users, unique guest names, and unique people counts;
- multi-meal guest count based on active registrations that reserve more than one capacity unit;
- sponsor/donation counts and quantities;
- legacy scope capacity, remaining/free seats, and fill/free percentages.

`buckets` includes one entry per `event_capacity_units` row:

- `capacityUnitId`, `key` / `code`, and `title`;
- raw capacity unit `capacity` without changing `event_capacity_units.capacity` semantics;
- effective capacity fields based on the current event/occurrence fallback capacity;
- occupied seats from `event_registration_capacity_reservations` plus the read-only fallback described below;
- remaining/free seats, fill/free percentages, reservation/obligation count, option titles, and option breakdown.

Seat occupancy for mapped capacity units uses `event_registration_capacity_reservations` as the primary source of truth. This preserves the current registration flow behavior where one registration can create multiple seat obligations, for example a package option reserving both `friday_dinner` and `shabbat_lunch`.

For legacy/test registrations that have active seat-taking option selections but no matching rows in `event_registration_capacity_reservations`, the RPC builds a read-only fallback obligation from the option-to-capacity-unit mappings in `event_participation_option_capacity_units`. The fallback:

- only considers active registrations (`confirmed`, `pending`, `attended`, `no_show`);
- ignores donation options (`is_donation = true`) and non-capacity options (`counts_toward_capacity = false`), which never create a fallback obligation;
- computes seats with the same model the registration flow uses (`quantity * seats_per_quantity` from the mapping);
- expands a multi-unit option (for example "Весь Шабат") into every mapped capacity unit, so it lands in both `friday_dinner` and `shabbat_lunch`;
- skips any `registration_id` + `option_id` + `capacity_unit_id` triple that already has a real reservation row, so existing reservations are never double-counted.

Because the fallback contributes to the same `occupiedSeats`, `optionBreakdown`, and `optionTitles` outputs, `reservationsCount` is the count of all bucket obligations including fallback obligations, not only physical reservation rows.

The fallback is strictly read-only inside the RPC: it does not insert into `event_registration_capacity_reservations`, does not change `event_capacity_units.capacity`, does not change the registration/cancel/reject flow, and does not affect public registration. After this hotfix, the bucket breakdown work continues in PR #196 (`feature/admin-registrations-bucket-breakdown`).

Donation options and options with `counts_toward_capacity = false` do not occupy seats and do not create capacity reservations. They are returned in `option_stats` and `donation_options` with `isDonation` / `countsTowardCapacity` markers so the UI can display them without counting them as occupied capacity.

This PR does not change the RPC, migrations, RLS, capacity semantics, or browser access pattern. Bucket detail percentages are presentation-level derivations from the existing payload:

- option contribution percent is `optionSeats / occupiedSeats` when occupied seats are known;
- free percent is `remainingSeats / capacity` when a finite capacity is known;
- null/unlimited capacity, zero occupied seats, missing remaining seats, and empty breakdown arrays render without `NaN`.

## Bucket breakdown

Each row in `По слотам мест` now has a scoped `.bucket-breakdown` section labelled "Из чего сложилось".

The default list view renders one row per `optionBreakdown` entry with:

- option title;
- registration count and quantity count;
- occupied seat count;
- percentage contribution inside the bucket;
- donation / non-seat marker when `isDonation` is true or `countsTowardCapacity` is false.

The list also adds a free-seat row when `effectiveRemainingSeats` is available. If the RPC does not return `optionBreakdown`, the UI keeps the bucket totals visible, shows a safe fallback row for occupied seats without option detail when needed, and prints a small note instead of trying to rebuild source-of-truth from registrations on the client.

The chart view is available from the small toggle inside the breakdown when there is at least one positive chart segment. It uses CSS `conic-gradient` and the same rows as the list. Donation/non-seat rows stay visible in the legend but do not add occupied capacity.

## Capacity/options consistency

For bucket-based events, capacity occupancy is owned by `buckets` in the analytics response:

- `По слотам мест` reads `buckets[].occupiedSeats` and `buckets[].optionBreakdown`;
- `По вариантам участия` aggregates seat-taking rows from the same `buckets[].optionBreakdown`;
- `option_stats` / `donation_options` are used in this mode only for donation and other non-seat rows, or as a fallback when the event has no capacity buckets.

This avoids showing a seat-taking participation option as occupied when the selected event/occurrence has zero occupied seats in the bucket source of truth. If a bucket has occupied seats but no option breakdown, the UI shows a "Места без детализации" fallback row instead of rebuilding capacity from registration rows on the client.

## Next seating work

The seating editor, seating data types, backend/RPC/RLS changes, canvas, drag-and-drop, table templates, and save flow should be implemented in separate follow-up PRs.

## Next PR

`feature/admin-registrations-export-v15`

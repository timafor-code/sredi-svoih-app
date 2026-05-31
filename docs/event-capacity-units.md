# Event capacity units

This document describes the backend foundation for capacity buckets inside one
event, plus the registration-time reservations that make those buckets consume
real seats.

## Model

`event_capacity_units` stores named buckets of seats for one event. A unit can
represent a concrete meal, day, or slot: for example `friday_dinner`,
`shabbat_lunch`, or `day1_evening`.

Important fields:

- `event_id`: parent event.
- `key`: stable event-local identifier, unique per event.
- `title` / `description`: admin-facing and user-facing label data.
- `capacity`: optional seat limit for the bucket. `null` means unlimited for
  now.
- `sort_order`: display order.
- `is_active`: lets admins hide or retire a bucket without deleting it.

`event_participation_option_capacity_units` connects an existing participation
option to one or more capacity units. `seats_per_quantity` says how many seats
one selected quantity of that option consumes in that bucket.

The mapping table stores `event_id` and has composite foreign keys back to both
`event_participation_options(id, event_id)` and
`event_capacity_units(id, event_id)`. That keeps every option and capacity unit
inside the same event boundary.

`event_registration_capacity_reservations` stores the durable reservation rows
created when a registration selects mapped participation options. Each row
captures the registration, event, occurrence, capacity unit, option, snapshots
of the unit and option labels, selected quantity, `seats_per_quantity`, and the
final `seats_count`.

Reservations are append-only history for this flow. Cancelling or rejecting a
registration does not delete reservation rows. Occupied-seat checks join back to
`event_registrations` and count only active consuming statuses, so cancelled,
rejected, and waitlisted registrations do not consume capacity-unit seats.

## Admin RPCs

All RPCs require an authenticated caller who has `admin` or `event_manager` role
in the event community. They use the caller session through `auth.uid()` and do
not use `auth.users`, service-role keys, or admin APIs.

### `admin_list_event_capacity_units(p_event_id uuid)`

Returns all capacity units for one event, sorted by
`sort_order asc, created_at asc`.

### `admin_replace_event_capacity_units(p_event_id uuid, p_units jsonb)`

Replaces the full unit list for one event. Existing units can be preserved by
including their `id`; new units omit `id`. Units omitted from the payload are
deleted, and their option mappings are deleted by cascade.

Each unit object accepts:

| Key | Default |
| --- | --- |
| `id` | `null` for a new unit |
| `key` | required |
| `title` | required |
| `description` | `null` |
| `capacity` | `null` |
| `sortOrder` / `sort_order` | array index |
| `isActive` / `is_active` | `true` |

Validation rules:

- `p_units` must be a JSON array.
- `key` and `title` are required and must be non-empty.
- `key` must be unique inside the event.
- `capacity` is either `null` or greater than `0`.
- A provided `id` must already belong to the same `event_id`.

### `admin_replace_option_capacity_units(p_event_id uuid, p_mappings jsonb)`

Replaces all option-to-capacity-unit mappings for one event.

Each mapping object accepts:

| Key | Default |
| --- | --- |
| `optionId` / `option_id` | required |
| `capacityUnitId` / `capacity_unit_id` | required |
| `seatsPerQuantity` / `seats_per_quantity` | `1` |

Validation rules:

- `p_mappings` must be a JSON array.
- The option must belong to the same event.
- The capacity unit must belong to the same event.
- Duplicate option/unit pairs are rejected.
- `seatsPerQuantity` must be greater than `0`.
- Donation and other non-capacity options should not be mapped.

## Examples

### Shabbat

Capacity units:

| Key | Meaning |
| --- | --- |
| `friday_dinner` | Friday night dinner seats |
| `shabbat_lunch` | Shabbat lunch seats |

Participation option mapping:

| Option | Capacity units |
| --- | --- |
| Friday dinner | `friday_dinner` |
| Shabbat lunch | `shabbat_lunch` |
| Whole Shabbat | `friday_dinner`, `shabbat_lunch` |

If `Whole Shabbat` has `seats_per_quantity = 1` for both units, one selected
quantity consumes one Friday dinner seat and one Shabbat lunch seat.

For example, "Весь Шабат" reserves both `friday_dinner` and `shabbat_lunch`.
If either mapped slot is full, registration is blocked even if the other slot
still has room.

### Yom Tov

Capacity units:

| Key | Meaning |
| --- | --- |
| `yomtov_day1_evening` | First evening meal |
| `yomtov_day1_lunch` | First day lunch |
| `yomtov_day2_evening` | Second evening meal |
| `yomtov_day2_lunch` | Second day lunch |

Participation option mapping:

| Option | Capacity units |
| --- | --- |
| Day 1 evening | `yomtov_day1_evening` |
| Day 1 lunch | `yomtov_day1_lunch` |
| Day 2 evening | `yomtov_day2_evening` |
| Day 2 lunch | `yomtov_day2_lunch` |
| Whole Yom Tov | all four units |

For example, "Весь Йом Тов" can reserve every mapped day and meal unit in the
package. The registration succeeds only when every mapped unit has enough
remaining capacity.

## Donations

Donation and sponsorship options do not have capacity-unit mappings. They can
remain in `event_participation_options` for payment or sponsorship flows, but
they do not create capacity reservation rows and should not reserve seats in a
meal/day/slot bucket.

## Registration behavior

`register_for_event_occurrence_with_options(...)` creates capacity reservation
rows for selected options that are non-donation and have
`counts_toward_capacity = true`.

When a selected option has capacity-unit mappings, the RPC aggregates requested
seats per unit, locks the relevant `event_capacity_units` rows, and checks
occupied seats against `coalesce(event_capacity_units.capacity,
event_occurrences.capacity, events.capacity)`. A `null` effective capacity is
treated as unlimited.

When a selected capacity-counting option has no capacity-unit mappings, the RPC
keeps the legacy fallback: its selected quantity counts toward the existing
event/occurrence capacity check. Events and options without any capacity-unit
mappings therefore continue to behave as before.

Existing active registrations are still returned idempotently; the RPC does not
create duplicate option selections or duplicate capacity reservations for an
already active registration. Backfill of older registrations is outside this
PR.

## Admin UI

The web-admin edit form for `internal_paid` events includes a compact "slots"
constructor below participation options. Managers create event capacity units
there and save them through `admin_replace_event_capacity_units`. The
constructor includes quick presets for Shabbat, one-day Yom Tov, and two-day
Yom Tov slots; presets skip keys that already exist.

The option-to-slot relationship is configured inside the add/edit modal for a
participation option. The modal shows active saved slots, and each checked
slot is saved through `admin_replace_option_capacity_units` after
`admin_replace_event_participation_options` returns the saved option rows.

Donation options and options with `counts_toward_capacity = false` are shown as
non-capacity options in the modal and are not mapped. Each checked option/unit
pair currently uses `seats_per_quantity = 1`.

## Out of scope

This PR does not change mobile UI, payment flow, Excel export, legacy event
migration, or backfill older registrations. Admin overview/export changes for
capacity reservations will be handled in separate PRs.

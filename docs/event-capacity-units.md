# Event capacity units

This document describes the backend foundation for capacity buckets inside one
event. It is intentionally limited to schema, RLS, and admin RPCs; actual seat
reservation during registration is planned for a later PR.

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

### Yom Tov

Capacity units:

| Key | Meaning |
| --- | --- |
| `day1_evening` | First evening meal |
| `day1_lunch` | First day lunch |
| `day2_evening` | Second evening meal |
| `day2_lunch` | Second day lunch |

Participation option mapping:

| Option | Capacity units |
| --- | --- |
| Day 1 evening | `day1_evening` |
| Day 1 lunch | `day1_lunch` |
| Day 2 evening | `day2_evening` |
| Day 2 lunch | `day2_lunch` |
| Whole Yom Tov | all four units |

## Donations

Donation and sponsorship options do not have capacity-unit mappings. They can
remain in `event_participation_options` for payment or sponsorship flows, but
they should not reserve seats in a meal/day/slot bucket.

## Admin UI

The web-admin edit form for `internal_paid` events includes a compact
constructor below participation options. Managers can create event capacity
units, save them through `admin_replace_event_capacity_units`, and map active
participation options to active saved units through
`admin_replace_option_capacity_units`.

Donation options and options with `counts_toward_capacity = false` are shown as
non-capacity rows and are not mapped. Each checked option/unit pair currently
uses `seats_per_quantity = 1`.

## Out of scope

This foundation does not change registration behavior yet. The actual seat
reservation and capacity decrement/check during registration will be added in a
separate PR, alongside any reservation table such as
`event_registration_capacity_reservations`.

This PR also does not change mobile UI, payment flow, Excel export, or legacy
event migration.

# Participation options

This document describes the backend schema for event participation and payment options.

## Purpose

Some community events require multiple participation choices rather than a single price.

Examples:
- Full Shabbat in the community
- Friday evening meal
- Shabbat day meal
- Donation: sponsor Shabbat for someone in need
- Holiday packages
- Family or child options

This schema models the choices and the calculated registration selections. It does not implement a production payment gateway.

## Tables

### event_participation_options

Stores the available options for an event.

Important fields:
- `event_id` — parent event
- `title` / `description` — user-facing option text
- `price_amount` / `price_currency` — option price
- `option_type` — participation, meal, package, donation, child, family, other
- `allow_quantity` — whether the user can choose quantity
- `min_quantity` / `max_quantity` — quantity limits
- `is_donation` — marks donation-style options
- `counts_toward_capacity` — whether the option consumes event seats
- `seat_limit` — optional option-level seat limit
- `group_key` — optional grouping key for future UI logic
- `conflicts_with` — JSON array for mutually exclusive options
- `sort_order` — display order
- `is_active` — hides/deactivates an option without deleting it

### event_registration_option_selections

Stores snapshot data for the options selected during registration.

Snapshot fields are required because an admin can later change an option title or price, while the historical registration must keep the original selected values.

Important fields:
- `registration_id` — parent registration
- `option_id` — original option, nullable if deleted later
- `title_snapshot`
- `description_snapshot`
- `option_type_snapshot`
- `quantity`
- `unit_price_amount`
- `total_amount`
- `currency`
- `counts_toward_capacity`
- `seats_count`
- `is_donation`

## Donation and capacity

`is_donation = true` marks an option as a donation or sponsorship option.

`counts_toward_capacity = false` means the option does not occupy seats. For example, “Подарить Шаббат нуждающимся” can add money to the total but should not consume a seat.

## Payment gateway

This schema is not a production payment gateway. It only prepares the event/registration model for calculating selected options and totals.

Actual payment provider integration must be implemented later as a separate backend and security review stage.

## RPC

The backend exposes three RPC functions for participation options. All RPCs run as `security definer` and rely on the calling user's session (no elevated-key usage).

### `list_event_participation_options(p_event_id uuid)`

Public read RPC.

Returns only `is_active = true` options for the given event, sorted by `sort_order asc, created_at asc`.

Access:
- `published` + `public` event: anonymous and authenticated callers
- `published` + `members_only` event: authenticated active member of the event's community
- `admin` / `event_manager` of the event's community: can read options for their own events regardless of status/visibility

Granted to: `anon`, `authenticated`.

### `admin_list_event_participation_options(p_event_id uuid)`

Admin read RPC.

Returns **all** options for the event (including `is_active = false`), sorted by `sort_order asc, created_at asc`. Available only to authenticated `admin` / `event_manager` of the event's community.

Granted to: `authenticated`.

### `admin_replace_event_participation_options(p_event_id uuid, p_options jsonb)`

Admin write RPC.

Replaces the full set of participation options for the event in a single call:
1. Verifies the event exists and the caller is `admin` / `event_manager` of the event's community.
2. Validates that `p_options` is a JSON array.
3. Deletes all existing options for the event.
4. Inserts the new options.
5. Returns the freshly inserted rows sorted by `sort_order asc, created_at asc`.

Each option object accepts both camelCase and snake_case keys:

| Key (camelCase) | Snake_case alias | Default |
| --- | --- | --- |
| `title` | — | required |
| `description` | — | `null` |
| `priceAmount` | `price_amount` | `0` |
| `priceCurrency` | `price_currency` | `'RUB'` |
| `optionType` | `option_type` | `'participation'` |
| `seatLimit` | `seat_limit` | `null` |
| `allowQuantity` | `allow_quantity` | `false` |
| `minQuantity` | `min_quantity` | `1` |
| `maxQuantity` | `max_quantity` | `1` |
| `isDonation` | `is_donation` | `false` |
| `countsTowardCapacity` | `counts_toward_capacity` | `true` |
| `groupKey` | `group_key` | `null` |
| `conflictsWith` | `conflicts_with` | `[]` |
| `sortOrder` | `sort_order` | array index |
| `isActive` | `is_active` | `true` |

Validation rules:
- `title` is required and must be non-empty.
- `priceAmount >= 0`.
- `priceCurrency` must be non-empty.
- `optionType` must be one of `participation`, `meal`, `package`, `donation`, `child`, `family`, `other`.
- `seatLimit` is either `null` or `> 0`.
- `minQuantity >= 1`.
- `maxQuantity >= minQuantity`.
- If `allowQuantity = false`, `minQuantity` and `maxQuantity` must both equal `1`.
- `conflictsWith` must be a JSON array.

Granted to: `authenticated`.

Common errors:
- `Auth required` — no authenticated user.
- `Event not found` — the target event does not exist.
- `Admin role required` — caller is not `admin` / `event_manager` of the event's community.
- `p_options must be a JSON array` — payload is not a JSON array.
- `Option title is required` — an option entry has an empty `title`.
- `Invalid option type` — `optionType` is not one of the allowed values.
- `Invalid quantity limits` — `min_quantity` / `max_quantity` violate the quantity rules.
- `conflictsWith must be an array` — `conflictsWith` is provided but not a JSON array.

## Future PRs

Planned next steps:
- web-admin constructor UI on top of the admin RPCs above
- mobile selection UI for internal paid events
- `registration_with_options` RPC and snapshot insert flow
- admin registration detail with selected options and totals

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

## Future PRs

Planned next steps:
- admin RPC for listing/replacing event participation options
- web-admin constructor UI
- mobile selection UI for internal paid events
- registration-with-options RPC
- admin registration detail with selected options and totals

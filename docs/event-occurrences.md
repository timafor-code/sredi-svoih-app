# Event occurrences

This document describes the backend foundation for events that have one or
many concrete dates or sessions.

## Model

`events` is the parent event/card/series. It owns common public content,
visibility, registration mode, location defaults, and participation options.

`event_occurrences` stores concrete dates/sessions for an event. Each row has
its own `starts_at`, optional `ends_at`, timezone, optional registration
window, optional capacity, waitlist/approval flags, status, and sort order.

In mobile feeds, recurring-like parent events do not use the parent
`events.starts_at` as the user-facing date when active occurrences are
available. The app loads visible active occurrences for `shabbat`, `course`,
`sunday_school`, `holiday`, and permanent parent events, then selects the
nearest occurrence whose `ends_at` (or `starts_at` when `ends_at` is missing) is
not in the past. That occurrence becomes the event's effective date:
`effectiveStartsAt`, `effectiveEndsAt`, and `nextOccurrence`.

This is a read-side auto-archiving behavior for the mobile feed: past
occurrences stop participating in "Upcoming" automatically, without changing
their database status. If a recurring parent has active occurrences but none in
the future, the parent card is hidden from "Upcoming". The parent `events` row
stays `published` because it is the long-lived card/series and may receive new
future occurrences later.

Participation options remain event-level in
`event_participation_options`. A course or holiday can keep one shared option
set while each occurrence tracks its own capacity.

Registrations can store `event_registrations.occurrence_id`.
`register_for_event_occurrence_with_options` is the backend foundation for
creating one authenticated registration against a concrete occurrence with
selected participation option snapshots. Existing mobile UI wiring is
unchanged in this PR: the current `internal_paid` simulation flow still passes
an occurrence when the event has occurrences, while `internal_free` still uses
the legacy event-level `register_for_event` flow.

The new occurrence/options RPC enforces idempotency in the transaction: if the
same user already has an active `pending`, `confirmed`, or `waitlisted`
registration for the same `event_id + occurrence_id`, it returns that row
instead of creating a duplicate. The temporary paid simulation flow remains a
test/dev path and can create multiple rows by design.

## Event kinds

`events.event_kind` classifies the parent event:

| Kind | Meaning |
| --- | --- |
| `single` | Existing one-date event behavior. |
| `course` | One parent course with manually managed dated sessions. |
| `sunday_school` | Sunday school parent event; web-admin can generate weekly concrete dates. |
| `shabbat` | Shabbat parent event; web-admin can generate weekly concrete dates. |
| `holiday` | Admin-created holiday event with manually managed dates and optional registration window. |
| `announcement` | News/announcement-style event, usually `registration_mode = 'none'`; a separate UX may handle announcements later. |

The admin create/edit form accepts `eventKind` / `event_kind` and stores it in
`events.event_kind`. Missing create payloads default to `single`; update payloads
only change `event_kind` when the payload includes `eventKind` or `event_kind`.

Parent/card events that represent an ongoing course, Shabbat series, recurring
container, or similar long-lived card should set `events.is_permanent = true`.
The web-admin form then stores `ends_at = null` for the parent event so it does
not move to a past grouping solely because of an end time. Concrete dated
sessions remain in `event_occurrences`.

## Web-admin occurrence generator

The web-admin "Dates and sessions" constructor keeps the manual date list as the
source of truth and adds a helper generator above it. The generator creates
concrete `event_occurrences` only when an admin presses the button; it is not a
cron job and it does not keep creating future dates automatically.

Generator presets:

- `weekly_shabbat`: weekly Shabbat dates, default Friday 19:00, registration
  Sunday 10:00 through Thursday 16:00, title `Шабат`.
- `weekly_sunday_school`: weekly Sunday school dates, default Sunday 11:00,
  registration from the previous Monday, title `Воскресная школа`.
- `custom_weekly`: custom weekly series with admin-selected weekday, time,
  registration window, title, and capacity mode.

Before saving, the UI previews generated starts, registration windows, capacity,
and marks rows whose `starts_at` already exists in the current drafts. Applying
the generator skips existing `starts_at` values, appends only new drafts,
recalculates `sort_order`, and saves through
`admin_replace_event_occurrences`.

When the web-admin occurrence constructor opens, it also checks loaded remote
occurrences and automatically archives active sessions whose `ends_at` (or
`starts_at` when `ends_at` is missing) is already in the past. This uses the
same authenticated `admin_replace_event_occurrences` RPC flow as manual admin
edits. The parent `events` row is not archived, and
`event_registrations` rows and statuses are not changed.

## Access

Active occurrences are visible when their parent event is visible:

- published public events are readable by anonymous and authenticated callers
- published members-only events are readable by active community members
- community `admin` and `event_manager` roles can read and manage occurrences
  for events in their community

The RPC layer follows the same visibility checks:

- `list_event_occurrences(p_event_id)` returns active visible occurrences
- `admin_list_event_occurrences(p_event_id)` returns all occurrences for one
  event to event managers/admins
- `admin_replace_event_occurrences(p_event_id, p_occurrences)` replaces the
  occurrence list for one event without touching participation options or
  existing registrations
- `register_for_event_occurrence_with_options(...)` creates an authenticated
  registration for one active occurrence and stores selected participation
  option snapshots without changing the legacy `register_for_event` flow

`admin_replace_event_occurrences` accepts both camelCase and snake_case payload
keys. It raises `Cannot delete occurrence with registrations` if a replace
payload omits an existing occurrence that already has registrations.

## Occurrence Registration Backend

`register_for_event_occurrence_with_options` requires a published event, an
active occurrence that belongs to that event, and a caller who can see the
event. `external_link` and `none` registration modes are rejected because they
do not create internal rows.

The capacity order for recurring events is:

1. `event_occurrences.capacity`
2. `events.capacity`
3. unlimited if both values are `null`

Capacity is counted per `occurrence_id`, so two occurrences of the same parent
event have independent totals. The RPC counts existing `confirmed`, `pending`,
and `waitlisted` rows for that occurrence, then inserts the new row inside the
same database transaction while the event and occurrence rows are locked.

Participation options remain event-level. Selected option quantities become
registration seats only when the selected option is not a donation and
`counts_toward_capacity = true`. Donation selections are still saved in
`event_registration_option_selections`, but they store `seats_count = 0`.

For `internal_free`, empty selections or donation-only selections fall back to
one reserved seat. For `internal_paid`, the RPC requires at least one active
non-donation option that reserves a seat, creates the registration as
`pending`, and stores `payment_status = 'pending'`. No Stripe, PayPlus,
Tranzila, checkout, or other payment gateway is implemented here.

## Mobile registration windows

The mobile UI treats event visibility and registration availability as separate
states. A parent event can be `published` and visible in the app while
registration for every concrete occurrence is closed or not yet open.

For `internal_paid` events with occurrences, the detail screen loads active
occurrences and evaluates each occurrence's `registration_opens_at` /
`registration_closes_at` window:

- if at least one occurrence is open, the event CTA remains active and opens
  the paid participation flow;
- if no occurrence is open, the event remains visible, but the registration CTA
  is disabled and explains whether registration opens later, the nearest
  session is closed, or no sessions are available;
- the paid options screen only auto-selects an open occurrence, shows
  unavailable sessions as disabled schedule context, and does not call
  `register_for_paid_event_simulated` when no open occurrence can be selected.

Missing registration window fields are treated as open for active occurrences
in the user-facing UI. Backend validation remains the source of truth for the
final registration attempt.

## Mobile "My registrations"

The profile screen groups "My registrations" by the parent `events.id`.
Recurring courses, Shabbat series, holiday sessions, and other multi-date
events therefore appear as one event card instead of one top-level card per
occurrence.

The mobile "My registrations" screen separates current and past registrations
on the client without changing `event_registrations.status`. A registration is
past when its occurrence `ends_at` or, if missing, `starts_at` is before now.
Registrations without an occurrence use the parent event `ends_at` / `starts_at`
fallback. Rows without a usable date stay in the current tab so the UI does not
hide history by mistake. Past registrations are shown read-only under
`Прошедшие` and do not expose the active cancel action.

Inside a grouped event, the mobile UI shows occurrence-level registrations:
date/time, optional occurrence title, registration status, seat count, guests,
comment, and registration timestamp. Paid registration option snapshots from
`event_registration_option_selections` are shown to the user with their saved
title, quantity, unit amount, line total, currency, capacity flags, and donation
flag. The screen calculates registration and group totals from those snapshots
when a single currency is available.

The temporary paid simulation remains visible as test-only payment metadata:
registrations whose `payment_id` starts with `simulated:` are displayed as
`Test payment` / `Тестовая оплата`. This is only a UI label for the existing
MVP simulation and does not add a production payment gateway.

## Examples

### Course

Parent event: `event_kind = 'course'`, title `Ethics and philosophy course`.

Occurrences:

- May 12, 19:30
- May 19, 19:30
- May 26, 19:30

Participation options are shared by the parent event. Capacity should be
counted separately for each occurrence by
`register_for_event_occurrence_with_options`.

### Sunday school

Parent event: `event_kind = 'sunday_school'`.

It can have one occurrence, manually added Sunday occurrences, or dates created
with the web-admin weekly generator. The database still stores concrete
occurrences only.

### Shabbat

Parent event: `event_kind = 'shabbat'`.

Each weekly Shabbat date is an occurrence. Future automation can create an
occurrence, open registration on Sunday at 10:00, close it on Thursday at
16:00, and set per-occurrence capacity. In this PR the admin generator creates
those concrete dates by button click; scheduled automation is out of scope.

### Holiday

Parent event: `event_kind = 'holiday'`.

The admin creates a separate parent event and can store occurrence-level
registration open/close timestamps. Participation options stay shared on the
event.

### Announcement

Parent event: `event_kind = 'announcement'` and usually
`registration_mode = 'none'`.

This PR does not introduce a separate news module.

## Out of scope

This PR does not add scheduled generation, does not add a payment gateway, and
does not change `register_for_event`.

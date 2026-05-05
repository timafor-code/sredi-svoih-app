# Event occurrences

This document describes the backend foundation for events that have one or
many concrete dates or sessions.

## Model

`events` is the parent event/card/series. It owns common public content,
visibility, registration mode, location defaults, and participation options.

`event_occurrences` stores concrete dates/sessions for an event. Each row has
its own `starts_at`, optional `ends_at`, timezone, optional registration
window, optional capacity, waitlist/approval flags, status, and sort order.

Participation options remain event-level in
`event_participation_options`. A course or holiday can keep one shared option
set while each occurrence tracks its own capacity.

Registrations can now store `event_registrations.occurrence_id`, but the
current mobile registration flow is intentionally unchanged. Future
registration RPCs should attach registrations to an occurrence and count
capacity per occurrence.

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

`admin_replace_event_occurrences` accepts both camelCase and snake_case payload
keys. It raises `Cannot delete occurrence with registrations` if a replace
payload omits an existing occurrence that already has registrations.

## Examples

### Course

Parent event: `event_kind = 'course'`, title `Ethics and philosophy course`.

Occurrences:

- May 12, 19:30
- May 19, 19:30
- May 26, 19:30

Participation options are shared by the parent event. Capacity should be
counted separately for each occurrence in a future registration RPC.

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

This PR does not change mobile registration, does not add scheduled generation,
does not add a payment gateway, and does not change `register_for_event`.

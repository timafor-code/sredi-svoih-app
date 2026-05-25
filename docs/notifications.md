# Notifications domain plan

This document fixes the notification domain architecture before implementation.
It is intentionally a planning document only: this PR must not connect
`expo-notifications`, add notification services, add Supabase migrations, create
device token storage, fetch Expo push tokens, add Edge Functions, or change
events, registrations, contacts, prayer tracker, web-admin, or runtime screens.

## Current preference model

The current user-facing notification settings are stored in
`profile.notification_preferences` and represented by
`ProfileNotificationPreferences`:

- `prayers`
- `shabbat`
- `holidays`
- `candles`
- `events`
- `birthdays`
- `weekly`
- `news`

These booleans are category-level user preferences. They are not a schedule
model, not a delivery log, and not proof that real notifications have been
scheduled. Missing keys should continue to be treated with existing defaults
until a later implementation PR introduces a dedicated schedule layer.

## Source boundaries

Notification planning must use only domain sources that are already allowed for
the signed-in user:

- Hebcal, the selected city, and the user's timezone are the source for Jewish
  calendar calculations, including Shabbat, candle lighting, holidays, weekly
  parsha, and related local reminder times.
- Community contacts come from Supabase only through allowed backend/RPC data.
  The client may use only rows and fields that the backend already returned as
  visible for the current user.
- Local iPhone contacts remain local-only. They may be read only after the user
  grants local contacts permission, and they must not be uploaded to Supabase.
- `events` and `event_occurrences` in Supabase are the source for visible event
  dates and sessions.
- `event_registrations` is the source for event reminders tied to the current
  user's existing registration.
- `profile.notification_preferences` is the source for category opt-in/out.

## Local vs remote boundary

Local notifications are the first implementation track. They are calculated and
scheduled on the device from already-visible data:

- Hebcal-based reminders.
- Candle lighting reminders.
- Shabbat pre-reminders.
- Holiday reminders.
- Weekly parsha reminders.
- Birthday reminders.
- Event reminders for the current user's existing registrations.

Remote push is a later implementation track. It is for backend-initiated events
or community broadcasts:

- New community event.
- Event changed.
- Event cancelled.
- Registration confirmed.
- Registration rejected.
- Waitlist spot available.
- News.

The first local-notification PRs must not create `device_tokens`, request an
Expo push token, or add server push functions.

## Expo Go limits

Local notification UX can be checked in Expo Go for early development of
permissions, settings, and scheduled local reminder behavior.

Remote push cannot be fully validated in Expo Go. Push token registration and
real push delivery require an EAS development build, TestFlight build, or
release build. Device token work should therefore start only in the later push
foundation PR.

## Category plan

| Category | User meaning | Data source | Delivery | Expo Go check | MVP | Defer |
| --- | --- | --- | --- | --- | --- | --- |
| `prayers` | Gentle reminders around prayer-related personal habits or selected prayer times. | MVP should use only local/user-selected prayer reminder settings when they exist. Prayer tracker activity remains private and is not a source for admin notifications. Hebcal/city/timezone may later support time-based prayer windows if explicitly designed. | Local notification. | Yes, local UX only. | Preserve the category as an opt-in preference and keep prayer tracker data out of notification/admin flows. | Detailed prayer schedule rules, streak nudges, social/admin visibility, and any remote prayer push. |
| `shabbat` | Reminders before Shabbat starts and around Shabbat end/Havdalah. | Hebcal plus selected city and user timezone. | Local notification. | Yes. | Pre-Shabbat reminder based on the user's selected city/timezone. | Advanced offsets, multiple reminders, travel-aware city changes, and server-driven Shabbat push. |
| `holidays` | Reminders for Jewish holidays and important Jewish calendar dates. | Hebcal plus selected city and user timezone. | Local notification. | Yes. | Upcoming holiday reminders with conservative default timing. | Complex holiday-specific workflows, admin-authored holiday campaigns, and remote holiday broadcasts. |
| `candles` | Candle lighting reminders for Friday and Yom Tov. | Hebcal candle-lighting times from selected city and user timezone. | Local notification. | Yes. | One candle lighting reminder per relevant date. | Custom offsets per user, multiple household reminders, travel handling, and remote candle alerts. |
| `events` | Reminders about community events the user is already registered for. | Visible `events` / `event_occurrences` plus the current user's `event_registrations`. | Local notification for existing registrations in MVP; remote push later for event lifecycle updates. | Local registration reminder UX can be checked in Expo Go. Remote event push cannot. | Local reminders for active upcoming registrations and occurrences that are already visible to the user. | New community event push, event changed/cancelled push, registration confirmed/rejected push, waitlist available push. |
| `birthdays` | Reminders for visible community birthdays and local iPhone contact birthdays. | Community contacts returned by allowed backend/RPC fields; local iPhone contacts only on device; Hebrew birthday calculations may use Hebcal logic. | Local notification. | Yes. | Reminders for visible community contact birthdays and local-only iPhone contact birthdays. | Uploading iPhone contacts, hidden profile-field lookups, social birthday push, and server-side birthday fanout. |
| `weekly` | Weekly Jewish content such as parsha reminders. | Hebcal plus selected city and user timezone. | Local notification. | Yes. | Weekly parsha reminder with a simple default day/time. | Personalized learning plans, multiple weekly digests, and remote weekly broadcasts. |
| `news` | Community announcements and news. | Later backend/admin news or announcement source; current preference only stores opt-in. | Remote push later. | No for real push; settings UI can be viewed in Expo Go. | Keep the preference stored and documented. | All news delivery, news backend, push token dependency, segmentation, and Edge Functions. |

## Privacy rules

Prayer tracker data is private. Notification work must not read, aggregate, or
show `prayer_activity_logs` for admin notifications or admin-facing reminder
logic.

Birthday reminders based on community contacts may use only contact data that
the backend/RPC has already returned as visible to the current user. The client
must not infer, query around, or reveal hidden birthday/profile fields.

Local iPhone contacts must stay on the device. They must not be uploaded to
Supabase, stored as a community directory source, or sent to backend functions
for notification scheduling.

The app must not use hidden `profiles` fields that RLS or RPC did not return.
If a field is hidden or returned as `null`, notification planning should treat
it as unavailable.

Remote push, when introduced later, must be scoped to explicit backend events
and user preferences. It must not expand visibility of contacts, birthdays,
registrations, profiles, or prayer data.

## Implementation sequence

1. `feature/notifications-local-permission-foundation`
   - Add local notification permission handling and a minimal local foundation.
   - Do not create device tokens or remote push infrastructure.
2. `feature/notifications-schedule-model`
   - Add a client-side schedule model for planned local reminders.
   - Keep it separate from `profile.notification_preferences`.
3. `feature/notifications-hebcal-reminders`
   - Implement Hebcal-based local reminders for Shabbat, candles, holidays, and
     weekly parsha using selected city and timezone.
4. `feature/notifications-birthday-reminders`
   - Implement local birthday reminders from visible community contacts and
     local-only iPhone contacts.
5. `feature/notifications-event-reminders-local`
   - Implement local event reminders for the current user's existing
     registrations and visible occurrences.
6. `feature/notifications-settings-advanced`
   - Add advanced settings such as offsets, quiet hours, and reminder detail
     controls after the core schedule model is stable.
7. `feature/push-device-tokens-foundation`
   - Introduce push token storage and build-only token registration.
   - Validate through EAS development build, TestFlight, or release build, not
     Expo Go.
8. `feature/server-event-push-notifications`
   - Add server-side push for event lifecycle notifications and news:
     new community event, event changed, event cancelled, registration
     confirmed/rejected, waitlist available, and news.

## Manual smoke checklist

Manual smoke is performed by the project owner, not by Codex:

1. Open `docs/notifications.md`.
2. Confirm all 8 current notification categories are documented.
3. Confirm local vs remote push boundary is clear.
4. Confirm Hebcal, contacts, birthdays, and events sources are described.
5. Confirm Expo Go limitations are documented.
6. Confirm next PR roadmap is clear.

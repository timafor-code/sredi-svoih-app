# Notifications domain plan

This document fixes the notification domain architecture and tracks the staged
implementation.

PR #157 created the domain plan only. PR #158
(`feature/notifications-local-permission-foundation`) added the minimal runtime
foundation for local notifications on the device:

- local notification permission status;
- local notification permission request;
- one test local notification;
- cancellation of scheduled local notifications;
- a root foreground notification handler.

PR 3 (`feature/notifications-schedule-model`) added the client-side schedule
model and a compact Profile -> Notifications preview. It introduces
`NotificationScheduleItem` and a planner service that turns current
`profile.notification_preferences` into preview rows for all 8 notification
categories.

PR 4 (`feature/notifications-hebcal-reminders`) adds preview-only Hebcal-based
candidate rows for local reminders:

- candle lighting;
- Shabbat pre-reminders;
- upcoming holidays and significant Jewish dates;
- weekly parsha reminders;
- a conservative prayers preview candidate based on existing zmanim/prayer
  window helpers when available.

PR 5 (`feature/notifications-birthday-reminders`) adds preview-only birthday
candidate rows for local reminders. It uses only already visible community
contact birthday data and already loaded local iPhone birthday contacts from the
client store. It does not load contacts from Profile -> Notifications, request
Contacts permission, upload iPhone contacts, or schedule real iOS reminders.

PR 6 (`feature/notifications-event-reminders-local`) adds preview-only event
candidate rows for local reminders. It uses only current-user registrations and
visible event/occurrence data already loaded in the client store. It does not
load registrations from Profile -> Notifications, read event tables directly,
schedule real iOS reminders, add backend changes, create device tokens, or add
remote push infrastructure.

PR 7 (`feature/notifications-settings-advanced`) adds advanced local reminder
settings to the existing `profile.notification_preferences` JSON:

- reminder offsets and reminder hours for local preview candidates;
- quiet hours settings;
- quiet-hours preview metadata for candidates that fall inside the quiet-hours
  window.

PR 7 still must not schedule real category reminders through
`Notifications.scheduleNotificationAsync`, create device tokens, fetch Expo
push tokens, add Supabase migrations, add Edge Functions, add cron/scheduler
logic, or change prayer tracker privacy. Web-admin, remote push, EAS builds,
and TestFlight remain out of scope.

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
- `candlesReminderOffsetMinutes`
- `shabbatReminderOffsetHours`
- `holidaysReminderHour`
- `weeklyReminderOffsetHours`
- `birthdaysReminderHour`
- `eventsPrimaryReminderOffsetHours`
- `eventsFallbackReminderOffsetHours`
- `quietHoursEnabled`
- `quietHoursStart`
- `quietHoursEnd`

The booleans are category-level user preferences. Advanced numeric/time fields
are local preview settings for when a candidate reminder would fire. They are
not a delivery log, not proof that real notifications have been scheduled, and
not remote push settings. Missing keys should continue to be treated with
existing defaults so old saved profiles remain valid.

PR 3 added a separate client-side schedule preview layer. PR 4 extends that
preview layer for Hebcal-backed categories. PR 5 extends it for birthday
preview candidates from already available contact data. PR 6 extends it for
event reminder candidates from already loaded current-user registrations and
visible event/occurrence data. The preview may mark a category as
`disabled_by_preferences` when the user preference is off, `candidate` when a
future local reminder candidate can be calculated safely, `needs_data` when the
allowed local data cannot provide enough information, or
`unsupported_in_this_pr` for categories that still belong to later PRs. It does
not schedule real local reminders.

## Advanced settings added in PR 7

Advanced settings live inside the existing `profile.notification_preferences`
object. No Supabase migration is required for this PR.

| Field | Default | Normalized range | Used by |
| --- | ---: | ---: | --- |
| `candlesReminderOffsetMinutes` | 60 | 15..180 minutes | Candle lighting preview |
| `shabbatReminderOffsetHours` | 8 | 2..24 hours | Shabbat preview |
| `holidaysReminderHour` | 9 | 6..18 local hour | Holiday preview |
| `weeklyReminderOffsetHours` | 8 | 2..24 hours | Weekly parsha preview |
| `birthdaysReminderHour` | 9 | 6..18 local hour | Birthday preview |
| `eventsPrimaryReminderOffsetHours` | 24 | 2..72 hours | Event preview primary reminder |
| `eventsFallbackReminderOffsetHours` | 2 | 1..12 hours | Event preview fallback reminder |
| `quietHoursEnabled` | `false` | boolean | Preview metadata only |
| `quietHoursStart` | `22:00` | `HH:mm` | Preview metadata only |
| `quietHoursEnd` | `08:00` | `HH:mm` | Preview metadata only |

If a preview candidate's `triggerAt` falls inside quiet hours, PR 7 adds
metadata only:

- `quietHoursEnabled`
- `isInsideQuietHours`

The candidate is not moved, rescheduled, or written to iOS scheduling APIs in
this PR. The Profile -> Notifications screen may show a short "тихие часы" hint
for such preview candidates.

## Source boundaries

Notification planning must use only domain sources that are already allowed for
the signed-in user:

- Hebcal, the selected city, and the user's timezone are the source for Jewish
  calendar calculations, including Shabbat, candle lighting, holidays, weekly
  parsha, and related local reminder times.
- Community contacts come from Supabase only through allowed backend/RPC data.
  The client may use only rows and fields that the backend already returned as
  visible for the current user. Birthday preview treats missing
  `birth_date`/`hebrew_birth_date` as unavailable data.
- Local iPhone contacts remain local-only. They may be read only after the user
  grants local contacts permission, and they must not be uploaded to Supabase.
  Profile -> Notifications may use already loaded local birthday contacts, but
  must not request Contacts permission or load them automatically.
- `events` and `event_occurrences` in Supabase are the source for visible event
  dates and sessions.
- `event_registrations` is the source for event reminders tied to the current
  user's existing registration.
- Profile -> Notifications may use already loaded `useEventsStore` values for
  event preview candidates, but it must not call `loadEvents` or
  `loadMyRegistrations`.
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
- Event reminders for the current user's existing registrations. PR 6 builds
  these only as preview candidates; real local scheduling remains a later PR.

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

The `expo-notifications` config plugin is included for development/release
builds. Expo Go can validate the local permission/test foundation, but it may
not reflect every native config change from app config plugins.

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

1. PR #157 domain architecture document
   - Add this notification domain plan.
   - Define source boundaries, privacy rules, and staged implementation.
2. PR #158 `feature/notifications-local-permission-foundation`
   - Add local notification permission handling and a minimal local test
     foundation.
   - Add a root foreground handler that can show banner/list notifications
     without enabling sound or badge behavior.
   - Do not create device tokens or remote push infrastructure.
3. `feature/notifications-schedule-model`
   - Add a client-side schedule model for planned notification previews.
   - Keep it separate from `profile.notification_preferences`.
   - Add Profile -> Notifications preview rows without scheduling real iOS
     reminders.
4. `feature/notifications-hebcal-reminders`
   - Add Hebcal-based preview candidates for Shabbat, candles, holidays, weekly
     parsha, and the cautious prayers layer using selected city/timezone data.
   - Keep all candidates preview-only. Do not call
     `Notifications.scheduleNotificationAsync` for these categories yet.
5. `feature/notifications-birthday-reminders`
   - Add preview-only birthday reminder candidates from visible community
     contacts and already loaded local-only iPhone contacts.
   - Keep all candidates local-first and privacy-safe. Do not schedule real
     iOS reminders, request Contacts permission, upload contacts, or query
     hidden profile fields.
6. `feature/notifications-event-reminders-local`
   - Add preview-only local event reminder candidates for the current user's
     existing registrations and visible occurrences.
   - Use already loaded client-store data only.
   - Keep candidates occurrence-aware: occurrence registrations stay tied to
     `occurrenceId`, while event-level fallback is only for single or
     non-occurrence events.
   - Do not schedule real iOS notifications in this PR.
7. `feature/notifications-settings-advanced`
   - Add advanced local notification settings for reminder offsets and quiet
     hours.
   - Normalize numeric settings and `HH:mm` quiet-hours values with defaults so
     old saved profiles remain valid.
   - Wire advanced settings into Hebcal, birthday, and event preview planners.
   - Add quiet-hours metadata to preview candidates without rescheduling them.
   - Keep all candidates preview-only. Do not schedule real iOS notifications
     in this PR.
8. `feature/push-device-tokens-foundation`
   - Introduce push token storage and build-only token registration.
   - Validate through EAS development build, TestFlight, or release build, not
     Expo Go.
9. `feature/server-event-push-notifications`
   - Add server-side push for event lifecycle notifications and news:
     new community event, event changed, event cancelled, registration
     confirmed/rejected, waitlist available, and news.

Next PR: `feature/push-device-tokens-foundation`.

## Manual smoke checklist

Manual smoke is performed by the project owner, not by Codex:

1. Open iPhone app in Expo Go.
2. Open Profile -> Notifications.
3. Confirm existing permission status block still works.
4. Confirm existing test local notification action still works.
5. Confirm notification preference toggles still save.
6. Confirm the new "План уведомлений" block is visible.
7. Confirm candles/shabbat/weekly/holidays show candidate or needs-data states,
   not generic unsupported where Hebcal data is available.
8. Confirm birthdays show candidate or needs-data depending on already loaded
   contacts.
9. Open Contacts tab and load community/local contacts if needed.
10. Return to Profile -> Notifications and confirm birthdays preview can use
    already loaded visible data.
11. Open Events / My registrations so registrations are loaded if needed.
12. Return to Profile -> Notifications and confirm events preview can use
    already loaded current-user registrations.
13. Confirm event candidates are occurrence-aware when occurrence data is
    available.
14. Change candles reminder offset and confirm preview time updates.
15. Change event primary reminder offset and confirm event preview time updates
    if event candidates exist.
16. Change birthday reminder hour and confirm birthday preview time updates if
    birthday candidates exist.
17. Enable quiet hours and confirm preview remains stable and shows quiet-hours
    metadata/hint where relevant.
18. Turn off events and confirm event preview becomes disabled.
19. Turn off birthdays and confirm birthday preview becomes disabled.
20. Save preferences and reopen the screen.
21. Confirm advanced settings persist.
22. Confirm no real birthday or event reminders were scheduled automatically.
23. Confirm no iPhone contacts permission prompt appears from Profile ->
    Notifications.
24. Confirm no device tokens, remote push, backend migrations, or prayer
    activity logs were touched.

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

PR 3 (`feature/notifications-schedule-model`) adds the client-side schedule
model and a compact Profile -> Notifications preview. It introduces
`NotificationScheduleItem` and a planner service that turns current
`profile.notification_preferences` into preview rows for all 8 notification
categories.

PR 3 still must not add Hebcal-based scheduling, birthday reminders, event
reminders, remote push, Supabase migrations, device token storage, Expo push
token fetching, Edge Functions, cron/scheduler logic, or changes to events,
registrations, contacts, prayer tracker, web-admin, or server push. Real
scheduling through `Notifications.scheduleNotificationAsync` remains future
work for later local reminder PRs.

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
scheduled. Missing keys should continue to be treated with existing defaults.

PR 3 adds a separate client-side schedule preview layer. The preview may mark a
category as `disabled_by_preferences` when the user preference is off, or
`unsupported_in_this_pr` when the preference is on but the category-specific
planner has not been implemented yet. It does not calculate Hebcal dates, read
contacts, read events, read registrations, or schedule real local reminders.

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
   - Implement Hebcal-based local reminders for Shabbat, candles, holidays, and
     weekly parsha using selected city and timezone.
5. `feature/notifications-birthday-reminders`
   - Implement local birthday reminders from visible community contacts and
     local-only iPhone contacts.
6. `feature/notifications-event-reminders-local`
   - Implement local event reminders for the current user's existing
     registrations and visible occurrences.
7. `feature/notifications-settings-advanced`
   - Add advanced settings such as offsets, quiet hours, and reminder detail
     controls after the core schedule model is stable.
8. `feature/push-device-tokens-foundation`
   - Introduce push token storage and build-only token registration.
   - Validate through EAS development build, TestFlight, or release build, not
     Expo Go.
9. `feature/server-event-push-notifications`
   - Add server-side push for event lifecycle notifications and news:
     new community event, event changed, event cancelled, registration
     confirmed/rejected, waitlist available, and news.

Next PR: `feature/notifications-hebcal-reminders`.

## Manual smoke checklist

Manual smoke is performed by the project owner, not by Codex:

1. Open iPhone app in Expo Go.
2. Open Profile -> Notifications.
3. Confirm existing permission status block still works.
4. Confirm existing test local notification action still works.
5. Confirm notification preference toggles still save.
6. Confirm the new "План уведомлений" block is visible.
7. Confirm all 8 categories appear in the preview.
8. Turn off one preference and confirm preview marks it disabled.
9. Save preferences and reopen the screen.
10. Confirm preview reflects saved preferences.
11. Confirm no real Hebcal, birthday, contact, or event reminders were
    scheduled by this PR.

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

PR 7 did not schedule real category reminders through
`Notifications.scheduleNotificationAsync`, create device tokens, fetch Expo
push tokens, add Supabase migrations, add Edge Functions, add cron/scheduler
logic, or change prayer tracker privacy. Web-admin, remote push, EAS builds,
and TestFlight stayed out of scope.

PR 8 (`feature/push-device-tokens-foundation`) adds the safe foundation for
future remote push registration:

- `public.device_tokens` storage with RLS scoped to the current `auth.uid()`;
- authenticated RPCs for upserting and deactivating only the current user's
  Expo push token;
- a client service that can request/get an Expo push token only after an
  explicit user action;
- a Profile -> Notifications device block that reports Expo Go/EAS runtime
  limitations without sending remote push.

PR 8 still does not send push notifications, add an Edge Function, add server
fanout, add a queue, add cron/scheduler logic, run EAS, or run TestFlight.

PR 9 (`feature/server-event-push-notifications`) adds the server-side push
outbox foundation for future event/news remote push:

- `public.push_notification_jobs` as an audit-friendly queue for push jobs;
- `public.push_notification_deliveries` as per-device delivery rows sourced
  from active `device_tokens`;
- authenticated admin/event-manager RPCs for enqueue/list/get/cancel flows;
- recipient selection for event registrants through existing event,
  registration, membership, and device-token data.

PR 9 still does not send remote push, call the Expo Push API, add an Edge
Function, add a queue worker, add cron/scheduler logic, use privileged browser
credentials, or change mobile UI. `supabase/functions/` is currently untracked
in the workspace and must not be touched by this PR.

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

## Push token foundation added in PR 8

Device token rows belong only to the signed-in user. The table stores:

- `user_id` as the owner, always tied to `auth.uid()` by RPC/RLS;
- `platform`, `push_provider = 'expo'`, `expo_push_token`, optional
  `device_id`, app/build versions, and environment;
- `is_active`, `last_seen_at`, `created_at`, and `updated_at`.

The client uses only the normal authenticated Supabase client. It does not use
admin credentials and does not write a `user_id` supplied by the app. The
`upsert_my_device_token(...)` RPC derives `user_id` from `auth.uid()`, upserts
by `(auth.uid(), expo_push_token)`, marks the row active, and refreshes
`last_seen_at`. The `deactivate_my_device_token(...)` RPC can deactivate only
the current user's matching token.

Profile -> Notifications does not request a push token on screen open and does
not register a token on sign-in. Token registration happens only when the user
taps "Зарегистрировать это устройство".

## Server push outbox foundation added in PR 9

Remote push now has a database-side foundation, but no sender yet.

The intended flow is:

1. A user explicitly registers a device token through the PR 8 device-token
   RPCs.
2. An authorized `admin` or `event_manager` calls
   `admin_enqueue_event_push_notification(...)` for an event.
3. The database creates one `push_notification_jobs` row and per-device
   `push_notification_deliveries` rows for active Expo device tokens belonging
   to active event registrants.
4. A future sender reads queued delivery rows from a dedicated backend-only
   path and sends them to Expo.
5. That future sender writes Expo ticket/receipt state back to the delivery
   rows.

Admin list/get RPCs expose job metadata and delivery counts/status totals only.
They do not expose raw Expo push tokens. Direct table access is intentionally
closed to normal authenticated clients; admin visibility goes through RPCs and
the existing `has_community_role(..., array['admin', 'event_manager'])` role
model.

The current enqueue RPC is intentionally narrow: it creates event-registrant
jobs for `event_created`, `event_updated`, and `event_cancelled`. The table
schema reserves `news`, `manual`, single-user, and community-member audiences
for later work, but this PR does not add a news sender, community broadcast UI,
or token-revealing server API.

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

Remote push delivery is a later implementation track. It is for
backend-initiated events or community broadcasts:

- New community event.
- Event changed.
- Event cancelled.
- Registration confirmed.
- Registration rejected.
- Waitlist spot available.
- News.

PR 8 creates only the device token foundation. PR 9 adds the database outbox,
delivery rows, and admin RPCs for event push jobs. Neither PR sends remote push,
calls Expo, adds an Edge Function, or adds a server push sender.

## Expo Go limits

Local notification UX can be checked in Expo Go for early development of
permissions, settings, and scheduled local reminder behavior.

The `expo-notifications` config plugin is included for development/release
builds. Expo Go can validate the local permission/test foundation, but it may
not reflect every native config change from app config plugins.

Remote push cannot be fully validated in Expo Go. Expo push token registration
and real push delivery require an EAS development build, TestFlight build, or
release build. In Expo Go, the app should show a clear unavailable/missing
runtime status instead of crashing. Real token registration verification belongs
to EAS development build/TestFlight.

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
   - Add `device_tokens` storage, RLS, and authenticated RPCs for current-user
     token upsert/deactivation.
   - Add a client push token service and explicit Profile -> Notifications
     device registration action.
   - Keep remote push sending, Edge Functions, queues, cron/scheduler logic,
     EAS, and TestFlight out of scope.
   - Validate real token registration later through EAS development build,
     TestFlight, or release build, not Expo Go.
9. `feature/server-event-push-notifications`
   - Add the server-side push outbox foundation for future event/news remote
     push delivery.
   - Create `push_notification_jobs` and `push_notification_deliveries` with
     RLS, strict direct access, and admin/event-manager RPCs.
   - Enqueue event-registrant delivery rows from active `device_tokens`.
   - Keep Expo sending, Edge Functions, queue workers, cron/scheduler logic,
     web-admin UI, mobile UI, EAS, and TestFlight out of scope.

The historical Supabase sequence above is superseded for the API migration by
PR 32I. The next planned PR is PR 33:
`feature/mobile-admin-feedback-device-api-switch`.

## Manual smoke checklist

Manual smoke is performed by the project owner, not by Codex:

1. Open Supabase Studio.
2. Confirm `push_notification_jobs` exists.
3. Confirm `push_notification_deliveries` exists.
4. Confirm RLS is enabled on both tables.
5. Confirm `admin_enqueue_event_push_notification` exists.
6. As an authorized admin/event_manager, enqueue a test event push job for an
   event with active registrations and active device tokens.
7. Confirm a job row is created.
8. Confirm delivery rows are created for active device tokens only.
9. Confirm raw Expo tokens are not exposed through admin list/get RPCs.
10. Confirm no Edge Function was added.
11. Confirm no real push was sent.
12. Confirm `supabase/functions/` untracked files were not touched.

## API Event Push Pipeline (PR 32I)

PR 32I implements a backend-only event-registrant push pipeline. It does not
change mobile or web-admin UI, enqueue automatically from event changes, add
campaigns or scheduling, or send a real push during automated checks.

An authorized community `admin` or `event_manager` explicitly creates a job
for one event, optionally narrowed to one occurrence. Recipients are distinct
users with `pending`, `confirmed`, or `waitlisted` registrations, then one
delivery per active Expo device token in the configured token environment.
Tokens from development, preview, production, and unknown environments are not
mixed. `profile.notification_preferences.events = false` excludes a recipient;
a missing `events` key remains enabled under the current default.

The worker claims queued jobs with database row locking, submits deliveries to
Expo in batches of at most 100, and stores only ticket identifiers and
normalized delivery state. A transport error, HTTP 429, or HTTP 5xx is retried
with bounded exponential backoff and leaves unsent delivery rows eligible for a
later attempt. Permanent HTTP request failures and permanent ticket failures
are finalized without an indefinite retry loop. Successfully ticketed rows are
never sent again.

Expo tickets mean the request was accepted by Expo; they do not prove device
delivery. After the configured delay (15 minutes by default), the worker checks
up to 1000 ticket ids per receipt request. Receipt success moves a delivery to
`receipt_checked`; an omitted/not-yet-ready receipt remains pending for a later
check and is deferred for another full receipt-delay interval. A retryable
receipt-provider failure also leaves selected deliveries pending and defers them
for that interval rather than polling the same rows every worker cycle. Full raw
ticket and receipt responses are never stored.

`DeviceNotRegistered` from a ticket or receipt marks that delivery failed with
a normalized error and soft-deactivates the linked device token. The row is not
deleted, so the existing current-user device-token endpoint can reactivate it.
Temporary provider failures do not deactivate a token.

The worker is enabled only through backend configuration and runs as the
`api_push_worker` Compose service behind the `push` profile. `API_PUSH_ENABLED`
defaults to `false`; production additionally requires
`API_PUSH_PRODUCTION_SIGNOFF=true`. Production push remains disabled until the
project owner records explicit sign-off. Real delivery verification requires an
EAS development build, TestFlight, or release build and is not performed by the
agent.

Logs may contain job ids, counts, normalized statuses, normalized Expo error
codes, and request ids. They must not contain tokens, notification title/body/
data, recipient PII, registration comments, access tokens, or raw provider
responses.

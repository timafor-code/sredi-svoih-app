# Prayer Tracker

The Prayer Tracker MVP stores personal activity history for prayers, Shema, and Omer counting in `public.prayer_activity_logs`.

## Privacy Model

Prayer activity is private user data. The table has row level security enabled, and the only MVP policies are own-row `select`, `insert`, and `update` for `authenticated` users where `user_id = auth.uid()`.

Admins and community managers do not receive any special access to `prayer_activity_logs`. There is no delete policy in this foundation.

## Python API Migration (PR 32C)

PR 32C adds the backend-only authenticated current-user API routes
`GET /me/prayer-logs`, `POST /me/prayer-logs`,
`DELETE /me/prayer-logs/{log_id}`, and `GET /me/prayer-summary`. Every route
uses the standard API response envelope and is strictly scoped to the current
user; no request accepts `user_id`, and a foreign log is not visible or
deletable.

The list accepts inclusive `from_date`/`to_date` filters in `YYYY-MM-DD` and a
limit of `1..500` (default `100`). POST accepts only the stable snake_case log
fields, timezone-aware ISO timestamps, and JSON objects for `hebrew_date` and
`metadata`. It upserts by user, activity date, and activity type: it derives a
missing activity date in the supplied IANA timezone, preserves omitted start,
completion, and city values on an existing log, and merges incoming JSON object
keys over the existing objects. The summary returns the matching total logs,
distinct active days, all six activity counts (including zero values), and
first/last matching activity dates.

Prayer data is private personal religious-practice data. No administrator,
event manager, community manager, members endpoint, or community aggregate has
additional access; there is no admin prayer route, leaderboard, social sharing,
shared progress, or streak sharing. Prayer details are not logged. This PR does
not switch the mobile provider or modify the legacy Supabase service; PR 32D,
`feature/mobile-prayer-tracker-api-switch`, performs that separate switch.

## Connected UI Actions

The app now records Prayer Tracker activity from:

- the prayer cards on the Prayers screen
- the active prayer card on Home
- the shared morning Shema deadline card on Home and the Prayers screen
- the Omer counting modal when Omer is available

Home and the Prayers screen now share the same prayer window card and active prayer record UX through `PrayerActionModal`. If the signed-in user already recorded the current active prayer for today's local activity date, the modal shows the disabled state `Помолился` instead of recording again, and the active prayer card reflects that state.

Home and the Prayers screen also share `MorningShemaCard`. It records `activity_type = shema_morning`, reads the recorded state from `prayer_activity_logs`, shows the `Прочитал` badge on the card, and reopens the modal in the disabled `Прочитал` state for the same local activity date.

### Omer Modal

The Omer modal records `activity_type = omer_count`. On open, it reads the current local `activity_date` from `prayer_activity_logs` for the selected city/timezone. If a row already exists for the signed-in user, the button is disabled with `Посчитано` and the modal shows `Сегодня уже посчитано`. DB uniqueness remains `user_id + activity_date + activity_type`.

### Omer Count Card

`OmerCountCard` is a reusable Omer count entry card. It is currently rendered only on the Prayers tab, and tapping it opens the existing Omer modal. The background fill is calculated as `day / 49`. The card appears only for Omer days `1...49`; on day 50 it hides automatically because `getOmerInfo` should no longer return an active Omer day, and the component also guards against values outside that range.

## Zmanim City

The city used for zmanim is stored locally on the device in the settings store, so it works without sign-in. On first use the Prayers screen attempts to detect the city through Expo GPS. A supported GPS city is applied automatically, while an unsupported GPS result is kept out of the active zmanim calculation and the user is asked to choose from the supported list.

Manual selection has priority over GPS and is not overwritten by later automatic GPS checks. Tapping a supported city in the city picker applies and persists it immediately; there is no separate Save button. The city picker modal includes a GPS action so the user can switch back to GPS explicitly. The supported list is exported from `SUPPORTED_ZMANIM_CITIES` in `src/lib/zmanim.ts`.

Manual smoke checklist:

- [ ] Open the Prayers tab.
- [ ] Check that the city appears next to the date as a tappable element.
- [ ] Tap the city and confirm that `CityPickerModal` opens in the same visual style as `ZmanimModal`.
- [ ] Pick Moscow / Jerusalem / Tel Aviv and confirm the modal closes immediately.
- [ ] Reopen the modal and confirm the checkmark is on the selected city.
- [ ] Close and reopen the app, then confirm the city is still saved without sign-in.
- [ ] Confirm zmanim, `OmerCountCard`, and `PrayerDayScale` recalculate for the selected city.
- [ ] Tap the GPS action and verify supported-city, denied-permission, and manual-priority behavior.
- [ ] Confirm the Save button is no longer shown.

## Time Gates

Prayer cards can be recorded only during their active window. Past and future prayers remain visible on the Prayers screen, but they are not available for recording.

The Home prayer card also opens recording only for the currently active prayer. Future or inactive prayer cards are blocked with a calm unavailable message.

The morning Shema card is shown only until the daily GRA Shema deadline, then hides on every screen that renders the shared component. The urgency UI uses the elapsed sunrise-to-GRA-Shema window: 0%-70% green, 71%-90% orange, 91%-99% red with a soft pulsing glow, and 100% hidden. Evening Shema remains a supported stored activity type for future UI.

Supported activity types:

- `shacharit`
- `mincha`
- `maariv`
- `shema_morning`
- `shema_evening`
- `omer_count`

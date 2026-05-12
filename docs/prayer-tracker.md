# Prayer Tracker

The Prayer Tracker MVP stores personal activity history for prayers, Shema, and Omer counting in `public.prayer_activity_logs`.

## Privacy Model

Prayer activity is private user data. The table has row level security enabled, and the only MVP policies are own-row `select`, `insert`, and `update` for `authenticated` users where `user_id = auth.uid()`.

Admins and community managers do not receive any special access to `prayer_activity_logs`. There is no delete policy in this foundation.

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

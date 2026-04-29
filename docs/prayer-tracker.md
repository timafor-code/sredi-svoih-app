# Prayer Tracker

The Prayer Tracker MVP stores personal activity history for prayers, Shema, and Omer counting in `public.prayer_activity_logs`.

## Privacy Model

Prayer activity is private user data. The table has row level security enabled, and the only MVP policies are own-row `select`, `insert`, and `update` for `authenticated` users where `user_id = auth.uid()`.

Admins and community managers do not receive any special access to `prayer_activity_logs`. There is no delete policy in this foundation.

## Connected UI Actions

The app now records Prayer Tracker activity from:

- the prayer cards on the Prayers screen
- the active prayer card on Home
- the morning Shema deadline card on Home
- the Omer counting modal when Omer is available

Home and the Prayers screen now share the same active prayer record UX through `PrayerActionModal`. If the signed-in user already recorded the current active prayer for today's local activity date, the modal shows the disabled state `Помолился` instead of recording again, and the active prayer card reflects that state.

## Time Gates

Prayer cards can be recorded only during their active window. Past and future prayers remain visible on the Prayers screen, but they are not available for recording.

The Home prayer card also opens recording only for the currently active prayer. Future or inactive prayer cards are blocked with a calm unavailable message.

The morning Shema card is shown on Home only until the daily GRA Shema deadline. Evening Shema remains a supported stored activity type for future UI.

Supported activity types:

- `shacharit`
- `mincha`
- `maariv`
- `shema_morning`
- `shema_evening`
- `omer_count`

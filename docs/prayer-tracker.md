# Prayer Tracker

The Prayer Tracker MVP stores personal activity history for prayers, Shema, and Omer counting in `public.prayer_activity_logs`.

## Privacy Model

Prayer activity is private user data. The table has row level security enabled, and the only MVP policies are own-row `select`, `insert`, and `update` for `authenticated` users where `user_id = auth.uid()`.

Admins and community managers do not receive any special access to `prayer_activity_logs`. There is no delete policy in this foundation.

## Connected UI Actions

The app now records Prayer Tracker activity from:

- the prayer cards on the Prayers screen
- the morning Shema deadline card on Home
- the Omer counting modal when Omer is available

Supported activity types:

- `shacharit`
- `mincha`
- `maariv`
- `shema_morning`
- `shema_evening`
- `omer_count`

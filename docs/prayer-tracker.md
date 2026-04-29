# Prayer Tracker

The Prayer Tracker MVP stores personal activity history for prayers, Shema, and Omer counting in `public.prayer_activity_logs`.

## Privacy Model

Prayer activity is private user data. The table has row level security enabled, and the only MVP policies are own-row `select`, `insert`, and `update` for `authenticated` users where `user_id = auth.uid()`.

Admins and community managers do not receive any special access to `prayer_activity_logs`. There is no delete policy in this foundation.

## Later UI Actions

Future prayer, Shema, and Omer UI actions can record these activity types:

- `shacharit`
- `mincha`
- `maariv`
- `shema_morning`
- `shema_evening`
- `omer_count`

# Среди Своих

Production-oriented bootstrap Expo React Native приложения по прототипу `docs/prototype/sredi-svoih.html`.

## Стек

- Expo + TypeScript
- expo-router
- Zustand
- Supabase/PostgreSQL (подготовлено)
- @hebcal/core (абстракция подготовлена)
- expo-contacts / expo-notifications (абстракции подготовлены)

## Запуск

```bash
npm install
npx expo start
```

Приложение запускается в mock режиме даже без Supabase env keys.

## Production provider cutover

The Python API is the default production provider for migrated mobile domains.
Production and Expo Go deployments therefore require a reachable
`EXPO_PUBLIC_API_URL`; use the development computer's LAN address for Expo Go
on an iPhone.

```text
EXPO_PUBLIC_AUTH_PROVIDER=api
EXPO_PUBLIC_EVENTS_PROVIDER=api
EXPO_PUBLIC_REGISTRATIONS_PROVIDER=api
EXPO_PUBLIC_PRAYER_PROVIDER=api
EXPO_PUBLIC_CONTACTS_PROVIDER=api
EXPO_PUBLIC_AVATAR_PROVIDER=api
EXPO_PUBLIC_DEVICE_PROVIDER=api
```

Supabase URL and publishable-key configuration remains only for the explicit
legacy/dev fallback. Setting one individual provider to `supabase` opts just
that domain into the legacy implementation; API request failures do not retry
through Supabase. Supabase code and historical migrations remain intentionally
until PR 38 removes Supabase from the production runtime.

## Структура

- `app/` — маршруты и экраны
- `src/` — компоненты, store, data, lib, services
- `supabase/` — SQL migration и seed
- `docs/` — заметки по архитектуре и privacy

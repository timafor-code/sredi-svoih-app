# Среди Своих

Production-oriented bootstrap Expo React Native приложения по прототипу `docs/prototype/sredi-svoih.html`.

## Стек

- Expo + TypeScript
- expo-router
- Zustand
- Python API + PostgreSQL
- @hebcal/core (абстракция подготовлена)
- expo-contacts / expo-notifications (абстракции подготовлены)

## Запуск

```bash
npm install
npx expo start
```

Приложение запускается в mock режиме без production API configuration.

## Production runtime

Mobile production uses only the Python API. Configure a reachable
`EXPO_PUBLIC_API_URL`; Expo Go on an iPhone must use the development computer's
LAN address. Authentication, events, registrations, prayer, contacts, privacy,
push tokens, and avatars never fall back to another frontend provider.

Avatar upload, read, and deletion use the Python API with API-configured
S3-compatible object storage. The frontend requires no Supabase URL, anon key,
Auth, RPC, RLS, Storage, or provider flags. Historical `supabase/migrations/**`
are retained as a migration archive, and owner-run `scripts/migration/**` may
retain documented migration-only access; neither is part of production runtime.

## Структура

- `app/` — маршруты и экраны
- `src/` — компоненты, store, data, lib, services
- `supabase/` — SQL migration и seed
- `docs/` — заметки по архитектуре и privacy

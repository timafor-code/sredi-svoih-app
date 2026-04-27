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

## Структура

- `app/` — маршруты и экраны
- `src/` — компоненты, store, data, lib, services
- `supabase/` — SQL migration и seed
- `docs/` — заметки по архитектуре и privacy

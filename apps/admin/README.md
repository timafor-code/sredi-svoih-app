# Среди Своих Admin Center

`apps/admin` содержит web-админку проекта «Среди Своих» на Vite, React и TypeScript.

В текущем состоянии админка использует Supabase Auth в браузере, загружает профиль пользователя и активное membership, а затем открывает visual shell только для ролей `admin` и `event_manager`. Реальные события, импорт, регистрации и backend-операции управления пока не подключены.

Source of truth для полного UX остаётся `docs/prototype/admin-events-center.html`.

## Environment

Создайте локальный файл:

```bash
cp apps/admin/.env.example apps/admin/.env.local
```

Заполните:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

В репозиторий нельзя добавлять реальные значения из локального окружения. `apps/admin` использует только browser-safe anon/publishable key. Серверные ключи повышенных прав и серверные административные методы Supabase в браузере не используются.

Реальные права доступа всё равно должны проверяться на стороне Supabase через RLS/RPC и отдельные backend-контракты.

## Локальный запуск

Из корня репозитория:

```bash
npm run admin:dev
```

Проверки:

```bash
npm run admin:typecheck
npm run admin:build
```

Общая проверка TypeScript проекта:

```bash
npm run typecheck
```

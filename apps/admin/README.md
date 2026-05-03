# Среди Своих Admin Center

`apps/admin` - будущая web-админка проекта «Среди Своих». Сейчас это только технический bootstrap/shell на Vite, React и TypeScript.

Source of truth для UX/UI будущей реализации: `docs/prototype/admin-events-center.html`.

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

## Границы текущего bootstrap

Production-интеграция с Supabase будет добавляться отдельными PR.

В браузере запрещено использовать серверные ключи повышенных прав и серверные административные методы Supabase.

Будущая реализация должна работать через Supabase Auth, RLS и RPC.

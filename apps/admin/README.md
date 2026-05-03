# Среди Своих Admin Center

`apps/admin` содержит web-админку проекта «Среди Своих» на Vite, React и TypeScript.

Текущий PR добавляет только production-ready visual shell и state-based навигацию: sidebar, topbar, симуляцию ролей и страницы-заглушки разделов. Все данные статичны и нужны только для визуальной проверки каркаса.

Source of truth для полного UX остаётся `docs/prototype/admin-events-center.html`.

## Что будет позже

Supabase, Auth, RLS и RPC будут подключены отдельными PR. В этом shell нет бизнес-логики событий, реальных данных, оплаты, backend-интеграций или управления импортом.

В браузере нельзя использовать серверные ключи повышенных прав и серверные административные методы Supabase.

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

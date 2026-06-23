# Среди Своих Admin Center

`apps/admin` содержит web-админку проекта «Среди Своих» на Vite, React и TypeScript.

В текущем состоянии админка использует Supabase Auth в браузере, загружает профиль пользователя и активное membership, а затем открывает visual shell только для ролей `admin` и `event_manager`. Beta v2 admin surfaces используют обычный authenticated Supabase client и RPC/RLS boundaries; import v2 доступен через Edge Function/RPC при deployed/configured staging backend и остаётся review-only без auto-publish.

Список событий читается через обычный browser-safe Supabase client с текущей пользовательской сессией и действующими RLS. Если backend-политики вернут только `published`/`public`, UI честно покажет только эти записи; расширение видимости черновиков, скрытых, отменённых или архивных событий требует отдельного backend PR.

Source of truth для полного UX остаётся `docs/prototype/admin-events-center.html`.

## Environment

`apps/admin` использует только обычный browser-safe Supabase client с пользовательской сессией. Админские действия должны проходить через RLS/RPC. Серверные ключи повышенных прав, Supabase Admin API и серверные connection strings нельзя добавлять в браузерную админку.

Создайте локальный файл:

```bash
cp apps/admin/.env.example apps/admin/.env.local
```

Заполните:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

Для staging-хостинга задайте env vars в настройках выбранного static SPA host:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<hosted-anon-or-publishable-key>
VITE_ADMIN_ENV_LABEL=staging
```

`VITE_ADMIN_ENV_LABEL` необязателен и нужен только как визуальная пометка окружения в compact context текущего пользователя, например `staging`, `prod` или `local`. Он не влияет на auth, роли, RLS/RPC или доступы. Реальные значения env нельзя коммитить; `.env.local` остаётся локальным файлом.

Реальные права доступа всё равно должны проверяться на стороне Supabase через RLS/RPC и отдельные backend-контракты. Не добавляйте в browser-admin service-role ключи, Supabase Admin API credentials или server-only database connection env vars.

## Staging deploy

Staging/beta docs:

- [Admin staging deploy](../../docs/admin-deploy-staging.md)
- [Admin beta v1 release checklist](../../docs/admin-beta-v1-release-checklist.md)
- [Admin beta v2 release checklist](../../docs/admin-beta-v2-release-checklist.md)

Короткая версия:

- `apps/admin` хостится как static Vite SPA.
- Сборка запускается из корня репозитория командой `npm run admin:build`.
- Build output для публикации: `apps/admin/dist`.
- Public staging URL web-admin должен быть зафиксирован как один canonical URL, например `https://<admin-staging-host>`.
- Static host должен отдавать `index.html` для всех SPA routes/callback paths, которые не являются реальными asset-файлами.
- В hosted Supabase Dashboard для staging project нужно поставить Auth `site_url` в staging admin URL и добавить тот же URL в allowed/additional redirect URLs.
- Production admin URL добавляется позже отдельным шагом, когда он будет готов.

Phase 1 beta v1 checklist covers the first server beta baseline. Beta v2 adds admin import behind the `admin-website-import` Edge Function and RPC/RLS write boundary; CLI import remains fallback/debug only outside browser-admin when project owner intentionally uses it. Manual beta v2 smoke lives in [Admin beta v2 release checklist](../../docs/admin-beta-v2-release-checklist.md).

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

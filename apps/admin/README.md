# Среди Своих Admin Center

`apps/admin` содержит web-админку проекта «Среди Своих» на Vite, React и TypeScript.

В текущем состоянии админка использует Supabase Auth в браузере, загружает профиль пользователя и активное membership, а затем открывает visual shell только для ролей `admin` и `event_manager`. Beta v2 admin surfaces используют обычный authenticated Supabase client и RPC/RLS boundaries; import v2 доступен через Edge Function/RPC при deployed/configured staging backend и остаётся review-only без auto-publish.

Staging web-admin публикуется как статический Vite build на `https://pgs24.ru/admin-stage/`. Текущий `apps/admin` не является browser-routed SPA: разделы `Events`, `Registrations`, `Members`, `Settings` и другие открываются через UI/sidebar внутри загруженного приложения, а не через прямые URL `/admin-stage/events`, `/admin-stage/registrations`, `/admin-stage/members` или `/admin-stage/settings`.

Список событий читается через обычный browser-safe Supabase client с текущей пользовательской сессией и действующими RLS. Если backend-политики вернут только `published`/`public`, UI честно покажет только эти записи; расширение видимости черновиков, скрытых, отменённых или архивных событий требует отдельного backend PR.

Source of truth для полного UX остаётся `docs/prototype/admin-events-center.html`.

## Provider cutover

The Python API is the default production provider for all migrated admin
domains. Production and staging deployments require a reachable `VITE_API_URL`.
For an explicit legacy/dev Supabase fallback, set both providers before the
operation:

```text
VITE_AUTH_PROVIDER=supabase
VITE_ADMIN_<DOMAIN>_PROVIDER=supabase
```

`AUTH_PROVIDER=supabase` creates and supplies the Supabase user session, and
the selected domain uses that session through the existing authenticated
Supabase client. A domain provider set to `supabase` while auth remains `api`
is not a supported fallback configuration. API failures do not retry through
Supabase; fallback is selected only by explicit environment configuration
before the operation. The Supabase-specific overview above remains relevant
only to that fallback.

Production API auth is API-owned. The temporary Supabase JWT bridge is a
migration/testing mechanism, not the final production auth architecture. The
backend production configuration must keep `MIGRATION_ACCEPT_SUPABASE_JWT=false`;
check older environments because they may have enabled the bridge. Do not add
this backend-only setting to Expo, Vite, or `apps/admin` environment files.
Supabase code and historical migrations remain intentionally until PR 38 removes
Supabase from the production runtime.

## Environment

With the default `api` providers, `apps/admin` uses the Python API and API-owned
authentication. With both fallback providers set to `supabase`, the selected
domain uses the existing browser-safe authenticated Supabase client and its
RLS/RPC boundary. Never add elevated server credentials, Supabase Admin API
credentials, or backend-only settings to the browser admin.

Создайте локальный файл:

```bash
cp apps/admin/.env.example apps/admin/.env.local
```

Заполните:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
VITE_API_URL=http://127.0.0.1:8000

VITE_AUTH_PROVIDER=api
VITE_ADMIN_EVENTS_PROVIDER=api
VITE_ADMIN_REGISTRATIONS_PROVIDER=api
VITE_ADMIN_MEMBERS_PROVIDER=api
VITE_ADMIN_INVITES_PROVIDER=api
VITE_ADMIN_SEATING_PROVIDER=api
VITE_ADMIN_IMPORT_PROVIDER=api
VITE_ADMIN_FEEDBACK_PROVIDER=api
VITE_ADMIN_COMMUNITY_PROVIDER=api
```

Для staging-хостинга задайте env vars в настройках выбранного static SPA host:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<hosted-anon-or-publishable-key>
VITE_API_URL=https://<api-host>
VITE_AUTH_PROVIDER=api
VITE_ADMIN_EVENTS_PROVIDER=api
VITE_ADMIN_REGISTRATIONS_PROVIDER=api
VITE_ADMIN_MEMBERS_PROVIDER=api
VITE_ADMIN_INVITES_PROVIDER=api
VITE_ADMIN_SEATING_PROVIDER=api
VITE_ADMIN_IMPORT_PROVIDER=api
VITE_ADMIN_FEEDBACK_PROVIDER=api
VITE_ADMIN_COMMUNITY_PROVIDER=api
VITE_ADMIN_ENV_LABEL=staging
VITE_ADMIN_BASE_PATH=/admin-stage/
```

`VITE_ADMIN_ENV_LABEL` необязателен и нужен только как визуальная пометка окружения в compact context текущего пользователя, например `staging`, `prod` или `local`. Он не влияет на auth, роли, RLS/RPC или доступы. `VITE_ADMIN_BASE_PATH=/admin-stage/` нужен для staging build, чтобы Vite генерировал asset URLs под `/admin-stage/assets/`, а не под `/assets/`. Реальные значения env нельзя коммитить; `.env.local` и `.env.production.local` остаются локальными файлами.

API-mode authorization is enforced by the Python API. Explicit Supabase fallback
operations remain behind their existing authenticated RLS/RPC boundary. Do not
add service-role keys, Supabase Admin API credentials, or any server-only
database connection env vars to `apps/admin`.

## Staging deploy

Staging/beta docs:

- [Admin staging deploy](../../docs/admin-deploy-staging.md)
- [Admin beta v1 release checklist](../../docs/admin-beta-v1-release-checklist.md)
- [Admin beta v2 release checklist](../../docs/admin-beta-v2-release-checklist.md)

Короткая версия:

- `apps/admin` хостится как static Vite SPA.
- Сборка запускается из корня репозитория командой `npm run admin:build`.
- Build output для публикации: `apps/admin/dist`.
- Public staging URL web-admin должен быть зафиксирован как один canonical URL: `https://pgs24.ru/admin-stage/`.
- Для staging build файл `apps/admin/.env.production.local` должен содержать `VITE_ADMIN_BASE_PATH=/admin-stage/`; этот файл нельзя коммитить.
- Текущая навигация state-routed и не browser-routed: прямые URL `/admin-stage/events`, `/admin-stage/registrations`, `/admin-stage/members` и `/admin-stage/settings` не являются canonical smoke target; используйте sidebar внутри приложения.
- Required smoke для path-based staging: открыть `https://pgs24.ru/admin-stage/` и проверить, что asset URLs идут под `/admin-stage/assets/`.
- Static host должен отдавать `index.html` для корня admin URL и configured auth callback paths, которые не являются реальными asset-файлами.
- В hosted Supabase Dashboard для staging project нужно поставить Auth `site_url` в `https://pgs24.ru/admin-stage/` и добавить admin-stage/app-stage URL в allowed/additional redirect URLs.
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

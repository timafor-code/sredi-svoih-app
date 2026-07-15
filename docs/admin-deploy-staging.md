# Admin staging deploy

Этот документ фиксирует staging deploy flow для `apps/admin`: выложить текущую closed beta web-admin на `https://pgs24.ru/admin-stage/` так, чтобы login, beta access, import v2 и ручной beta smoke проверялись по отдельным release checklist. В этом PR меняется только `apps/admin` Vite build config и документация; UI, DB schema, auth logic, CI/CD, Docker/Nginx, mobile и registrations/seating код не меняются.

Практическое решение для Phase 1 beta: Majordomo staging размещается не на поддоменах, а в папках основного домена:

```text
https://pgs24.ru/admin-stage/
https://pgs24.ru/app-stage/
```

Фактическая FTP-структура:

```text
/pgs24.ru/www/admin-stage/
/pgs24.ru/www/app-stage/
```

Поддомены `admin-stage.pgs24.ru` и `app-stage.pgs24.ru` были проверены, но на текущей конфигурации дают 403/SSL-проблемы и не дают быстро указать отдельный document root. Чтобы не тратить время на hosting-настройки, Phase 1 beta временно использует path-based hosting.

Follow-up перед реальной загрузкой сборок:

- для Expo web demo проверить работу под `/app-stage/`;
- для `app-stage` проверить SPA fallback через `.htaccess`;
- обновить hosted Supabase Auth redirects под фактические path-based URLs.

`apps/admin` собирается как static Vite build и публикуется из `apps/admin/dist`. Текущая админка не является browser-routed SPA: разделы открываются через UI/sidebar после загрузки приложения, а прямые URL `/events`, `/registrations`, `/members` и `/settings` не являются поддержанным способом открыть соответствующие разделы.

В Phase 1 кнопки импорта с сайта нет. Импорт временно выполняет владелец проекта через CLI/dev flow вне browser-admin.

Beta v1 release gate перед первой выдачей staging-ссылки beta-админам: [Admin beta v1 release checklist](admin-beta-v1-release-checklist.md).

Beta v2 final release gate после import button v2 и beta polish: [Admin beta v2 release checklist](admin-beta-v2-release-checklist.md). Не дублируйте полный checklist в этом deploy doc; project owner выполняет manual browser smoke по отдельному документу.

## Phase 2 import note

Current Phase 2 import v2 uses `admin-website-import` as the
admin-triggered import path when the Edge Function is deployed and configured.
Browser-admin calls it from the Import Review page with the current user
session.

Phase 2 переводит импорт событий с сайта из owner-only CLI/dev flow в безопасный admin-triggered backend flow. Import button доступен на Import Review page и работает в `apply_review_only` режиме. Import flow не публикует events автоматически: import items идут в review queue для human review, а run history и dedupe review UI проверяет project owner вручную.

Target architecture:

```text
web-admin button
  -> Supabase Edge Function
  -> parser/fetch
  -> write RPC
  -> event_import_runs
  -> event_import_items
  -> review queue
```

Default mode admin import: `apply_review_only`. Events не публикуются автоматически.

## Access model

The Python API is the default production provider for all migrated admin
domains. The Supabase-only statements in this historical staging guide apply
only for explicit legacy/dev fallback. Set both providers before the operation:

```text
VITE_AUTH_PROVIDER=supabase
VITE_ADMIN_<DOMAIN>_PROVIDER=supabase
```

`AUTH_PROVIDER=supabase` creates and supplies the Supabase user session; the
selected domain then uses it through the existing authenticated Supabase client.
Setting only a domain provider to `supabase` while auth remains `api` is not a
supported fallback configuration. API failures do not retry through Supabase;
fallback is selected only by explicit environment configuration before the
operation. Production API auth is API-owned; the temporary Supabase JWT bridge
is migration/testing-only, not final production architecture. The backend
production configuration must keep `MIGRATION_ACCEPT_SUPABASE_JWT=false`; check
older deployment environments because they may have enabled the bridge. Do not
add this backend-only setting to Expo, Vite, or `apps/admin` environment files.
Keep Supabase code and historical migrations through cutover validation; PR 38
removes Supabase from the production runtime.

With the default `api` providers, `apps/admin` calls the Python API using
API-owned authentication. With both fallback providers set to `supabase`, the
selected domain uses the existing browser-safe authenticated Supabase client,
anon/publishable key, user session, and RLS/RPC boundary.

Админские действия должны оставаться на границе RLS/RPC. Не использовать Supabase Admin API, service-role key или серверные connection strings в browser-admin.

Для import button на Import Review page browser-admin также остаётся обычным authenticated client. Браузер может вызвать только backend boundary с user session token; он не получает service-role key, server-only database connection strings, server-only secrets, Supabase Admin API credentials или прямую возможность писать import tables.

Privacy boundary: prayer tracker приватный. `prayer_activity_logs` нельзя читать или показывать в admin UI. В админке участников можно показывать профиль, членство и регистрации на события.

## Beta access

В Phase 1 закрытый beta-доступ выдаётся вручную владельцем проекта или админом. Для доступа нужен пользователь в hosted Supabase Auth, `profiles` row и active `community_memberships` row в beta community с ролью `admin` или `event_manager`.

Не создавать invite codes, invite backend или email invitations для beta v1. Не редактировать `auth.users` напрямую, не использовать Supabase Admin API, service-role key или server-only secrets в browser-admin.

## SPA hosting

`apps/admin` хостится как static Vite app на Majordomo в path-based папке `/pgs24.ru/www/admin-stage/`. Хост должен уметь:

- принимать build output из `apps/admin/dist`;
- отдавать assets из `dist/assets`;
- отдавать `index.html` на root admin URL;
- возвращать `index.html` для configured auth callback paths, если они используются;
- обслуживать staging admin URL по HTTPS: `https://pgs24.ru/admin-stage/`.

Canonical public URL staging web-admin:

```text
STAGING_ADMIN_URL=https://pgs24.ru/admin-stage/
```

Для текущей Phase 1 beta canonical admin URL уже выбран: `https://pgs24.ru/admin-stage/`. Используйте ровно это значение в hosting settings, Supabase Auth settings и Edge Function CORS/origin settings.

Build из корня репозитория:

```powershell
npm run admin:build
```

Для staging build Vite base path задаётся через локальный production env файл:

```text
apps/admin/.env.production.local
VITE_ADMIN_BASE_PATH=/admin-stage/
```

`.env.production.local` нельзя коммитить. Без этого Vite сгенерирует asset URLs от корня домена (`/assets/...`), что неверно для path-based staging; правильные asset URLs должны быть под `/admin-stage/assets/...`.

Публикуемый каталог после build:

```text
apps/admin/dist
```

Фактическая папка назначения на FTP для admin beta:

```text
/pgs24.ru/www/admin-stage/
```

Routing boundary: текущий `apps/admin` не использует browser routing для разделов. Project owner открывает `Events`, `Registrations`, `Members`, `Settings` и другие разделы через sidebar/UI внутри приложения. Прямые URL `/admin-stage/events`, `/admin-stage/registrations`, `/admin-stage/members` и `/admin-stage/settings` не являются deploy-контрактом и не должны использоваться как smoke criteria.

Static fallback: если для Auth confirmation/recovery/provider flow или будущего callback настроен dedicated path вроде `/auth/callback`, хост должен возвращать `apps/admin/dist/index.html` на этот callback path, а не 404. Asset-файлы из `/admin-stage/assets/*` должны продолжать отдаваться как файлы. Не добавляйте `.htaccess`, Nginx config, Docker config или другой server config в этот PR.

## Admin env

Staging host должен получить только browser-safe env vars:

```text
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

`VITE_SUPABASE_URL` указывает на hosted Supabase project для staging. `VITE_SUPABASE_ANON_KEY` должен быть anon/publishable key этого project. `VITE_ADMIN_ENV_LABEL=staging` необязателен для текущего login flow, но полезен как явный marker окружения. `VITE_ADMIN_BASE_PATH=/admin-stage/` нужен только для Vite build под path-based staging.

Не коммитить `.env.local` и `.env.production.local`. Эти файлы остаются локальными или на стороне hosting provider secrets/settings.

Не добавлять в `apps/admin` service-role key, Supabase Admin API credentials, `DATABASE_URL`, server-only database connection strings, raw JWT/session debug dumps или любые другие server-only secrets. Browser-admin должен работать только через anon/publishable key, пользовательскую session и RLS/RPC/backend boundaries.

## Supabase Auth redirects

В hosted Supabase Dashboard для staging project обновите Auth URL configuration:

- `site_url`: `https://pgs24.ru/admin-stage/`;
- allowed/additional redirect URLs для web-admin: `https://pgs24.ru/admin-stage/` и `https://pgs24.ru/admin-stage/**`;
- если используется dedicated admin callback path: `https://pgs24.ru/admin-stage/auth/callback`;
- allowed/additional redirect URLs для staging user app/web entry: `https://pgs24.ru/app-stage/` и `https://pgs24.ru/app-stage/**`;
- если app-stage использует dedicated callback path, добавить exact configured app-stage callback URL отдельной строкой;
- local URLs можно оставить только если они нужны для local development;
- production admin URL добавить позже отдельным PR/шагом, когда production web-admin будет готов.

`supabase/config.toml` в репозитории относится к локальному Supabase runtime. Его `[auth].site_url` и `additional_redirect_urls` не настраивают hosted Supabase project автоматически. Для staging нужно менять именно hosted Supabase Dashboard settings.

Текущий admin login использует email/password и не делает внешний OAuth redirect. Однако hosted Auth redirects всё равно должны быть подготовлены для confirmation/recovery/provider flows и будущих callback сценариев. Supabase redirect allowlist должна содержать exact URL без query/hash; query params и hash fragment приходят уже поверх разрешённого URL. Настройка app-stage redirects здесь означает только Auth allowlist для staging project, а не изменение app-stage/mobile web code.

## Login callback

Минимально разрешить:

```text
https://pgs24.ru/admin-stage/
https://pgs24.ru/admin-stage/**
```

Если redirect flow настроен на dedicated callback path, дополнительно разрешить:

```text
https://pgs24.ru/admin-stage/auth/callback
```

Хостинг должен отдавать `index.html` на этот callback path, чтобы Vite SPA загрузилась и Supabase client смог обработать session в URL.

Для app-stage в том же hosted Supabase staging project держите отдельные allowed redirect URLs:

```text
https://pgs24.ru/app-stage/
https://pgs24.ru/app-stage/**
```

Если app-stage использует dedicated callback path, разрешите exact configured path. Не переносите app-stage redirect settings в код `apps/admin`.

При redirect loop проверить:

- hosted Supabase `site_url` не указывает на localhost, mobile app или production URL;
- exact staging admin URL добавлен в allowed/additional redirect URLs;
- staging env vars указывают на hosted staging Supabase project, а не на local Supabase;
- static host не отдаёт 404 на callback path и не удаляет hash/query из URL;
- browser не держит старую session от другого Supabase project;
- redirect происходит по HTTPS canonical URL без лишнего slash/path mismatch.

При `NoAccess` проверить:

- пользователь действительно вошёл в staging Supabase project;
- у пользователя есть `profiles` row;
- существует beta community;
- есть active `community_memberships` row для этого пользователя;
- role равен `admin` или `event_manager`;
- membership не `pending`, `suspended` или `left`;
- RLS/RPC возвращают профиль и membership для текущей user session.

`NoAccess` обычно означает проблему членства/роли/RLS, а не проблему Auth redirect.

## Edge Function import note

`admin-website-import` уже используется как admin-triggered import path, если
Edge Function deployed и настроен. Deploy/config requirements:

- set `ADMIN_WEB_ORIGIN` on the Edge Function to the exact admin SPA origin,
  for example the same value as `STAGING_ADMIN_URL`;
- do not use `*` as an allowed origin for staging or production;
- for local development, set an explicit local origin such as
  `http://127.0.0.1:5173` or the actual Vite admin dev origin;
- browser-admin calls the function with
  `Authorization: Bearer <user-session-access-token>`;
- the function creates a normal user-scoped Supabase client with the
  anon/publishable key and validates the token with `auth.getUser()`;
- role access is checked through RLS-backed `profiles` and
  `community_memberships` reads for active `admin` or `event_manager`;
- service-role keys, Supabase Admin API, raw `auth.users`, and server-only
  database credentials are not used by this browser-triggered Edge flow;
- Import Review page calls the function in `apply_review_only` mode;
- import flow creates review-only runs/items for manual review and does not
  auto-publish events;
- run history and dedupe review UI must be checked manually by the project
  owner.

Event image mirror deploy note:

- run the Storage migration before staging smoke so the public `event-images`
  bucket and object policies exist;
- no extra browser env var is required for image mirroring;
- for local Docker smoke, set
  `SUPABASE_PUBLIC_URL=http://127.0.0.1:54321` in
  `supabase/functions/.env.local` so mirrored image `publicUrl` values are
  browser-facing instead of Docker-internal `http://kong:8000` URLs;
- staging and production usually do not need `SUPABASE_PUBLIC_URL` when
  `SUPABASE_URL` is already browser-facing;
- the Edge Function uploads mirrored images with the caller's authenticated
  session and the normal anon/publishable Supabase key;
- object paths are scoped as
  `community/<community_id>/website-import/<source_external_id_or_hash>/<sha256>.<ext>`;
- Review UI should show `raw_payload.importReview.imageMirror.status`,
  `storagePath`, and `originalUrl` in the import item detail drawer.

For the active browser-triggered import path, keep these rules:

- `ADMIN_WEB_ORIGIN` должен совпадать со staging admin SPA origin;
- CORS должен явно разрешать admin SPA origin `STAGING_ADMIN_URL`;
- preflight должен разрешать `Authorization` и нужные content headers для admin SPA;
- browser-admin должен передавать `Authorization: Bearer <user-session-access-token>`;
- функция должна валидировать пользователя через обычную user session;
- Edge Function и write RPC должны проверять `auth.uid()` и role;
- write path должен идти через authenticated RPC/RLS boundary;
- service-role key не использовать для browser-triggered admin flow;
- Supabase Admin API не использовать для import trigger;
- server-only database connection strings не добавлять в `apps/admin`;
- raw `auth.users` не читать и не менять;
- default mode для Import Review button: `apply_review_only`;
- auto-publish запрещён, events не публикуются автоматически;
- run history и dedupe review UI проверяются вручную project owner.

Dedupe status boundary: detailed JSON contract будет отдельным PR `feature/admin-import-dedupe-contract`. В этом architecture PR dedupe/review statuses живут в `event_import_items.raw_payload.importReview.dedupe`, а не в `event_import_items.status` или `event_import_runs.status`. Не добавлять `duplicate` / `possible_duplicate` в table CHECK constraints.

## Settings health check

В web-admin открыть Settings → Health check и нажать `Проверить снова`, если нужно повторить проверку после изменения staging env или Supabase доступа.

Beta Settings page разделена на блоки Community, Addresses, Beta connection и Future settings. В beta она показывает real community data, текущий beta/staging connection context и будущие настройки как disabled/planned blocks, без fake-working controls.

Settings показывает read-only данные текущей active community из Supabase: `id`, `name`, `timezone`, `website_url` если он заполнен, и дату создания если она доступна в schema. Эти данные читаются browser-admin через обычный authenticated Supabase client и RLS, без service-role key, Supabase Admin API или server-only connection strings.

Health-check является лёгким smoke-индикатором готовности окружения, а не security scanner, SQL console или deep diagnostics. Он проверяет только безопасные read-only признаки через обычный authenticated Supabase client: наличие browser Supabase config, session, active membership, текущую role, выбранную community и доступность существующих read/RPC/service layers для events, import review, registrations и members.

Health-check не показывает secret values, JWT, raw session token, anon key value, service-role key, server-only env, SQL/debug internals или данные prayer tracker.

Settings smoke выполняет project owner вручную. Codex не запускает browser smoke для Settings.

Для `event_manager` members-only check должен быть skipped/not allowed как ожидаемое поведение. В текущей навигации Settings доступны admin-only; event_manager smoke ниже проверяет, что admin-only доступ не расширился.

## Staging checklist

Release checklist split:

- [Admin beta v1 release checklist](admin-beta-v1-release-checklist.md) covers the first server beta baseline: staging SPA hosting, Supabase Auth redirects, beta access, Settings health, and initial manual smoke.
- [Admin beta v2 release checklist](admin-beta-v2-release-checklist.md) covers import button v2, beta polish, registrations/seating context, and the feedback review list for final beta v2 manual smoke.

Project owner manual deploy checklist:

- Canonical admin URL is `https://pgs24.ru/admin-stage/`.
- `npm run admin:build` passes before publishing.
- Published directory is exactly `apps/admin/dist`.
- `apps/admin/.env.production.local` contains `VITE_ADMIN_BASE_PATH=/admin-stage/` before the staging build.
- Staging hosting env contains reachable `VITE_API_URL`, all nine API-default provider variables, `VITE_ADMIN_ENV_LABEL=staging`, and `VITE_ADMIN_BASE_PATH=/admin-stage/`. For a Supabase legacy/dev fallback, set both `VITE_AUTH_PROVIDER=supabase` and the selected `VITE_ADMIN_<DOMAIN>_PROVIDER=supabase`; Supabase URL and anon/publishable-key values remain only for that fallback.
- Confirm the backend production configuration has `MIGRATION_ACCEPT_SUPABASE_JWT=false`; this migration/testing-only setting does not belong in Expo, Vite, or `apps/admin` environment files.
- `.env.local` and `.env.production.local` are not committed.
- `apps/admin` does not receive service-role keys, Supabase Admin API credentials, `DATABASE_URL`, or server-only connection strings.
- Hosted Supabase Auth redirects include admin-stage and app-stage exact URLs.
- Admin sections are opened through sidebar/UI; `/events`, `/registrations`, `/members`, and `/settings` are not direct section routes.

- Edge Function `ADMIN_WEB_ORIGIN` is set to the exact admin SPA origin before manual smoke.
- Edge Function CORS allows `POST`, `OPTIONS`, `Authorization`, `apikey`, `x-client-info`, and `content-type`.
- Edge Function `admin-website-import` уже используется как admin-triggered import path, если deployed и настроен.
- Import button доступен на Import Review page и работает в `apply_review_only` режиме.
- Import flow не публикует events автоматически.
- `ADMIN_WEB_ORIGIN` должен совпадать со staging admin SPA origin.
- Run history и dedupe review UI должны проверяться вручную project owner.

- Supabase migrations applied на staging project.
- Beta community exists.
- Admin membership active.
- Event manager membership active.
- Beta users have hosted Supabase Auth access, `profiles` rows and active `community_memberships` rows; use [admin beta access](admin-beta-access.md) for the manual runbook.
- `npm run admin:build` passes.
- `apps/admin/dist` опубликован на static SPA host.
- Admin URL opens: `STAGING_ADMIN_URL`.
- SPA fallback возвращает `index.html` для callback/non-asset paths.
- Hosted Supabase Auth `site_url` равен `STAGING_ADMIN_URL`.
- Hosted Supabase Auth allowed/additional redirect URLs содержат `STAGING_ADMIN_URL`.
- Login redirect returns to admin URL.
- `NoAccess` не появляется для active `admin` и active `event_manager`.
- Settings показывает real community data для active `admin`, а не mock community settings.
- Settings → Адреса общины продолжают читать и сохранять адреса как раньше.
- Settings → Beta connection показывает понятный staging/authenticated-client context без secret values.
- Settings → Future settings показывает planned/disabled blocks, а не рабочие mock-controls.
- Settings → Health check показывает базовые ok/skipped/warning/error статусы без secrets/JWT/anon key values.
- Import button доступен на Import Review page и работает в `apply_review_only` режиме.
- Import flow не публикует events автоматически.

## Overview beta checklist

- Overview не должен показывать fake KPI, mock dashboard, charts или production analytics.
- Beta landing должен честно показывать текущего пользователя, role и community активной session.
- `event_manager` не должен видеть admin-only shortcuts на Overview.

## Manual smoke

Not run by Codex. Manual smoke is performed by the project owner.

Deploy/navigation:

- Open `https://pgs24.ru/admin-stage/`.
- Confirm the app loads from the published `apps/admin/dist` build.
- Confirm generated script and CSS asset URLs are under `https://pgs24.ru/admin-stage/assets/`, not `https://pgs24.ru/assets/`.
- Confirm the visible environment label is `staging` when `VITE_ADMIN_ENV_LABEL=staging` is configured.
- Use sidebar/UI to open Events, Registrations, Members and Settings.
- Do not treat `/admin-stage/events`, `/admin-stage/registrations`, `/admin-stage/members` or `/admin-stage/settings` as supported direct URLs for the current admin build.
- Confirm hosted Supabase Auth URL settings include both `https://pgs24.ru/admin-stage/` and `https://pgs24.ru/app-stage/` exact redirects.
- Confirm no UI or health/debug surface shows service-role keys, Supabase Admin API credentials, `DATABASE_URL`, raw JWT/session token or server-only secrets.

Beta polish:

- Events overflow duplicate action is intentionally removed for beta.
- Event duplication is not available until a safe draft duplication flow is designed.
- Future duplication must not copy registrations, seating, payments, or publish the copy automatically.
- Project owner should verify in browser smoke that the Events overflow menu no longer shows `Дублировать`.

Admin:

- Войти как active `admin`.
- Открыть Settings.
- Проверить, что Community block показывает real community data: `id`, `name`, `timezone`, `website_url` если заполнен, и дату создания если она доступна.
- Проверить, что Settings → Адреса общины загружаются и существующий add/edit/archive flow не сломан.
- Проверить, что Beta connection block понятен, показывает beta/staging context и не раскрывает secret values.
- Проверить, что Future settings clearly disabled/planned и не выглядят как рабочие save-controls.
- Открыть Settings → Health check.
- Нажать `Проверить снова`.
- Ожидать `ok` для Supabase configured, session exists, membership exists, current role, selected community, events, import review, registrations и members.
- Проверить, что на экране нет JWT, raw session token, anon key value, service-role key, server-only env или SQL/debug details.

Event manager:

- Войти как active `event_manager`.
- Проверить, что Overview/Events/Import review/Registrations доступны как раньше.
- Проверить, что Settings/Members остаются admin-only в текущей навигации и event_manager не может открыть Settings.
- Если health-check запускается в build/route, где он доступен event_manager, members-only check должен быть `skipped`, а не failure.

Broken env:

- На отдельном staging preview с намеренно неполным browser Supabase config открыть web-admin.
- Ожидать safe error/config state без secret values.
- Health-check, если доступен, должен показывать Supabase configured как `error`, остальные backend checks как `skipped`.
- Восстановить env и повторить build/deploy перед основным smoke.

- Проверить hosted Supabase Auth URL settings.
- Открыть staging admin URL.
- Войти как active `admin`.
- Выйти и войти повторно.
- Войти как active `event_manager`.
- Проверить, что login redirect возвращает на staging admin URL.
- Проверить, что docs не предлагают Supabase Admin API, service-role key или server-only secrets для browser-admin.
- Проверить, что Import Review page показывает import button и запускает `apply_review_only` flow.
- Проверить run history и dedupe review UI вручную.

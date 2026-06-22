# Admin staging deploy

Этот документ фиксирует Phase 1 server beta v1 для `apps/admin`: выложить web-admin на staging так, чтобы первый login не сломался из-за Supabase Auth redirects. PR документационный: UI, DB schema, CI/CD, Docker/Nginx, mobile и registrations/seating код не меняются.

В Phase 1 кнопки импорта с сайта нет. Импорт временно выполняет владелец проекта через CLI/dev flow вне browser-admin.

Финальный release gate перед выдачей staging-ссылки beta-админам: [Admin beta v1 release checklist](admin-beta-v1-release-checklist.md).

## Phase 2 import note

Current update for `feature/admin-import-edge-foundation`: this branch adds the
first `admin-website-import` Supabase Edge Function skeleton, but only as an
auth/CORS/health foundation. It does not fetch the website, parse HTML, call
write RPC, create import runs/items, change events, or add an admin UI button.

Phase 2 переводит импорт событий с сайта из owner-only CLI/dev flow в безопасный admin-triggered backend flow. Текущий foundation PR реализует только health-only Edge Function skeleton и не реализует import button, parser dry-run, `apply_review_only`, run history или dedupe review UI.

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

Default mode будущего admin import: `apply_review_only`. Events не публикуются автоматически, import items идут в review queue для human review.

## Access model

`apps/admin` работает через обычный authenticated Supabase client в браузере. Клиент использует anon/publishable key, пользовательскую Supabase session и RLS/RPC.

Админские действия должны оставаться на границе RLS/RPC. Не использовать Supabase Admin API, service-role key или серверные connection strings в browser-admin.

Для будущего import button browser-admin также остаётся обычным authenticated client. Браузер может вызвать только backend boundary с user session token; он не получает service-role key, `DATABASE_URL`, server-only secrets, Supabase Admin API credentials или прямую возможность писать import tables.

Privacy boundary: prayer tracker приватный. `prayer_activity_logs` нельзя читать или показывать в admin UI. В админке участников можно показывать профиль, членство и регистрации на события.

## Beta access

В Phase 1 закрытый beta-доступ выдаётся вручную владельцем проекта или админом. Для доступа нужен пользователь в hosted Supabase Auth, `profiles` row и active `community_memberships` row в beta community с ролью `admin` или `event_manager`.

Не создавать invite codes, invite backend или email invitations для beta v1. Не редактировать `auth.users` напрямую, не использовать Supabase Admin API, service-role key или server-only secrets в browser-admin.

## SPA hosting

`apps/admin` хостится как static SPA на выбранном staging web host. Хост должен уметь:

- принимать build output из `apps/admin/dist`;
- отдавать assets из `dist/assets`;
- возвращать `index.html` для SPA routes и auth callback paths;
- обслуживать staging admin URL по HTTPS.

Canonical public URL staging web-admin:

```text
STAGING_ADMIN_URL=https://<admin-staging-host>
```

Перед выкладкой замените placeholder на реальный URL выбранного хостинга и используйте ровно это значение в hosting settings и Supabase Auth settings.

Build из корня репозитория:

```powershell
npm run admin:build
```

Публикуемый каталог:

```text
apps/admin/dist
```

SPA fallback: любые запросы к несуществующим static files должны возвращать `apps/admin/dist/index.html`, а не 404. Это важно для будущих callback paths вроде `/auth/callback` и для прямого открытия URL после redirect. Asset-файлы из `/assets/*` должны продолжать отдаваться как файлы.

## Admin env

Staging host должен получить только browser-safe env vars:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<hosted-anon-or-publishable-key>
VITE_ADMIN_ENV_LABEL=staging
```

`VITE_SUPABASE_URL` указывает на hosted Supabase project для staging. `VITE_SUPABASE_ANON_KEY` должен быть anon/publishable key этого project. `VITE_ADMIN_ENV_LABEL=staging` необязателен для текущего login flow, но полезен как явный marker окружения.

Не коммитить `.env.local`. Не добавлять server-only secrets в `apps/admin`.

## Supabase Auth redirects

В hosted Supabase Dashboard для staging project обновите Auth URL configuration:

- `site_url`: `STAGING_ADMIN_URL`;
- allowed/additional redirect URLs: `STAGING_ADMIN_URL`;
- если используется dedicated callback path: `STAGING_ADMIN_URL/auth/callback`;
- local URLs можно оставить только если они нужны для local development;
- production admin URL добавить позже отдельным PR/шагом, когда production web-admin будет готов.

`supabase/config.toml` в репозитории относится к локальному Supabase runtime. Его `[auth].site_url` и `additional_redirect_urls` не настраивают hosted Supabase project автоматически. Для staging нужно менять именно hosted Supabase Dashboard settings.

Текущий admin login использует email/password и не делает внешний OAuth redirect. Однако hosted Auth redirects всё равно должны быть подготовлены для confirmation/recovery/provider flows и будущих callback сценариев. Supabase redirect allowlist должна содержать exact URL без query/hash; query params и hash fragment приходят уже поверх разрешённого URL.

## Login callback

Минимально разрешить:

```text
STAGING_ADMIN_URL
STAGING_ADMIN_URL/
```

Если redirect flow настроен на dedicated callback path, дополнительно разрешить:

```text
STAGING_ADMIN_URL/auth/callback
```

Хостинг должен отдавать `index.html` на этот callback path, чтобы Vite SPA загрузилась и Supabase client смог обработать session в URL.

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

## Edge Functions future note

Current Phase 2 foundation adds `admin-website-import` as a health-only
Supabase Edge Function. Deploy/config requirements:

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
- current response is only safe health JSON:
  `{"ok":true,"mode":"health","userRole":"admin|event_manager","communityId":"..."}`;
- parser, apply, review writes, import runs, import items, and event changes
  are deferred to later PRs.

Full Phase 2 admin import will continue to build on this Edge Function boundary.
Before parser/write enablement, keep these rules:

- CORS должен явно разрешать admin SPA origin `STAGING_ADMIN_URL`;
- preflight должен разрешать `Authorization` и нужные content headers для admin SPA;
- browser-admin должен передавать `Authorization: Bearer <user-session-access-token>`;
- функция должна валидировать пользователя через обычную user session;
- Edge Function и write RPC должны проверять `auth.uid()` и role;
- write path должен идти через authenticated RPC/RLS boundary;
- service-role key не использовать для browser-triggered admin flow;
- Supabase Admin API не использовать для import trigger;
- `DATABASE_URL` не добавлять в `apps/admin`;
- raw `auth.users` не читать и не менять;
- default mode для будущего button: `apply_review_only`;
- auto-publish запрещён, events не публикуются автоматически;
- import button не реализуется этим PR.

Dedupe status boundary: detailed JSON contract будет отдельным PR `feature/admin-import-dedupe-contract`. В этом architecture PR dedupe/review statuses живут в `event_import_items.raw_payload.importReview.dedupe`, а не в `event_import_items.status` или `event_import_runs.status`. Не добавлять `duplicate` / `possible_duplicate` в table CHECK constraints.

## Settings health check

В web-admin открыть Settings → Health check и нажать `Проверить снова`, если нужно повторить проверку после изменения staging env или Supabase доступа.

Settings показывает read-only данные текущей active community из Supabase: `id`, `name`, `timezone`, `website_url` если он заполнен, и дату создания если она доступна в schema. Эти данные читаются browser-admin через обычный authenticated Supabase client и RLS, без service-role key, Supabase Admin API или server-only connection strings.

Health-check является лёгким smoke-индикатором готовности окружения, а не security scanner, SQL console или deep diagnostics. Он проверяет только безопасные read-only признаки через обычный authenticated Supabase client: наличие browser Supabase config, session, active membership, текущую role, выбранную community и доступность существующих read/RPC/service layers для events, import review, registrations и members.

Health-check не показывает secret values, JWT, raw session token, anon key value, service-role key, server-only env, SQL/debug internals или данные prayer tracker.

Для `event_manager` members-only check должен быть skipped/not allowed как ожидаемое поведение. В текущей навигации Settings доступны admin-only; event_manager smoke ниже проверяет, что admin-only доступ не расширился.

## Staging checklist

- Edge Function `ADMIN_WEB_ORIGIN` is set to the exact admin SPA origin before manual smoke.
- Edge Function CORS allows `POST`, `OPTIONS`, `Authorization`, `apikey`, `x-client-info`, and `content-type`.
- `admin-website-import` remains health-only until parser/apply/review-write PRs land.

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
- Settings → Health check показывает базовые ok/skipped/warning/error статусы без secrets/JWT/anon key values.
- Import button с сайта ещё отсутствует в этом PR.
- Future Edge Function CORS должен разрешать `STAGING_ADMIN_URL` до включения import button.

## Overview beta checklist

- Overview не должен показывать fake KPI, mock dashboard, charts или production analytics.
- Beta landing должен честно показывать текущего пользователя, role и community активной session.
- `event_manager` не должен видеть admin-only shortcuts на Overview.

## Manual smoke

Not run by Codex. Manual smoke is performed by the project owner.

Admin:

- Войти как active `admin`.
- Открыть Settings.
- Проверить, что карточка общины показывает real community data: `id`, `name`, `timezone`, `website_url` если заполнен, и дату создания если она доступна.
- Проверить, что Settings → Адреса общины загружаются и существующий add/edit/archive flow не сломан.
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
- Проверить, что import button с сайта ещё не появился в этом PR.

# Admin import review

Current status: `apply_review_only` Edge integration is implemented in
`supabase/functions/admin-website-import`. Older "future/docs-only" language in
this document describes the phased plan history; the current runtime boundary is
documented below.

Этот документ фиксирует final architecture для Phase 2 admin-triggered import v2. PR является docs-only: код, schema, migrations, Edge Functions, RPC, importer script и `apps/admin` UI не меняются.

Phase 1 server/staging beta v1 завершена без import button. Текущий importer из `scripts/importWebsiteEvents.mjs` остаётся временным owner/dev-only CLI flow до отдельных Phase 2 PRs. Он не является beta-admin UI и не переносится в Edge Function "как есть".

## Target pipeline

```text
web-admin button
  -> Supabase Edge Function
  -> parser/fetch
  -> write RPC
  -> event_import_runs
  -> event_import_items
  -> review queue
```

Default mode: `apply_review_only`.

В этом режиме backend flow создаёт import run и import items для проверки человеком. Import items попадают в review queue, а не напрямую в published events. No auto-publish: событие не становится published только потому, что parser нашёл карточку на сайте или смог уверенно распарсить дату.

## Current Edge apply_review_only integration

Current implementation in `supabase/functions/admin-website-import` keeps
health and dry-run modes and adds `apply_review_only` as the review-write mode.
It uses the normal authenticated Supabase client with the caller's user session
token and calls the existing write RPC. It does not use a service-role key,
Supabase Admin API, `DATABASE_URL`, or raw `auth.users` reads.

`sourceUrl` is validated through the shared website parser allowlist before any
website fetch. Only `sredisvoih.com` and `www.sredisvoih.com` are accepted.
The browser/admin UI never receives `DATABASE_URL` or server-only secrets.

Runtime flow:

1. validate CORS, auth, and active `admin` / `event_manager` access;
2. validate parser options and allowlisted `sourceUrl`;
3. resolve the active `sredi_svoih_events` import source visible to the caller;
4. call `admin_begin_import_run` with mode `apply_review_only`;
5. fetch and parse the website through the shared parser;
6. call `admin_upsert_import_item` for each parsed item;
7. call `admin_finalize_import_run` with `success` and safe summary counts.

This writes only `event_import_runs` and `event_import_items`. It never creates
events, never updates events, never publishes events, and never auto-publishes.
Item table statuses remain only `new | linked | ignored | error`; dedupe states
stay inside `raw_payload.importReview.dedupe`.

If `admin_begin_import_run` returns `import_already_running`, the Edge Function
returns a clean conflict-style payload with `ok: false`,
`error: "import_already_running"`, and a safe message. If the parser or list
fetch fails after a run was opened, the run is finalized as `failed` with a safe
error message. Detail fetch/parse failures are saved as item errors and the run
continues.

## Write-RPC boundary

Write-RPC слой реализован в migration `supabase/migrations/20260622140000_admin_import_write_rpc.sql`. Это первый implementation-PR Phase 2 (PR 14): он создаёт безопасный backend write boundary и пишет **только** `event_import_runs` и `event_import_items`.

Важно про границы этого слоя:

- write boundary пишет только `event_import_runs` и `event_import_items`;
- он **не** создаёт, не обновляет и не публикует events;
- он не трогает registrations, seating, mobile, participants или prayer tracker;
- он не реализует Edge Function, parser, importer или UI (это отдельные будущие PRs);
- браузер-admin не пишет import-таблицы напрямую — только через эти RPC.

### Allowed roles

Все RPC требуют `auth.uid()` и активное членство в community с ролью `admin` или `event_manager`. Community **всегда** выводится server-side из import source (`event_import_sources.community_id`) и сверяется с активным членством вызывающего. `community_id` из payload никогда не читается и не принимается — спуфинг community невозможен.

Централизованная проверка — `admin_assert_import_runner_access(p_source_id uuid)`. Она поднимает понятные ошибки:

- `unauthenticated` — нет `auth.uid()`;
- `import_source_not_found` — source с таким id не существует;
- `import_source_forbidden` — source существует, но у пользователя нет активной admin/event_manager роли в его community (включая случай, когда source принадлежит чужой community).

### begin / upsert / finalize lifecycle

Один import run проходит через три RPC:

1. `admin_begin_import_run(payload jsonb)` — payload `{ "sourceId": "<uuid>", "mode": "apply_review_only" }` (snake_case `source_id` принимается defensively). Валидирует доступ, применяет already-running guard, создаёт `event_import_runs` со `status = 'started'` и возвращает safe run info (`runId`, `sourceId`, `communityId`, `status`, `mode`, `startedAt`).
2. `admin_upsert_import_item(p_run_id uuid, payload jsonb)` — пишет один item в `event_import_items` для открытого run. Валидирует доступ через source открытого run и требует `run.status = 'started'`. Идемпотентный upsert внутри run по ключу `(run_id, external_id)`, когда `external_id` присутствует; items без `external_id` всегда вставляются (в схеме нет UNIQUE-ограничения на `(source_id, external_id)`, и этот PR его не добавляет — cross-run dedupe остаётся задачей review queue).
3. `admin_finalize_import_run(p_run_id uuid, payload jsonb)` — закрывает открытый run. Допустимые финальные статусы только `success` или `failed`. Обновляются только уже существующие summary/error колонки (`finished_at`, `error`, `found_count`, `created_count`, `updated_count`). Items не мутируются.

### Already-running guard

`admin_begin_import_run` защищает от параллельных запусков для одного source, используя server-side `now()` (не browser/device time) плюс transaction-scoped advisory lock per source, и существующую колонку `started_at` (новые колонки не добавляются):

- если для source есть активный `status = 'started'` run, начатый в пределах stale-порога (**30 минут**) — запрос отклоняется ошибкой `import_already_running`;
- если активный `started` run старше порога — он помечается `status = 'failed'` с `error = 'stale_import_run_timed_out'`, после чего создаётся новый run.

### No auto-publish, no events writes

Default (и единственный поддерживаемый) mode — `apply_review_only`. Любое другое значение `mode` отклоняется (`import_mode_unsupported`). RPC никогда не публикует событие и не пишет в таблицу `events`. `linkedEventId` у item принимается только как ссылка и валидируется на принадлежность той же community (read-only проверка) — запись в `events` не выполняется.

### Table statuses не расширяются

Этот слой не расширяет CHECK-ограничения. Item-статусы берутся только из `new | linked | ignored | error`, финальные run-статусы — только `success | failed`. Dedupe/review state передаётся внутри `raw_payload.importReview.dedupe` и сохраняется как есть; он никогда не попадает в status-колонку (см. [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md)).

## Review queue contract

Review queue является обязательным human-review layer между импортом и публикацией. Она нужна для проверки дат, описаний, мест, dedupe-сигналов и manual override cases до появления события в публичном календаре.

`event_import_items` хранит результат parser/fetch и review metadata. Admin UI должен показывать items, требующие решения, но само решение и запись изменений должны идти через отдельные безопасные RPC/RLS contracts.

Rules:

- import items идут в review queue, не напрямую в published events;
- default mode `apply_review_only`;
- no auto-publish;
- no direct browser DB writes;
- browser-admin не получает server-only secrets;
- future publish/apply actions должны быть явными действиями review flow.

## Security boundary

Browser-admin работает только через обычный authenticated Supabase client, anon/publishable key и user session. Для import trigger браузер передаёт user session token в backend boundary.

Запрещено:

- service-role key в browser-admin или browser-triggered import flow;
- `DATABASE_URL` в `apps/admin`;
- Supabase Admin API;
- raw `auth.users` reads/writes;
- server-only secrets в browser env;
- прямые browser DB writes в import tables.

Edge Function и write RPC должны проверять `auth.uid()` и роль пользователя. Админские действия остаются на RLS/RPC boundary. Events не публикуются автоматически.

Privacy boundary: prayer tracker приватный. Этот docs-only PR не читает и не показывает `prayer_activity_logs` и не меняет participants, registrations, seating или prayer tracker flows.

## Dedupe boundary

Детальный v1 JSON contract зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md). Boundary остаётся прежним: dedupe/review statuses живут в JSON payload, а не в table status columns.

Canonical place для dedupe status:

```text
event_import_items.raw_payload.importReview.dedupe
```

Review queue читает dedupe state из `raw_payload.importReview.dedupe`, а не из `event_import_items.status` или `event_import_runs.status`. Table status expansion для dedupe не предлагается.

Не расширять:

- `event_import_items.status`;
- `event_import_runs.status`;
- table CHECK constraints;
- status values вроде `duplicate` или `possible_duplicate`.

Table status columns должны оставаться техническими состояниями import run/item. Dedupe и review decisions относятся к JSON review payload и будущему review contract.

## Phase 2 PR boundaries

Архитектура зафиксирована отдельным docs-only PR. Реализация разбита на отдельные PRs:

- write RPC — **реализовано** (см. [Write-RPC boundary](#write-rpc-boundary), migration `20260622140000_admin_import_write_rpc.sql`);
- Supabase Edge Function health/CORS/auth foundation - **implemented**;
- parser dry-run - **implemented**;
- `apply_review_only` Edge-to-write-RPC integration - **implemented**;
- import button UI;
- run history UI;
- dedupe review UI;
- detailed dedupe JSON contract — зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md).

Не делать в этом PR:

- schema changes;
- migrations;
- importer execution;
- import button;
- changes to `scripts/importWebsiteEvents.mjs`;
- changes to `apps/admin`;
- backend/RPC changes beyond the existing write-RPC contract;
- mobile, registrations, seating или prayer tracker changes.

## Manual review expectation

Будущий admin flow должен дать пользователю увидеть run history и import items до любого publish/apply action. Минимальная ручная проверка для каждого item:

- source URL and parsed title;
- parsed date/time and confidence;
- raw source text;
- proposed event fields;
- dedupe signals from `raw_payload.importReview.dedupe`;
- manual override warnings;
- final explicit action by an authorized admin/event manager.

Until that review action exists, imported items remain review data and must not become public events automatically.

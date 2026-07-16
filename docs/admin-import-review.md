# Admin import review

## Exact-duplicate maintenance

The Python API importer writes only review data. Exact repeats are skipped at
ingest time by `source_id + external_id` or by `source_id + canonical source
URL`; a title/time match remains a `possible_duplicate` for human review.

For review rows accumulated before that guard was available, use the
maintenance command from `apps/api`. It is dry-run by default and never
physically deletes rows:

```powershell
python scripts/ignore_exact_import_duplicates.py --dry-run
python scripts/ignore_exact_import_duplicates.py --dry-run --community-id <community-uuid>
python scripts/ignore_exact_import_duplicates.py --apply --source-id <source-uuid>
```

`--apply` is the only mode that changes data. It keeps the earliest open item
in each exact-duplicate group and marks only the extra `new`/`error` rows as
`ignored`; it does not hide title/time-only possible duplicates. The command
prints only reviewed-row, duplicate-group, planned-change, and changed counts.

Current status: web-admin triggers the Python API `apply_review_only` import
workflow and shows recent run history from `event_import_runs`. Import Review
also surfaces dedupe state from `raw_payload.importReview.dedupe` in the compact
queue and detail drawer. The browser uses no Supabase production runtime;
historical Edge material below is retained only as migration context.

Current UI status: the web-admin page is a human-facing review workspace. The
main view shows a lightweight header with the latest run status, journal,
refresh, and import actions; filters are a compact toolbar; and the empty queue
state points the admin back to starting an import. Technical importer details
such as mode names, Edge Function names, and RPC boundaries are kept out of the
main page chrome and exposed only in contextual help or implementation docs.
Publication remains manual: imported items become review data or hidden drafts
only after an explicit admin action, never public events automatically.

Этот документ фиксирует final architecture для Phase 2 admin-triggered import v2.
Текущий UI PR добавляет read layer и web-admin журнал запусков импорта. Он не
меняет Edge Function, parser, importer script или mobile flow.

Phase 1 server/staging beta v1 завершена без import button. Текущий importer из `scripts/importWebsiteEvents.mjs` остаётся временным owner/dev-only CLI flow до отдельных Phase 2 PRs. Он не является beta-admin UI и не переносится в Edge Function "как есть".

## Target pipeline

```text
web-admin button
  -> Python API
  -> parser/fetch
  -> event_import_runs
  -> event_import_items
  -> review queue
```

Default mode: `apply_review_only`.

В этом режиме backend flow создаёт import run и import items для проверки человеком. Import items попадают в review queue, а не напрямую в published events. No auto-publish: событие не становится published только потому, что parser нашёл карточку на сайте или смог уверенно распарсить дату.

## Historical Edge apply_review_only integration

Pre-cutover implementation in `supabase/functions/admin-website-import` kept
health and dry-run modes and adds `apply_review_only` as the review-write mode.
It uses the normal authenticated Supabase client with the caller's user session
token and calls the existing write RPC. It does not use a service-role key,
Supabase Admin API, server-only database connection strings, or raw
hosted-auth user-table reads.

`sourceUrl` is validated through the shared website parser allowlist before any
website fetch. Only `sredisvoih.com` and `www.sredisvoih.com` are accepted.
The browser/admin UI never receives server-only secrets.

Runtime flow:

1. validate CORS, auth, and active `admin` / `event_manager` access;
2. validate parser options and allowlisted `sourceUrl`;
3. resolve the active `sredi_svoih_events` import source visible to the caller;
4. call `admin_begin_import_run` with mode `apply_review_only`;
5. fetch and parse the website through the shared parser;
6. mirror each parsed event image into Supabase Storage when an image URL is
   available;
7. call `admin_upsert_import_item` for each parsed item;
8. call `admin_finalize_import_run` with `success` and safe summary counts.

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

## Event image mirror

`apply_review_only` mirrors parsed event images before writing import items. The
parser still extracts the best available image URL from the detail page,
`og:image`, or card image. The Edge Function then downloads that image with a
short timeout and stores it in the public `event-images` Storage bucket using
the caller's normal authenticated session.

Successful mirror paths are deterministic:

```text
community/<community_id>/website-import/<source_external_id_or_source_hash>/<sha256>.<ext>
```

When the mirror succeeds, the import item uses the Storage public URL in
`raw_payload.detail.image_url`, `raw_payload.parsed.image_url`, and the
top-level `raw_payload.imageUrl` / `raw_payload.image_url`. The original
external URL is preserved in `raw_payload.detail.original_image_url` and in
`raw_payload.importReview.imageMirror.originalUrl`.

Local Docker note: when the Edge Function runs inside Supabase Docker,
`SUPABASE_URL` may resolve to the internal `http://kong:8000` gateway. Set
`SUPABASE_PUBLIC_URL=http://127.0.0.1:54321` in
`supabase/functions/.env.local` so `imageMirror.publicUrl` and imported image
URLs are browser-facing.

Mirror metadata is stored under:

```text
event_import_items.raw_payload.importReview.imageMirror
```

Shape:

```json
{
  "status": "stored",
  "originalUrl": "https://www.sredisvoih.com/upload/example.jpg",
  "storageBucket": "event-images",
  "storagePath": "community/<community_id>/website-import/<source>/<sha>.jpg",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/event-images/...",
  "contentType": "image/jpeg",
  "byteSize": 12345,
  "sha256": "sha256:<hex>",
  "checkedAt": "2026-06-28T00:00:00.000Z",
  "error": null
}
```

If an image is missing or mirror download/upload fails, the import run
continues. The item keeps the original external image URL as fallback and
`imageMirror.status` is `missing` or `failed` with a short safe error message.
This does not change `event_import_items.status` constraints and does not
create, update, publish, or auto-publish events.

## Web-admin run button

`apps/admin/src/pages/ImportReviewPage.tsx` includes the button
`Запустить импорт в очередь проверки`. Before invoking the backend it shows a
confirmation dialog explaining that the site event page will be loaded, a new
import run will be created, events will not be published automatically, and
ambiguous items will go to the review queue.

The button uses the normal authenticated Supabase browser client and invokes
`admin-website-import` with this payload only:

```json
{ "mode": "apply_review_only" }
```

The UI does not expose advanced modes, `sourceUrl` override, dry-run controls,
scheduling, or retry automation. Dedupe UI is read-only and uses existing
`raw_payload.importReview.dedupe` data. The Edge Function performs role checks
and writes through the RPC boundary.

After a successful run, the UI shows the safe Edge summary, including `runId`,
found/parsed/error counts, and import item counts when those fields are present
in the response. It then reloads the current import review queue and run history
using `admin_list_import_items_needing_review` and `admin_list_import_runs`.

This import creates or updates only `event_import_runs` and
`event_import_items`. It does not create events, does not update events, does
not publish events, and does not auto-publish.

If another active run is already open for the same source, the button may show a
friendly `import_already_running` error. Timeout/network, access-denied,
invalid-source-url, and parser-error responses are surfaced as safe admin
messages without crashing the UI.

## Web-admin run history

`apps/admin/src/pages/ImportReviewPage.tsx` also shows a compact
`Журнал импорта` row with latest-run status. The full run history opens in a
modal. The data is still read from recent `event_import_runs` through the
read-only RPC `admin_list_import_runs(payload jsonb)`. The browser calls it with
the normal authenticated Supabase client; it does not use a service-role key,
Supabase Admin API, server-only database connection strings, or direct browser
writes.

The RPC derives the community server-side from the caller's active
`community_memberships` row with role `admin` or `event_manager`. `community_id`
from the browser is not accepted as source of truth. The RPC reads
`event_import_runs` and joins `event_import_sources` only for a safe source
name. It does not read or write the hosted-auth user table, does not create/update/publish
events, and does not mutate `event_import_runs` or `event_import_items`.

The history UI shows the latest run status and recent rows with:

- status label;
- `started_at`;
- `finished_at`;
- `found_count`;
- `created_count`;
- `updated_count`;
- readable `error` text for failed runs.

A recent `status = 'started'` run is highlighted and blocks the web-admin launch
button through the UI until the history no longer shows an active recent run.
This is only a browser safety layer; the backend `admin_begin_import_run`
already remains the authoritative already-running guard. Starting an import
still never publishes events automatically.

## Web-admin compact review list UX

The review queue list is optimized for operational triage. The page-level list
keeps only selection, thumbnail, title, compact badges, optional source domain,
and first-level actions. Full date, place, reason/notes, source URL,
registration URL, raw payload, and dedupe details stay available in the detail
drawer.

Current compact UX:

- full import run history is opened from the compact `Журнал импорта` row in a
  modal;
- queue items show a small thumbnail when `raw_payload` exposes an `imageUrl`;
  missing images use a local placeholder and do not load external fallback
  assets;
- each row can be selected with a checkbox; selecting items shows a contextual
  bulk bar with selected count, delete, and clear-selection actions;
- `Удалить` / `Удалить выбранные из очереди` uses the existing
  `admin_ignore_import_item` flow. It hides items from the review queue but does
  not physically delete rows from `event_import_items`;
- `Редактировать` opens the existing detail drawer directly in the event draft
  form backed by the existing `EventForm` and `admin_publish_import_item` draft
  flow. It does not edit `raw_payload` inline and does not use a separate update
  import-item RPC.

## Web-admin dedupe review UI

Import Review reads dedupe state only from:

```text
event_import_items.raw_payload.importReview.dedupe
```

The queue shows a compact dedupe badge for each item. The detail drawer includes
`Контроль дублей` with the v1 contract fields: status, reason, matchedBy,
matchedEventId, matchedImportItemId, manualOverride, sourceExternalId,
canonicalSourceUrl, contentHash, and checkedAt. If the dedupe object is missing,
the UI shows an unchecked/empty state and keeps the page usable.

This UI does not publish imported events automatically. It does not create,
update, delete, or auto-merge events. Existing actions remain explicit admin
actions through the authenticated Supabase client and RPC/RLS boundary.

Review rules shown by the UI:

- `possible_duplicate` requires manual review before creating an event.
- `duplicate` means a new event should not be created or published automatically.
- `manual_override_skipped` means the existing event was protected from being
  overwritten because of manual edits.
- `error` displays the dedupe reason/error text in the detail drawer.

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
- server-only database connection strings в `apps/admin`;
- Supabase Admin API;
- raw hosted-auth user-table reads/writes;
- server-only secrets в browser env;
- прямые browser DB writes в import tables.

Edge Function и write RPC должны проверять `auth.uid()` и роль пользователя. Админские действия остаются на RLS/RPC boundary. Events не публикуются автоматически.

Privacy boundary: prayer tracker приватный. Этот admin import flow не читает и не показывает private prayer-activity records и не меняет participants, registrations, seating или prayer tracker flows.

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

### Server-side dedupe preflight

`admin-website-import` now runs `admin_preflight_import_dedupe` after parser
dry-run and before `admin_upsert_import_item`. The RPC compares the parsed
batch with open review-queue items and existing `events` in the same community:

- existing open `event_import_items` in the same source/community are matched by
  external id, canonical/source URL, content hash, or title + starts_at and
  return `action = "skip_existing_import_item"`;
- existing `events` with `source_type = 'website_scrape'` in the same community
  are matched by source_external_id, source_url, or title + starts_at and return
  `action = "skip_existing_event"`;
- only `action = "write"` candidates are sent to `admin_upsert_import_item`.

Skipped candidates update the Edge Function summary (`itemsSkippedCount`,
`itemsSkippedExistingImportItemCount`, `itemsSkippedExistingEventCount`,
`itemsPossibleDuplicateEventCount`) and do not create rows. The review queue
continues to read dedupe state only from `raw_payload.importReview.dedupe` for
rows that exist.

## Phase 2 PR boundaries

Архитектура зафиксирована отдельным docs PR. Реализация разбита на отдельные PRs:

- write RPC — **реализовано** (см. [Write-RPC boundary](#write-rpc-boundary), migration `20260622140000_admin_import_write_rpc.sql`);
- Supabase Edge Function health/CORS/auth foundation - **implemented**;
- parser dry-run - **implemented**;
- `apply_review_only` Edge-to-write-RPC integration - **implemented**;
- import button UI - **implemented**;
- run history read RPC/UI - **implemented**;
- dedupe review UI - **implemented in web-admin as read-only JSON state**;
- server-side dedupe preflight RPC/Edge skip flow - **implemented**;
- detailed dedupe JSON contract — зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md).

Не делать в этом PR:

- schema changes beyond the read-only `admin_list_import_runs` RPC migration;
- importer execution;
- changes to `scripts/importWebsiteEvents.mjs`;
- unrelated backend/RPC changes beyond the dedupe preflight boundary;
- mobile, registrations, seating или prayer tracker changes.

## Manual review expectation

Admin flow должен дать пользователю увидеть run history, import items и dedupe
state до любого publish/apply action. Минимальная ручная проверка для каждого
item:

- source URL and parsed title;
- parsed date/time and confidence;
- raw source text;
- proposed event fields;
- dedupe signals from `raw_payload.importReview.dedupe`;
- manual override warnings;
- final explicit action by an authorized admin/event manager.

Imported items remain review data and must not become public events
automatically.

## Manual smoke

Manual smoke for this admin import page is performed by the project owner.
Codex does not run browser smoke.

Checklist:

- Open “Импорт с сайта”.
- Confirm the top area is one compact header with `Импорт с сайта`, latest-run
  status, `Журнал`, `Обновить`, and `Запустить импорт`.
- Confirm technical importer details are not visible in the main page text and
  appear only in the small status help tooltip.
- Open the history modal and close it by X, backdrop, and Escape.
- Confirm the import runner remains blocked while a recent `started` run exists.
- Confirm filters render as one compact toolbar row: search, date quality,
  status, and limit.
- With an empty queue, confirm the empty state shows `Очередь проверки пуста`,
  the text `Запустите импорт, чтобы собрать новые события с сайта на ручную
  проверку`, and a `Запустить импорт` action.
- Confirm import item cards are compact and show thumbnail or local placeholder.
- Open a thumbnail and confirm it opens `imageUrl` in a new tab.
- Open “Подробнее” and confirm date, place, reason/notes, source,
  registration URL, raw payload, and dedupe panel are still available.
- Click “Редактировать” from a row and confirm the existing draft event form opens
  immediately.
- Click row “Удалить”, confirm, and verify the item disappears from the queue.
- Select several rows, click “Удалить выбранные из очереди”, confirm, and verify
  selected items disappear from the queue.
- Confirm events are not published automatically.

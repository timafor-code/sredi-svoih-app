# Admin import dedupe contract (v1)

Этот документ фиксирует единый v1 JSON contract для dedupe state импортируемых событий. Contract — это docs/contract PR: код, schema, migrations, Edge Functions, RPC, importer script и `apps/admin` UI не меняются. Реализация importer/Edge/RPC/UI в этом PR не начинается.

Цель: дать текущему owner/dev-only CLI importer (`scripts/importWebsiteEvents.mjs`) и будущей Supabase Edge Function **одинаковую** форму dedupe state, чтобы review queue могла читать её единообразно независимо от того, какой flow записал item.

## Где живёт dedupe state

Canonical и единственное место для dedupe state:

```text
event_import_items.raw_payload.importReview.dedupe
```

Dedupe state — это часть JSON review payload, а не отдельная колонка и не table status. Он дополняет существующий объект `importReview` (см. [website-events-importer.md](website-events-importer.md)), добавляя в него поле `dedupe`.

## Contract shape (v1)

```json
{
  "version": 1,
  "status": "new | duplicate | possible_duplicate | updated_existing | linked_existing | manual_override_skipped | error",
  "reason": "Human readable reason",
  "matchedBy": ["source_external_id", "canonical_url", "title_starts_at", "content_hash", "linked_event_id"],
  "matchedEventId": null,
  "matchedImportItemId": null,
  "manualOverride": false,
  "contentHash": "...",
  "canonicalSourceUrl": "...",
  "sourceExternalId": "...",
  "checkedAt": "2026-06-22T00:00:00.000Z"
}
```

`dedupe` живёт внутри `importReview`, например:

```json
{
  "dateConfidence": "confident",
  "dateStatus": "ready",
  "reason": "Full date with year and time found.",
  "parserVersion": "1.1.0",
  "dedupe": {
    "version": 1,
    "status": "new",
    "reason": "No existing event matched by stable key.",
    "matchedBy": [],
    "matchedEventId": null,
    "matchedImportItemId": null,
    "manualOverride": false,
    "contentHash": "sha256:...",
    "canonicalSourceUrl": "https://www.sredisvoih.com/events/example-event",
    "sourceExternalId": "example-event",
    "checkedAt": "2026-06-22T00:00:00.000Z"
  }
}
```

## Semantics полей

- `version` — integer, версия contract. Для этого contract всегда `1`. Позволяет читателям (review queue, отчёты) корректно интерпретировать форму и эволюционировать contract без поломки старых items.
- `status` — string, итог dedupe-проверки для item. Допустимые значения перечислены ниже в [Allowed status values](#allowed-status-values). Это **dedupe state**, не table status.
- `reason` — string, human-readable объяснение, почему выбран данный `status` (например, какой именно match сработал или почему item помечен как possible duplicate). Предназначено для отображения человеку в review queue.
- `matchedBy` — массив строк, перечень сигналов, по которым найдено совпадение. Допустимые значения перечислены ниже в [Allowed matchedBy values](#allowed-matchedby-values). Пустой массив `[]` для `status = "new"` (совпадений нет). Может содержать несколько сигналов одновременно.
- `matchedEventId` — `string | null`. UUID существующего `events.id`, с которым item соотнесён (duplicate / updated_existing / linked_existing). `null`, если совпадения с event нет.
- `matchedImportItemId` — `string | null`. UUID существующего `event_import_items.id`, с которым item соотнесён (например, дубль в пределах того же или предыдущего run). `null`, если совпадения с другим import item нет.
- `manualOverride` — boolean. `true`, если соответствующее событие защищено `events.manual_override = true` и dedupe-проверка не должна перетирать его. Используется вместе со `status = "manual_override_skipped"`.
- `contentHash` — string, стабильный хэш нормализованного контента карточки (например, title + starts_at + описание), вычисленный по фиксированному правилу. Используется как сигнал `content_hash` для определения изменений и совпадений.
- `canonicalSourceUrl` — string, канонический URL источника карточки. Используется как сигнал `canonical_url`. Должен быть нормализован (без трекинг-параметров и т.п.) для стабильного сравнения.
- `sourceExternalId` — string, стабильный внешний ключ источника (для website scrape — slug из URL события). Используется как сигнал `source_external_id` и соответствует существующему ключу связывания `source_type = website_scrape` + `source_external_id`.
- `checkedAt` — string, ISO 8601 timestamp (UTC, с миллисекундами), момент выполнения dedupe-проверки. Не путать с временем создания item; это время, когда вычислен данный dedupe state.

## Allowed status values

`status` принимает строго одно из значений:

- `new` — совпадений не найдено; item считается новым событием. `matchedBy` пуст, `matchedEventId` и `matchedImportItemId` обычно `null`.
- `duplicate` — найден точный дубль уже существующего события/item; новое событие создавать не нужно.
- `possible_duplicate` — найдено вероятное, но не точное совпадение; требуется ручное решение в review queue.
- `updated_existing` — совпадение с существующим событием, контент изменился; item представляет обновление существующего события (`matchedEventId` заполнен).
- `linked_existing` — item связан с существующим событием по стабильному ключу без изменения контента (`matchedEventId` заполнен).
- `manual_override_skipped` — найдено совпадающее событие с `manual_override = true`; запись/обновление пропущены, чтобы не перетереть ручные правки (`manualOverride = true`).
- `error` — dedupe-проверку не удалось выполнить для этого item; `reason` объясняет ошибку.

Эти значения — **dedupe state в JSON**, а не table status. Они не отражаются в `event_import_items.status` или `event_import_runs.status`.

## Allowed matchedBy values

`matchedBy` — массив, каждый элемент строго одно из:

- `source_external_id` — совпадение по стабильному внешнему ключу источника (slug). Самый сильный сигнал для website scrape.
- `canonical_url` — совпадение по нормализованному каноническому URL источника.
- `title_starts_at` — совпадение по комбинации нормализованного заголовка и `starts_at`.
- `content_hash` — совпадение по `contentHash` нормализованного контента.
- `linked_event_id` — совпадение по уже связанному `linked_event_id` существующего import item.

## Boundary (жёстко зафиксировано)

Этот contract намеренно держит весь dedupe state в JSON review payload. Запрещено:

- **Do not extend `event_import_items.status`.**
- **Do not extend `event_import_runs.status`.**
- **Dedupe state lives only in `raw_payload.importReview.dedupe`.**

Никакие dedupe-значения (`duplicate`, `possible_duplicate`, `updated_existing`, `linked_existing`, `manual_override_skipped` и т.д.) не добавляются в table status columns и не расширяют table CHECK constraints.

### Existing table statuses remain unchanged

Существующие table status columns остаются как есть:

- `event_import_items.status`: `new | linked | ignored | error`
- `event_import_runs.status`: `started | success | failed`

Table status columns описывают технические состояния import run/item. Dedupe и review decisions относятся к JSON review payload.

## Consumers

- **Current CLI importer** (`scripts/importWebsiteEvents.mjs`) — owner/dev-only flow. В будущих implementation PRs должен писать `raw_payload.importReview.dedupe` в этой форме. **В этом PR importer writes не меняются.**
- **Future Supabase Edge Function** — admin-triggered backend flow (web-admin button -> Edge Function -> parser/fetch -> write RPC -> runs/items -> review queue). Должна писать **одинаковую** форму `raw_payload.importReview.dedupe`.
- **Review queue / admin UI** — читает dedupe state из `raw_payload.importReview.dedupe`, а не из table status columns. См. [admin-import-review.md](admin-import-review.md).

## Write-RPC и dedupe state

Write-RPC слой (`supabase/migrations/20260622140000_admin_import_write_rpc.sql`, см. [Write-RPC boundary](admin-import-review.md#write-rpc-boundary)) сохраняет границу этого contract:

- `admin_upsert_import_item` принимает `rawPayload` как jsonb-объект и сохраняет его **verbatim** в `event_import_items.raw_payload`. Если вызывающий передал `importReview.dedupe`, dedupe state остаётся внутри `raw_payload.importReview.dedupe` без изменений.
- RPC берёт `event_import_items.status` **только** из допустимых table-статусов `new | linked | ignored | error`. Никакое dedupe-значение (`duplicate`, `possible_duplicate`, `updated_existing`, `linked_existing`, `manual_override_skipped`) не попадает в status-колонку и не расширяет CHECK-ограничения.
- `event_import_runs.status` остаётся `started | success | failed`; финализация допускает только `success`/`failed`.

То есть write boundary физически не может переместить dedupe state из JSON в table status, что и закрепляет данный contract на уровне backend.

## Optional shared TypeScript type

Type-only описание contract доступно в [`src/types/importDedupe.ts`](../src/types/importDedupe.ts). Этот файл:

- экспортирует только типы (никакого runtime кода);
- не подключён к importer или UI;
- не добавляет зависимостей и не меняет сборку.

Он существует как single source of truth для формы payload и должен оставаться синхронным с этим документом.

# Website Events Importer

Локальный importer событий сайта `https://www.sredisvoih.com/events/` живёт в `scripts/importWebsiteEvents.mjs`.
Это owner/dev-only backend tool: он не импортируется из React Native приложения, не является частью Expo bundle и не является beta-admin UI.

Phase 1 server/staging beta v1 завершается без import button в `apps/admin`. До реализации Phase 2 текущий CLI остаётся временным owner-only/dev flow вне browser-admin. Его можно использовать только как локальный инструмент владельца проекта или разработчика, а не как модель доступа для админов в браузере.

## Phase 2 target architecture

Final architecture для admin-triggered import v2:

```text
web-admin button
  -> Supabase Edge Function
  -> parser/fetch
  -> write RPC
  -> event_import_runs
  -> event_import_items
  -> review queue
```

В Phase 2 importer должен перейти на backend boundary: browser-admin вызывает только безопасный authenticated flow, Edge Function проверяет пользователя и роль, write RPC пишет runs/items, а результат попадает в review queue. События не публикуются автоматически.

Текущий CLI не переносится в Edge Function "как есть". Parser/fetch, write RPC, режим `apply_review_only`, import button, run history и dedupe review UI будут выделены в отдельные PR с отдельными контрактами и проверками.

## Phase 2 boundaries

Этот PR только фиксирует архитектуру и не меняет код. Следующие части Phase 2 идут отдельно:

- write RPC;
- Supabase Edge Function;
- parser dry-run;
- `apply_review_only`;
- import button UI;
- run history UI;
- dedupe review UI.

Default mode для будущего admin-triggered import: `apply_review_only`. Это означает запись `event_import_runs` и `event_import_items` для ручной проверки, без прямой публикации событий.

Explicit rules:

- no auto-publish;
- no direct browser DB writes;
- no `DATABASE_URL` in `apps/admin`;
- no service-role key in browser-admin or browser-triggered import flow;
- no Supabase Admin API;
- no raw `auth.users` access;
- dedupe statuses live in `raw_payload.importReview.dedupe` JSON, not in `event_import_items.status` or `event_import_runs.status` table status columns.

Detailed v1 dedupe JSON contract зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md). И текущий CLI, и будущая Edge Function должны писать **одинаковую** форму `raw_payload.importReview.dedupe`. Dedupe/review status не расширяет table CHECK constraints и не добавляет `duplicate` / `possible_duplicate` в table status columns. Текущий owner/dev-only CLI уже пишет этот dedupe shape (см. [Объект dedupe (v1 contract)](#объект-dedupe-v1-contract)); будущая Edge Function должна писать ту же форму.

## Запуск

Команды ниже относятся только к текущему owner/dev-only CLI. Они не запускаются из browser-admin и не описывают будущую beta-admin кнопку.

Dry-run — ничего не пишет в БД, показывает что было бы сделано:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry
```

Apply — owner/dev-only режим, который пишет import run/items и по текущему CLI-контракту может создать или обновить события:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events -- --limit 3 --apply
```

Review report — показывает items из БД, требующие ручной проверки:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:review -- --limit 20
```

## Доступные флаги

```text
--dry-run                   Только парсинг, без записи в БД (по умолчанию)
--apply                     Записать в БД, создать/обновить события
--review                    Показать items из БД, требующие ручной проверки
--limit N                   Обработать не более N карточек (или показать N review items)
--source-url URL            Переопределить URL страницы событий
--verbose                   Выводить каждый fetch-запрос
--assume-year YYYY          Подставить год для частичных дат (день + месяц без года)
--create-drafts             (только с --apply) Создать draft/hidden события для partial дат с suggestedStartsAt
```

Если не указан ни `--dry-run`, ни `--apply`, используется dry-run.

## Env

Importer использует прямое PostgreSQL-подключение через `DATABASE_URL`.
Если переменная не задана, используется локальный Supabase default:

```text
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`.env.local` можно использовать локально, но он игнорируется Git. Публичные Expo-переменные не используются importer-ом.

`DATABASE_URL` остаётся только локальным/server-side dev secret для CLI. Его нельзя добавлять в `apps/admin`, browser env или staging SPA settings.

## Таблицы

Текущий CLI-пайплайн:

```text
website -> parser -> event_import_runs -> event_import_items -> events -> app
```

Целевой Phase 2 admin pipeline:

```text
web-admin button -> Supabase Edge Function -> parser/fetch -> write RPC -> event_import_runs -> event_import_items -> review queue
```

Importer использует:

```text
event_import_sources
event_import_runs
event_import_items
events
communities
```

Source ищется или создаётся с `parser_name = sredi_svoih_events`.
События связываются по стабильному ключу `source_type = website_scrape` + `source_external_id`.

В целевом Phase 2 flow browser-admin не пишет напрямую в эти таблицы. Запись выполняется через backend boundary: Edge Function + authenticated write RPC с проверкой `auth.uid()` и роли.

## Классификация качества даты (dateConfidence)

Каждый импортированный item получает оценку качества найденной даты.
Эта оценка хранится в `event_import_items.raw_payload.importReview.dateConfidence`.

| Значение              | Описание                                                         | Публикуется? |
|-----------------------|------------------------------------------------------------------|--------------|
| `confident`           | Дата = день + месяц + год + время. Можно построить `starts_at`. | Да           |
| `partial`             | Есть день + месяц, но нет года. Или есть дата, но нет времени.  | Нет          |
| `recurring_rule`      | Есть день недели («по четвергам») или Шаббат, но нет даты.      | Нет          |
| `none`                | Пригодной даты не найдено.                                       | Нет          |

### Почему сайт sredisvoih.com часто даёт needs_review

Сайт регулярно публикует события с неполными датами:

- «Начало занятий: 13 ноября» — есть день и месяц, но нет года → `partial`
- «по четвергам, 19:30» — есть день недели и время, но нет конкретной даты → `recurring_rule`
- «Шаббат 19:00» — Шаббат каждую неделю, нет конкретной даты → `recurring_rule`

Importer правильно не создаёт published-события для таких карточек.
Все они сохраняются как `event_import_items` со статусом `ignored` и
`raw_payload.importReview.dateStatus = 'needs_review'`.

## Структура importReview

Каждый item в `raw_payload` содержит объект `importReview`:

```json
{
  "dateConfidence": "partial",
  "dateStatus": "needs_review",
  "reason": "Day and month found, but no year. Use --assume-year YYYY to provide one.",
  "rawDateText": "Начало занятий: 13 ноября | по четвергам, 19:30",
  "rawTimeText": "19:30",
  "inferred": false,
  "assumedYear": null,
  "suggestedStartsAt": null,
  "parserVersion": "1.1.0",
  "dedupe": {
    "version": 1,
    "status": "new",
    "reason": "No existing event linked; saved for manual review (date not confident).",
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

Для confident дат `dateStatus = "ready"` и `reason = "Full date with year and time found."`.

### Объект dedupe (v1 contract)

Каждый `importReview` содержит вложенный объект `dedupe` — единый v1 JSON contract dedupe state,
зафиксированный в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md). И текущий CLI, и
будущая Edge Function пишут **одинаковую** форму `raw_payload.importReview.dedupe`, чтобы review queue
читала её единообразно.

Поля `contentHash`, `canonicalSourceUrl`, `sourceExternalId` вычисляются на этапе парсинга и стабильны.
`status`, `reason`, `matchedBy`, `matchedEventId`, `manualOverride` и `checkedAt` финализируются на
этапе `--apply`, когда CLI сверяется с БД по стабильному ключу
`source_type = website_scrape` + `source_external_id`.

CLI отображает существующее поведение importer на v1 статусы так:

| Поведение CLI (`--apply`)                                              | `dedupe.status`           | `matchedBy`            |
|------------------------------------------------------------------------|---------------------------|------------------------|
| Совпадений нет → создано новое событие                                 | `new`                     | `[]`                   |
| Найдено существующее событие по стабильному ключу → контент обновлён   | `updated_existing`        | `["source_external_id"]` |
| Найдено событие с `manual_override = true` → не перетёрто               | `manual_override_skipped` | `["source_external_id"]` |
| Non-confident дата → событие не создаётся, item уходит в review         | `new`                     | `[]`                   |
| Ошибка fetch/parse для item                                            | `error`                   | `[]`                   |

В режиме `--dry-run` CLI ничего не пишет в БД: показывается только parse-time baseline
(`contentHash` и т.п.), без сверки с существующими событиями. Финальный `status`/`matchedEventId`
определяется только при `--apply`.

CLI не добавляет dedupe-значения в table status columns. `event_import_items.status` остаётся
`new | linked | ignored | error`, `event_import_runs.status` — `started | success | failed`.
Dedupe state живёт только в `raw_payload.importReview.dedupe`.

## Флаг --assume-year

Если у события есть день и месяц, но нет года, можно указать год явно:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry -- --assume-year 2026
```

При этом:
- `importReview.assumedYear = 2026` записывается в payload
- Если найдено время — `importReview.suggestedStartsAt` получает рассчитанное значение
- `dateConfidence` остаётся `partial` — даже с годом это не автоматическая публикация
- Для создания draft-события нужен дополнительный флаг `--create-drafts`

Для `recurring_rule` (день недели, Шаббат) одного `--assume-year` недостаточно — конкретная дата неизвестна, event не создаётся.

## Флаг --create-drafts

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events -- --apply --assume-year 2026 --create-drafts --limit 3
```

Поведение:
- Работает только вместе с `--apply`
- Если `dateConfidence = partial` и `importReview.suggestedStartsAt` доступен (т.е. есть день + месяц + год из `--assume-year` + время):
  - Создаётся событие с `status = 'draft'` и `visibility = 'hidden'`
  - `starts_at` берётся из `suggestedStartsAt`
  - Событие не видно гостям и неаутентифицированным пользователям
- Если `suggestedStartsAt` недоступен (нет времени, или `recurring_rule`, или `none`) — событие не создаётся, item остаётся как needs_review
- **Никогда не создаёт `status = 'published'` из неуверенной даты**

## Правила безопасности

### Admin-triggered import boundary

Для будущего import button браузерный admin-клиент использует только обычный authenticated Supabase client и user session token. Браузер не получает service-role key, `DATABASE_URL`, server-only secrets или Supabase Admin API credentials.

Edge Function и write RPC должны проверять `auth.uid()` и роль пользователя через RLS/RPC boundary. Parser/fetch и запись runs/items выполняются на backend стороне. События не публикуются автоматически: import items идут в review queue.

### manual_override защита

`events.manual_override = true` не перетирается. В этом случае:
- Import item сохраняется как `status = 'ignored'`
- `raw_payload.importReview.reason` содержит `"manual_override protected."`
- Summary показывает `manual_override_skipped`

### Защита от дублей

Повторный apply не создаёт дубли. События связываются по стабильному ключу
`source_type = 'website_scrape'` + `source_external_id` (slug из URL события).

### Нет service role key

Importer использует прямое PostgreSQL-подключение (`DATABASE_URL`), не Supabase JS client.
Service role ключ не используется нигде.

Для `apps/admin` и будущего browser-triggered import flow также запрещены service-role key, Supabase Admin API и server-only database credentials.

### Нет публикации с сомнительной датой

События с `dateConfidence != 'confident'` не получают `status = 'published'`.
Даже с `--assume-year` и `--create-drafts` создаётся только `draft/hidden`.

В Phase 2 default mode будет строже: `apply_review_only` не публикует события автоматически даже при confident parse. Публикация возможна только после явного review/action отдельным безопасным flow.

### Dedupe status boundary

Dedupe status — часть JSON review payload, его v1 contract зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md):

```text
event_import_items.raw_payload.importReview.dedupe
```

И текущий CLI, и будущая Edge Function пишут одинаковую форму этого объекта. Текущий owner/dev-only CLI (`scripts/importWebsiteEvents.mjs`) уже записывает `raw_payload.importReview.dedupe` по v1 contract при `--apply`. Не расширять `event_import_items.status` или `event_import_runs.status` ради dedupe states. Не добавлять `duplicate` или `possible_duplicate` в table CHECK constraints.

## Review report

Показывает items из БД, требующие ручной проверки:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:review -- --limit 20
```

Отчёт выводит:
- Последние import runs (до 5 штук)
- Items со статусом `ignored` или `error`:
  - `parsed_title`
  - `source_url`
  - `status`
  - `dateConfidence` (из importReview)
  - `dateStatus` (из importReview)
  - `reason` (из importReview)
  - `rawDateText`
  - `rawTimeText`
  - `assumedYear` (если задавался)
  - `suggestedStartsAt` (если вычислен)
  - `linked_event_id`
- Summary по dateConfidence

## Полные примеры команд

```powershell
# Сухой прогон — показать что найдено на сайте
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry

# Сухой прогон с предположением о годе (для partial дат)
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry -- --assume-year 2026

# Apply первых трёх карточек
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events -- --limit 3 --apply

# Посмотреть items, требующие проверки
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:review -- --limit 20

# Apply с созданием draft-событий для partial дат
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events -- --limit 3 --apply --assume-year 2026 --create-drafts

# Подробный вывод (все fetch-запросы)
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry -- --verbose
```

## Summary полей в консоли

После dry-run:

```text
Dry-run summary:
  found_on_list=7, parsed=7
  confident=0, partial=5, recurring_rule=2, none=0, errors=0
  partial_with_suggested_starts_at=3 (assuming year 2026)
```

После apply:

```text
Apply summary: run_id=...
  found=7
  confident=0, partial=5, recurring_rule=2, none=0
  created=0, updated=0, ignored=7
  needs_review=7, item_errors=0, manual_override_skipped=0
```

## Что НЕ делает этот инструмент

- Не импортируется в React Native клиент (`app/`, `src/`)
- Не использует Supabase JS client или service role key
- Не является beta-admin UI и не добавляет import button в `apps/admin`
- Не добавляет `DATABASE_URL` в `apps/admin`
- Не использует Supabase Admin API и не читает raw `auth.users`
- Не создаёт published-события без уверенной даты
- Не перетирает `events.manual_override = true`
- Не затрагивает Auth / invite / membership flow
- Не делает оплату и не меняет registration RPC

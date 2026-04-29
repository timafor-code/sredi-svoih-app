# Website Events Importer

Локальный importer событий сайта `https://www.sredisvoih.com/events/` живёт в `scripts/importWebsiteEvents.mjs`.
Это dev/backend tool: он не импортируется из React Native приложения и не является частью Expo bundle.

## Запуск

Dry-run — ничего не пишет в БД, показывает что было бы сделано:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run import:events:dry
```

Apply — пишет import run/items и безопасно создаёт или обновляет события:

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

## Таблицы

Пайплайн:

```text
website -> parser -> event_import_runs -> event_import_items -> events -> app
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
  "parserVersion": "1.1.0"
}
```

Для confident дат `dateStatus = "ready"` и `reason = "Full date with year and time found."`.

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

### Нет публикации с сомнительной датой

События с `dateConfidence != 'confident'` не получают `status = 'published'`.
Даже с `--assume-year` и `--create-drafts` создаётся только `draft/hidden`.

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
- Не создаёт published-события без уверенной даты
- Не перетирает `events.manual_override = true`
- Не затрагивает Auth / invite / membership flow
- Не делает оплату и не меняет registration RPC

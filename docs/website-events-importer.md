# Website Events Importer

Локальный importer событий сайта `https://www.sredisvoih.com/events/` живет в `scripts/importWebsiteEvents.mjs`.
Это dev/backend tool: он не импортируется из React Native приложения и не является частью Expo bundle.

## Запуск

Dry-run ничего не пишет в БД:

```powershell
npm run import:events:dry
```

Apply пишет import run/items и безопасно создает или обновляет события:

```powershell
npm run import:events -- --limit 3 --apply
```

Доступные флаги:

```text
--dry-run
--apply
--limit N
--source-url https://www.sredisvoih.com/events/
--verbose
```

Если не указан ни `--dry-run`, ни `--apply`, используется dry-run.

## Env

Importer использует прямое PostgreSQL-подключение через `DATABASE_URL`.
Если переменная не задана, используется локальный Supabase default:

```text
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`.env.local` можно использовать локально, но он игнорируется Git. Публичные Expo-переменные не используются для записи importer-ом.

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

Source ищется или создается с `parser_name = sredi_svoih_events`.
События связываются по стабильному ключу `source_type = website_scrape` + `source_external_id`.

## Правила безопасности

`events.manual_override = true` не перетирается. В этом случае import item сохраняется как `ignored` и связывается с найденным событием.

Если `starts_at` нельзя уверенно определить по полной дате с годом и времени, published-событие не создается. Import item сохраняется как `ignored`, а причина пишется в `raw_payload`.

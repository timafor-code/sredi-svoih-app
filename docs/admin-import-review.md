# Admin import review

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

Этот PR только фиксирует architecture. Реализация будет разбита на отдельные PRs:

- write RPC;
- Supabase Edge Function;
- parser dry-run;
- `apply_review_only`;
- import button UI;
- run history UI;
- dedupe review UI;
- detailed dedupe JSON contract — зафиксирован в [admin-import-dedupe-contract.md](admin-import-dedupe-contract.md).

Не делать в этом PR:

- code changes;
- schema changes;
- migrations;
- importer execution;
- Edge Functions;
- import button;
- changes to `scripts/importWebsiteEvents.mjs`;
- changes to `apps/admin`;
- backend/RPC changes;
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

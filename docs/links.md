# «Среди Своих» — человекопонятные ссылки веб-регистрации

- Версия: 1.0
- Дата: 10 августа 2026 года
- Статус: утверждаемая техническая спецификация для серии PR
- Репозиторий: `timafor-code/sredi-svoih-app`
- Базовая ветка: `main`
- Проверенный commit `main`: `2adb81253ac3fe7c3f4b78f536a6597375699e45`
- Последний объединённый PR: #373 `feature/api-web-event-slug-foundation`
- Предыдущие связанные PR: #372, #371, #370, #356, #354, #342, #341, #340

## 1. Назначение документа

Документ заменяет прежнее решение о UUID в публичном адресе события и уточняет поведение постоянных и повторяющихся событий.

Он дополняет `docs/web-event-registration.md`, `docs/admin-event-web-registration.md`, `docs/event-occurrences.md` и `docs/app-start.md`. Если старые документы расходятся с этой спецификацией в вопросах публичного адреса, occurrence-ссылок или выбора даты, приоритет имеет `links.md`.

## 2. Проверенное текущее состояние

Сейчас реализовано:

- каноническая ссылка имеет вид `/events/{public_slug}`;
- абсолютный адрес вычисляет FastAPI из backend-only `PUBLIC_WEB_BASE_URL`;
- полный URL не хранится в PostgreSQL и не вводится в браузере;
- web-admin показывает read-only `public_registration_url`;
- deprecated `occurrence_urls` пока возвращаются как `/events/{public_slug}?occurrence={occurrence_uuid}` и остаются видимыми в неизменённом web-admin;
- `apps/web/src/route.ts` различает canonical/alias slug и legacy UUID;
- публичная форма загружается через `GET /web/events/{public_slug}/registration-form`, а legacy UUID endpoint сохранён;
- canonical slug, alias и legacy UUID после успешного ответа используют backend-поле `canonical_public_path`; browser применяет `replaceState` без повторного fetch;
- `apps/web` уже выводит выбор даты, если occurrences больше одного, но основная страница автоматически выбирает первую дату;
- модель уже различает `event_kind`, `is_permanent`, parent event и `event_occurrences`;
- mobile уже различает два продуктовых сценария: выбор даты для многоразового цикла и ближайший occurrence по окну регистрации для Шабата;
- mobile guest public-web adapter намеренно fail-closed, потому что анонимный event DTO пока не содержит доверенный `public_registration_url`.

## 3. Итоговый продуктовый контракт

### 3.1. Канонический адрес

Публичный адрес события:

```text
https://<production-domain>/events/{public_slug}
```

Примеры:

```text
/events/tsikl-lektsiy-po-istorii
/events/shabbat
/events/prazdniki-tishreya
```

Организатор редактирует только человекопонятную часть `public_slug`. Домен, протокол и префикс `/events/` по-прежнему определяет backend через `PUBLIC_WEB_BASE_URL`.

Нельзя разрешать ввод произвольного полного URL: это может создать ошибочный домен, небезопасную схему или расхождение между окружениями.

### 3.2. Один parent event — один основной адрес

- Один event/series имеет один канонический адрес независимо от числа дат.
- Добавление, архивирование или перенос occurrence не меняет адрес parent event.
- Переименование заголовка события само по себе не меняет уже назначенный slug.
- Выключение и повторное включение `web_visibility` не меняет адрес.
- Для постоянного события новые даты добавляются в `event_occurrences`, а не создают новые публичные страницы.
- Web-admin по умолчанию копирует только основной адрес parent event.
- Отдельные occurrence-ссылки больше не являются основным операторским сценарием и не показываются в web-admin.

### 3.3. Явное изменение адреса

Редактор может явно изменить slug. Это единственное действие, которое меняет канонический адрес.

Старый slug после такого изменения сохраняется как alias и продолжает открывать то же событие. Публичный web заменяет старый путь на новый канонический путь без потери query-параметров. На deployment-уровне предпочтителен HTTP 308, но SPA fallback обязан работать и без него.

Так ранее отправленные ссылки не ломаются.

## 4. Slug: нормализация и генерация

### 4.1. Разрешённый формат

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Ограничения:

- только строчные ASCII `a-z`, цифры и одиночный дефис между сегментами;
- длина от 2 до 80 символов;
- пробелы, `_`, повторные дефисы и знаки препинания нормализуются;
- slug не может совпадать с UUID-паттерном, чтобы старый UUID route оставался однозначным;
- зарезервированные значения отклоняются: `new`, `admin`, `api`, `auth`, `privacy`, `support`, `assets`, `static`, `null`, `undefined`;
- сравнение уникальности выполняется по нормализованному lowercase значению.

### 4.2. Русская транслитерация

Используется одна backend-функция с фиксированной таблицей, без внешнего online-сервиса:

```text
а a   б b   в v   г g   д d   е e   ё yo
ж zh  з z   и i   й y   к k   л l   м m
н n   о o   п p   р r   с s   т t   у u
ф f   х kh  ц ts  ч ch  ш sh  щ shch
ъ -   ы y   ь -   э e   ю yu  я ya
```

Перед транслитерацией применяется Unicode NFKC, trim и lowercase. После неё все группы символов вне `[a-z0-9]` заменяются одним дефисом, повторные дефисы схлопываются, крайние дефисы удаляются.

Примеры:

| Заголовок | Slug |
| --- | --- |
| `Цикл лекций по истории` | `tsikl-lektsiy-po-istorii` |
| `Шабат` | `shabbat` |
| `Праздники Тишрея — 2026` | `prazdniki-tishreya-2026` |
| `Среди Своих` | `sredi-svoikh` |

### 4.3. Автоматическая генерация

Если редактор не задал slug:

1. Backend строит base slug из заголовка.
2. Если после нормализации значение пустое, используется `event-{short_uuid}`.
3. Если base slug свободен, он становится каноническим.
4. При коллизии backend последовательно пробует `base-2`, `base-3` и далее, сохраняя предел 80 символов.
5. Конкурентные создания защищаются уникальным индексом и транзакционным retry; одной предварительной UI-проверки недостаточно.

Автоматически назначенный slug не пересчитывается при обычном изменении заголовка.

### 4.4. Ручной ввод и проверка занятости

- Поле принимает suffix, а не полный URL.
- UI показывает итоговый preview: `https://<domain>/events/<slug>`.
- Проверка выполняется после debounce и на blur через authenticated FastAPI endpoint.
- Текущий slug редактируемого event считается доступным для него самого.
- Slug другого event или его alias считается занятым.
- UI-проверка является подсказкой; PATCH повторяет проверку в транзакции.
- При коллизии ручного значения backend возвращает `409 public_slug_taken`; он не добавляет `-2` молча.
- При невалидном значении backend возвращает `422 invalid_public_slug` и нормализованный preview, если он может быть безопасно построен.
- Не нужно делать fuzzy-поиск похожих названий: блокируется именно совпадающий нормализованный URL.

## 5. Модель данных

Рекомендуемая каноническая таблица:

```text
event_public_slugs
- id uuid primary key
- event_id uuid not null references events(id) on delete cascade
- slug text not null
- is_canonical boolean not null
- created_at timestamptz not null
- created_by uuid null
```

Ограничения:

- unique index на `lower(slug)`;
- partial unique index: один `is_canonical = true` на `event_id`;
- check constraint на допустимый lowercase формат и длину;
- alias — та же строка с `is_canonical = false`;
- aliases не удаляются обычным редактированием, чтобы старые ссылки продолжали работать.

Миграция должна:

1. Создать таблицу и индексы.
2. Для каждого существующего event в стабильном порядке `created_at, id` создать один канонический slug из title.
3. Разрешить коллизии детерминированными suffix `-2`, `-3`.
4. Не менять `events.id`, occurrences, registrations или `web_visibility`.
5. Не хранить полный URL.
6. Иметь безопасный downgrade только для новой таблицы/индексов.

Публичные slugs не содержат персональных данных.

## 6. Backend API

### 6.1. Admin read

`GET /admin/events/{event_id}/web-registration` возвращает:

```json
{
  "event_id": "uuid",
  "web_visibility": "unlisted",
  "public_slug": "tsikl-lektsiy-po-istorii",
  "public_registration_url": "https://<domain>/events/tsikl-lektsiy-po-istorii"
}
```

`occurrence_urls` после согласованного frontend-перехода удаляется из нового контракта. На промежуточном этапе поле можно временно оставить deprecated, но web-admin не должен показывать список отдельных ссылок.

### 6.2. Availability

```text
POST /admin/events/{event_id}/web-registration/check-slug
```

Request:

```json
{ "public_slug": "Цикл лекций по истории" }
```

Response:

```json
{
  "normalized_slug": "tsikl-lektsiy-po-istorii",
  "available": true,
  "reason": null
}
```

Endpoint требует действующего admin permission и community scope для event. Он не изменяет данные и не раскрывает закрытые event details.

### 6.3. Admin update

Существующий dedicated PATCH расширяется:

```text
PATCH /admin/events/{event_id}/web-registration
```

Он принимает только управляемые поля:

```json
{
  "web_visibility": "unlisted",
  "public_slug": "tsikl-lektsiy-po-istorii"
}
```

Поля опциональны для независимого обновления. Если slug отсутствует, текущий canonical slug не меняется. Полный URL никогда не принимается.

При смене slug операция атомарно демонтирует прежний canonical row в alias и создаёт/промотирует новый canonical row. Audit содержит только event id, actor id, old/new slug и timestamp; PII отсутствует.

### 6.4. Public read by slug

Добавляется явный публичный endpoint:

```text
GET /web/events/{public_slug}/registration-form
```

Он применяет те же publication, visibility, registration mode, questionnaire, legal, capacity и enumeration-safe guards, что текущий UUID endpoint.

Старый endpoint остаётся совместимым:

```text
GET /events/{event_id}/registration-form?channel=web
```

Ответ публичной формы дополнительно содержит:

```json
{
  "canonical_public_path": "/events/tsikl-lektsiy-po-istorii",
  "resolved_from_alias": false
}
```

`occurrence_selection_mode` и `default_occurrence_id` намеренно относятся к PR 4 и в текущем контракте отсутствуют.

Значения `occurrence_selection_mode`:

- `none` — отдельный выбор даты не нужен;
- `user_select` — пользователь сначала выбирает дату;
- `nearest` — backend назначает ближайший occurrence, ручного выбора нет.

## 7. Public web routing

`apps/web` принимает:

```text
/events/{public_slug}
/events/{legacy_event_uuid}
/events/{alias_slug}
```

Правила:

- canonical slug загружается через slug endpoint;
- legacy UUID продолжает работать через UUID endpoint;
- alias и UUID после успешного разрешения заменяются на `canonical_public_path`;
- query `occurrence` сохраняется только в совместимых legacy-сценариях;
- slug никогда не используется как authorization secret;
- `disabled`, hidden, draft или неподдерживаемый event остаётся недоступным даже при знании slug/UUID;
- frontend не строит production hostname и не угадывает event UUID.

## 8. UX web-admin

В карточке `Веб-регистрация`:

1. Режим публикации остаётся отдельным полем.
2. Добавляется поле `Адрес страницы`.
3. Перед полем визуально показывается неизменяемый prefix `<domain>/events/`.
4. При пустом значении показывается транслитерированный preview из заголовка.
5. Под полем показываются состояния `Проверяем`, `Адрес свободен`, `Адрес уже занят`, `Недопустимый формат`.
6. Кнопка сохранения заблокирована при pending/invalid/taken.
7. После сохранения отображается канонический абсолютный URL.
8. Остаются `Копировать ссылку` и `Открыть страницу`.
9. Секция `Ссылки на отдельные даты` удаляется.
10. Никакие письма или сообщения из admin не отправляются.

## 9. Постоянные события и выбор даты

### 9.1. Общий принцип

`events` остаётся parent/card/series. Все конкретные даты находятся в `event_occurrences`. Публичный адрес относится к parent event.

Изменение occurrences никогда не создаёт новый slug и не меняет public URL.

### 9.2. Цикл лекций и другие выбираемые даты

Для `occurrence_selection_mode = user_select`:

1. Страница открывается без автоматически выбранной первой даты.
2. Первым обязательным шагом пользователь выбирает доступную дату.
3. До выбора даты варианты участия и персональная форма не активируются.
4. После выбора показываются варианты участия, количество и остальная форма.
5. Регистрация сохраняет выбранный `occurrence_id`.
6. Нельзя выбрать occurrence другого event или неактивный occurrence.
7. Если открыта legacy-ссылка с валидным `?occurrence=`, допустимо предвыбрать эту дату; основной URL query не содержит.

Backend выбирает `user_select` для постоянного/серийного события с несколькими подходящими occurrences, если event не относится к специальному nearest/window сценарию.

### 9.3. Шабат и события по окну регистрации

Для `event_kind = shabbat` используется `occurrence_selection_mode = nearest`:

- backend выбирает ближайший актуальный occurrence по серверному времени;
- пользователь не видит ручной переключатель всех будущих Шабатов;
- страница всегда имеет один адрес, например `/events/shabbat`;
- пока окно не открыто, страница доступна, но показывает `Регистрация откроется ...`;
- внутри окна форма становится доступной;
- после закрытия показывается `Регистрация закрыта`;
- после перехода к следующему occurrence тот же URL начинает отражать следующий Шабат;
- query `occurrence` не должен позволять обойти nearest/window policy.

PostgreSQL/server state остаётся источником истины. Device time не открывает регистрацию.

Public web повторно запрашивает server state при возврате вкладки в visible и в момент backend-provided ближайшего изменения состояния. Для этого API должен вернуть `next_registration_state_check_at` либо эквивалентное серверное поле. Таймер только инициирует refetch; он не вычисляет окончательное состояние локально.

### 9.4. Один occurrence

Если подходящий occurrence ровно один, он выбирается backend автоматически, отдельный шаг выбора даты не показывается.

## 10. Mobile boundary

После готовности slug route и production public web анонимный public event DTO получает backend-generated `public_registration_url`.

Mobile:

- не строит URL из `registration_url`, title, UUID, hostname или env;
- использует только доверенный абсолютный URL API;
- сохраняет `guest_only` и отключённую internal registration;
- включает `public_web` только после отдельного legal/hosting/release gate;
- не возвращает login/signup UI.

Это отдельный PR после backend/public-web/admin серии.

## 11. Совместимость и переход

- UUID страницы и UUID public form endpoint не удаляются в этой серии.
- Старые UUID-ссылки продолжают открываться и канонизируются.
- Существующие подтверждённые intents и registrations не меняются.
- `event_id` внутри intent/registration остаётся UUID; slug используется только для маршрутизации.
- `?occurrence=` не становится частью основной ссылки и не меняет модель регистрации.
- Existing `registration_url` для `external_link` не переиспользуется как public web canonical URL.
- Полный URL не хранится в event или slug table.

## 12. Безопасность

- FastAPI/PostgreSQL остаются production runtime.
- Admin использует authenticated FastAPI endpoint с server-side role/community checks.
- Public web использует только allowlisted public endpoints.
- Нельзя возвращать Supabase в production runtime.
- Нельзя использовать `auth.users`, Supabase Admin API, service-role key или `DATABASE_URL` во frontend.
- Нельзя подключать `apps/admin`, `apps/web`, mobile к PostgreSQL напрямую.
- Slug, availability и route errors не раскрывают закрытые event details.
- Slug не содержит PII, token, email, phone, verification code или questionnaire answers.
- Нельзя писать полный URL с секретными query в logs или analytics.
- Prayer tracker и `prayer_activity_logs` не относятся к этой работе.

## 13. Серия PR

### PR 1 — `feature/api-web-event-slug-foundation`

Статус: завершён, объединён как PR #373.

Цель: каноническая slug/alias модель, backfill, нормализация, автогенерация, admin availability/update contracts и focused backend tests.

На этом этапе UUID URL остаётся текущим `public_registration_url`, чтобы не выдать ссылку на ещё не поддерживаемый frontend route.

Не делать: `apps/admin`, `apps/web`, mobile, occurrence UX, production deploy.

### PR 2 — `feature/public-web-event-slug-routing`

Статус: текущий PR; public slug/alias lookup, UUID compatibility, browser canonicalization и slug-based backend URL реализованы.

Цель: public lookup по canonical/alias slug, legacy UUID compatibility, `apps/web` slug route и атомарное переключение backend-generated `public_registration_url` на slug.

Не делать: admin slug editor, occurrence UX redesign, mobile activation.

### PR 3 — `feature/admin-web-event-slug-editor`

Цель: поле suffix, preview/transliteration, debounce availability, final PATCH, copy/open canonical URL и удаление occurrence-link list.

Не делать: public form layout, mobile, catalog, messaging.

### PR 4 — `feature/public-web-recurring-event-flow`

Цель: server-owned `none | user_select | nearest`, date-first course flow, nearest Shabbat flow, scheduled state refetch и tests.

Не делать: payment gateway, catalog, new event model, mobile account registration.

### Следующий отдельный PR после production gate

`feature/mobile-public-web-registration-url` — добавить trusted public URL в anonymous event DTO и подключить существующий fail-closed adapter без включения аккаунтов.

## 14. Обязательные проверки серии

Backend PR:

```text
docker compose -f infra/docker-compose.api.yml build api_backend
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic check
docker compose -f infra/docker-compose.api.yml run --rm api_backend python -m compileall app
docker compose -f infra/docker-compose.api.yml run --rm api_backend pytest -q <focused tests>
npm run typecheck
git diff --check
git diff --cached --check
```

Admin PR дополнительно:

```text
npm run admin:typecheck
npm run admin:build
```

Public web PR дополнительно:

```text
npm run web:typecheck
npm run web:test
npm run web:build
```

Во всех PR обязателен staged forbidden scan. Smoke-тесты Codex не запускает; browser и Expo/iPhone smoke выполняет владелец вручную.

## 15. Критерии приёмки всей серии

- Новый event без ручного slug получает транслитерированный уникальный адрес.
- Редактор может задать свободный slug и получает ошибку на занятый.
- Два одинаковых заголовка получают разные автоматические slugs без гонки.
- Заголовок и occurrence dates можно менять без изменения URL.
- Явная смена slug сохраняет старый адрес как рабочий alias.
- UUID URL продолжает работать.
- Web-admin показывает один основной адрес и не предлагает occurrence-ссылки.
- Цикл лекций сначала просит выбрать дату, затем вариант участия.
- Шабат имеет один адрес, не предлагает ручной выбор дат и следует серверному окну ближайшего occurrence.
- `disabled` event недоступен по UUID, canonical slug и alias.
- Mobile не изобретает URL и остаётся fail-closed до отдельного production gate.
- Никакие данные молитвенного трекера не читаются и не показываются.

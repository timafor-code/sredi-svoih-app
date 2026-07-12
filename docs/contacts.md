# Contacts domain

Раздел "Контакты" разделяет два источника данных: участников общины из Supabase и локальные iPhone contacts.

## Community contacts

Community contacts должны приходить из Supabase через backend RPC, а не через прямой клиентский `select` из `profiles`, `community_memberships` или `profile_contact_visibility`.

Source of truth для каталога общины теперь живет в `public.profiles`:

- `profile_visibility` управляет попаданием строки в каталог. Обычный active member видит `members` и `public`; `rabbi_only` видят только `admin`/`rabbi`. `event_manager` не имеет доступа к `rabbi_only` данным.
- `birthday_visibility` управляет `birth_date` и `hebrew_birth_date`.
- `phone_visibility` управляет `phone`.
- `city` и `hebrew_name` на MVP следуют за `profile_visibility`: если viewer видит profile row, RPC может вернуть эти поля.

### `profile_contact_visibility`

`public.profile_contact_visibility` остается legacy/deprecated таблицей для старого экрана настроек. `list_community_contacts` больше не использует ее для community directory privacy.

Исторически таблица хранила явное согласие пользователя на показ в каталоге общины и отдельные разрешения на поля:

- `show_in_community_directory`
- `share_phone`
- `share_email`
- `share_birth_date`
- `share_hebrew_birth_date`
- `share_city`
- `share_hebrew_name`
- `birthday_reminders_enabled`

Все значения по умолчанию `false`. Это больше не влияет на текущий каталог общины: пользователь управляет видимостью через Profile → Edit profile.

RLS разрешает пользователю читать, создавать и обновлять только свою строку. Админ общины может читать строки visibility для active members своей общины для будущей админки. Обычные участники не должны напрямую читать чужие visibility settings.

### RPC

`get_my_contact_visibility()` возвращает настройки текущего пользователя. Если строки еще нет, backend безопасно создает default row с закрытыми настройками.

`upsert_my_contact_visibility(...)` обновляет настройки текущего пользователя по явным boolean-параметрам. `user_id` всегда берется из `auth.uid()`.

`list_community_contacts(p_community_id uuid default null)` возвращает directory rows только для active members. Если `p_community_id` не передан, backend выбирает первую active community пользователя. Вызывающий пользователь должен быть active member выбранной общины.

RPC возвращает active members по `profiles.profile_visibility`: обычные участники видят `members`/`public`, а только `admin`/`rabbi` видят также `rabbi_only`; `event_manager` не имеет доступа к `rabbi_only` данным. `display_name`, `first_name`, `last_name`, `role`, `membership_status`, `joined_at` и `avatar_url` доступны для видимой profile row. `phone`, `birth_date` и `hebrew_birth_date` возвращаются только когда соответствующая `profiles.*_visibility` разрешает viewer доступ; иначе backend возвращает `NULL`.

Для совместимости RPC сохраняет старые boolean-поля `show_in_community_directory`, `share_phone`, `share_birth_date`, `share_hebrew_birth_date`, `share_city` и `share_hebrew_name`, но вычисляет их из `profiles.*_visibility`. Legacy `email/share_email` остаются в форме ответа, но не управляют новой privacy-моделью.

Field-level privacy живет на backend-слое. UI не должен получать скрытые значения и самостоятельно решать, показывать их или нет.

## Python API contract (PR 32E)

PR 32E adds backend-only authenticated endpoints for the existing directory:
`GET /community/contacts`, `GET /me/contact-visibility`,
`PUT /me/contact-visibility`, `POST /me/synced-contacts`, and
`DELETE /me/synced-contacts/{contact_id}`. It does not change the mobile
provider or existing contacts UI; PR 32F performs that switch under
`EXPO_PUBLIC_CONTACTS_PROVIDER` while retaining the Supabase fallback.

`GET /community/contacts` continues to use `profiles` joined to active
`community_memberships`, never the separate `community_contacts` table. The
selected community must be actively accessible to the viewer; an omitted
`community_id` selects the first active membership by joined time, creation
time, and UUID tie-breaker. The response keeps the stable RPC-compatible
snake_case row fields, including compatibility booleans, with email always
`null` and `share_email` always `false`.

Directory privacy remains profile-driven. `profile_visibility` governs whether
the row is returned, `phone_visibility` controls phone, and
`birthday_visibility` controls both birthday fields. City and Hebrew name follow
profile visibility. Members and `event_manager` actors receive only `members`
and `public` values; only `admin` and `rabbi` can receive `rabbi_only` profile,
phone, or birthday data. Hidden phone and birthday values are returned as
`null` with false compatibility flags. The legacy
`profile_contact_visibility` table is limited to the current user's settings
GET/PUT endpoints, has all-false defaults, and does not decide directory data.

Synced-contact creation is an explicit, single-contact consent contract. It
requires a timezone-aware `consented_at` timestamp and at least one of a
precomputed `phone_hash`, a precomputed `email_hash`, or a birthday. Raw phone
and raw email are not accepted, payloads are PII and are not logged, and the
API uses an unprefixed SHA-256 digest contract for either hash: exactly 64 ASCII
hexadecimal characters, canonicalized to lowercase before storage. The API
rejects raw values, `sha256:` prefixes, malformed hash strings, and incorrect
lengths without introducing client-specific hashing behavior. It does not
invent deduplication or upsert behavior. A synced contact can only be deleted by
its owner; missing and foreign UUIDs use the same safe not-found response.

## iPhone contacts

iPhone contacts остаются local only. Приложение читает их через Expo Contacts только после явного действия пользователя, использует только записи с birthday и не загружает эти контакты на сервер.

Локальный слой нормализует имя, телефоны, Gregorian birthday, Hebrew birthday и следующий Hebrew birthday occurrence. Эти данные нужны для локального UI и будущих локальных напоминаний.

PR3 подключает локальные iPhone contacts во вкладке "Мои контакты": сначала показывается invite card, permission prompt открывается только по кнопке "Разрешить доступ", затем UI показывает только контакты с днями рождения, denied/error state или empty state. Эти данные не уходят в Supabase, не сохраняются как полная адресная книга и не участвуют в community directory backend.

PR4 разделяет detail screens по источнику данных. Community contacts открываются через `/contacts/community/[id]`, а legacy mock fallback используется только если id реально есть в `mockContacts`. Local iPhone contacts открываются через `/contacts/iphone/[id]`, читаются только из уже загруженного `useContactsStore.localContacts`, не запрашивают permission автоматически на detail screen и не отправляются в Supabase. Если local contact не найден после рестарта или до загрузки вкладки "Мои контакты", экран показывает clean "Контакт не найден" state без permission prompt.

PR5 подключал экран Profile → Contacts and birthdays settings к legacy visibility RPC: `get_my_contact_visibility()` для загрузки и `upsert_my_contact_visibility(...)` для сохранения. Этот экран больше не является пользовательским flow для каталога общины; настройки каталога теперь находятся в Profile → Edit profile.

PR6 подключает вкладку Contacts → "Община" к backend RPC `list_community_contacts` через `contactsService.listCommunityContacts()`. UI показывает только rows, которые backend вернул как видимые по `profiles.profile_visibility`; если каталог пустой, это считается нормальным состоянием. Скрытые поля приходят из backend как `NULL`, мапятся в `undefined` и не рисуются в списке, birthday preview или detail screen. Community detail сначала ищет контакт в `useContactsStore.communityContacts` и показывает только backend-returned `phone`, `city`, `hebrew_name`, `birth_date` или `hebrew_birth_date`; если backend contact не найден, fallback на `mockContacts` разрешен только по совпавшему legacy id. Вкладка "Мои контакты" остается local-only iPhone flow: permission prompt открывается только по явной кнопке, контакты не загружаются в Supabase и не сохраняются как вся адресная книга в persistent storage.

## Birthday layer

Birthday layer объединяет дни рождения из community contacts и local iPhone contacts в единый список ближайших еврейских дней рождения. Сейчас это вычисляется на клиенте через существующую Hebcal-логику.

Будущие birthday reminders должны быть local notifications. Для iPhone contacts уведомления остаются локальными, без background sync и без отправки адресной книги на backend.

## Planned PRs

1. Community contact sharing backend: PR2 introduced `profile_contact_visibility`; current community directory privacy is driven by `profiles.*_visibility`.
2. iPhone contacts UI: done in PR3 with explicit permission action, local birthday contacts list, empty/denied states, and no Supabase upload.
3. Contact detail real data: done in PR4 with explicit community and iPhone detail routes, no mock fallback, and local-only iPhone detail.
4. Contact sharing settings UI: done in Profile → Edit profile via `profile_visibility`, `birthday_visibility`, and `phone_visibility`; legacy contacts settings are deprecated.
5. Community contacts backend UI: done via `list_community_contacts`, profile visibility rows, backend field-level masking, and local-only iPhone tab preservation.
6. Birthday reminders settings: настройки локальных уведомлений и расписание reminder occurrences.

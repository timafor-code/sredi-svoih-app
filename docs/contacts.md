# Contacts domain

Раздел "Контакты" разделяет два источника данных: участников общины из Supabase и локальные iPhone contacts.

## Community contacts

Community contacts должны приходить из Supabase через backend RPC, а не через прямой клиентский `select` из `profiles`, `community_memberships` или `profile_contact_visibility`.

### `profile_contact_visibility`

`public.profile_contact_visibility` хранит явное согласие пользователя на показ в каталоге общины и отдельные разрешения на поля:

- `show_in_community_directory`
- `share_phone`
- `share_email`
- `share_birth_date`
- `share_hebrew_birth_date`
- `share_city`
- `share_hebrew_name`
- `birthday_reminders_enabled`

Все значения по умолчанию `false`. Это значит, что пользователь не появляется в каталоге и не раскрывает поля, пока сам не включит sharing.

RLS разрешает пользователю читать, создавать и обновлять только свою строку. Админ общины может читать строки visibility для active members своей общины для будущей админки. Обычные участники не должны напрямую читать чужие visibility settings.

### RPC

`get_my_contact_visibility()` возвращает настройки текущего пользователя. Если строки еще нет, backend безопасно создает default row с закрытыми настройками.

`upsert_my_contact_visibility(...)` обновляет настройки текущего пользователя по явным boolean-параметрам. `user_id` всегда берется из `auth.uid()`.

`list_community_contacts(p_community_id uuid default null)` возвращает directory rows только для active members. Если `p_community_id` не передан, backend выбирает первую active community пользователя. Вызывающий пользователь должен быть active member выбранной общины.

RPC возвращает только active members, у которых `show_in_community_directory = true`. `display_name`, `first_name`, `last_name`, `role`, `membership_status`, `joined_at` и `avatar_url` доступны для опубликованной directory row. `phone`, `email`, `birth_date`, `hebrew_birth_date`, `city` и `hebrew_name` возвращаются только при соответствующем `share_* = true`; иначе backend возвращает `NULL`.

Field-level privacy живет на backend-слое. UI не должен получать скрытые значения и самостоятельно решать, показывать их или нет.

## iPhone contacts

iPhone contacts остаются local only. Приложение читает их через Expo Contacts только после явного действия пользователя, использует только записи с birthday и не загружает эти контакты на сервер.

Локальный слой нормализует имя, телефоны, Gregorian birthday, Hebrew birthday и следующий Hebrew birthday occurrence. Эти данные нужны для локального UI и будущих локальных напоминаний.

PR3 подключает локальные iPhone contacts во вкладке "Мои контакты": сначала показывается invite card, permission prompt открывается только по кнопке "Разрешить доступ", затем UI показывает только контакты с днями рождения, denied/error state или empty state. Эти данные не уходят в Supabase, не сохраняются как полная адресная книга и не участвуют в community directory backend.

PR4 разделяет detail screens по источнику данных. Community contacts открываются через `/contacts/community/[id]`, а legacy mock fallback используется только если id реально есть в `mockContacts`. Local iPhone contacts открываются через `/contacts/iphone/[id]`, читаются только из уже загруженного `useContactsStore.localContacts`, не запрашивают permission автоматически на detail screen и не отправляются в Supabase. Если local contact не найден после рестарта или до загрузки вкладки "Мои контакты", экран показывает clean "Контакт не найден" state без permission prompt.

PR5 подключает экран Profile → Contacts and birthdays settings к backend visibility RPC: `get_my_contact_visibility()` для загрузки и `upsert_my_contact_visibility(...)` для сохранения. Настройки публикации в каталоге общины теперь backend-backed, а настройки iPhone contacts остаются local-only. Экран настроек не загружает iPhone contacts в Supabase, не сохраняет всю адресную книгу в AsyncStorage/SecureStore и не подключает вкладку Contacts к `list_community_contacts`.

PR6 подключает вкладку Contacts → "Община" к backend RPC `list_community_contacts` через `contactsService.listCommunityContacts()`. UI показывает только opt-in members, для которых backend вернул `show_in_community_directory = true`; если каталог пустой, это считается нормальным состоянием. Скрытые поля приходят из backend как `NULL`, мапятся в `undefined` и не рисуются в списке, birthday preview или detail screen. Community detail сначала ищет контакт в `useContactsStore.communityContacts` и показывает только backend-returned `phone`, `email`, `city`, `hebrew_name`, `birth_date` или `hebrew_birth_date`; если backend contact не найден, fallback на `mockContacts` разрешен только по совпавшему legacy id. Вкладка "Мои контакты" остается local-only iPhone flow: permission prompt открывается только по явной кнопке, контакты не загружаются в Supabase и не сохраняются как вся адресная книга в persistent storage.

## Birthday layer

Birthday layer объединяет дни рождения из community contacts и local iPhone contacts в единый список ближайших еврейских дней рождения. Сейчас это вычисляется на клиенте через существующую Hebcal-логику.

Будущие birthday reminders должны быть local notifications. Для iPhone contacts уведомления остаются локальными, без background sync и без отправки адресной книги на backend.

## Planned PRs

1. Community contact sharing backend: done in PR2 via `profile_contact_visibility` and backend privacy RPC.
2. iPhone contacts UI: done in PR3 with explicit permission action, local birthday contacts list, empty/denied states, and no Supabase upload.
3. Contact detail real data: done in PR4 with explicit community and iPhone detail routes, no mock fallback, and local-only iPhone detail.
4. Contact sharing settings UI: done in PR5 via Profile → Contacts and birthdays settings, visibility RPC, backend-backed community sharing toggles, and local-only iPhone settings.
5. Community contacts backend UI: done in PR6 via `list_community_contacts`, opt-in directory rows, backend field-level masking, and local-only iPhone tab preservation.
6. Birthday reminders settings: настройки локальных уведомлений и расписание reminder occurrences.

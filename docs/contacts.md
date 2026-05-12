# Contacts domain

Раздел "Контакты" разделяет три слоя данных.

## Community contacts

Community contacts будут приходить из Supabase как результат объединения профилей, membership-статусов и явного sharing-согласия пользователя. Клиент не должен собирать эти данные напрямую из таблиц. Следующий backend PR должен добавить RPC `list_community_contacts`, который вернет уже отфильтрованный список полей для текущего пользователя.

Field-level privacy должна жить на backend-слое. Для телефона, дня рождения, email и расширенных полей RPC должен учитывать настройки видимости профиля и правила общины. UI получает только те поля, которые можно показывать.

## iPhone contacts

iPhone contacts остаются local only. Приложение читает их через Expo Contacts только после permission prompt, использует только записи с birthday и не загружает эти контакты на сервер.

Локальный слой нормализует имя, телефоны, Gregorian birthday, Hebrew birthday и следующий Hebrew birthday occurrence. Эти данные нужны для локального UI и будущих локальных напоминаний.

## Birthday layer

Birthday layer объединяет дни рождения из community contacts и local iPhone contacts в единый список ближайших еврейских дней рождения. Сейчас это вычисляется на клиенте через существующую Hebcal-логику.

Будущие birthday reminders должны быть local notifications. Для iPhone contacts уведомления остаются локальными, без background sync и без отправки адресной книги на backend.

## Planned PRs

1. Community contact sharing backend: RPC `list_community_contacts`, explicit sharing model, privacy filtering.
2. iPhone contacts UI: permission state, local birthday contacts list, empty/denied states.
3. Contact detail real data: перейти с mock detail на community/local domain records.
4. Birthday reminders settings: настройки локальных уведомлений и расписание reminder occurrences.

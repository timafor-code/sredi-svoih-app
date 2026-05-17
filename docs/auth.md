# Auth model

## Auth != membership

Supabase Auth отвечает только за технический вход пользователя в приложение: email/password, подтверждение email, восстановление пароля и хранение сессии.

Доступ к закрытым функциям общины определяется отдельно через `community_memberships` и инвайты. Наличие пользователя в Supabase Auth не означает наличие membership.

## Email sign-up

Самостоятельная регистрация по email/password выполняется клиентским Supabase anon/publishable key через `supabase.auth.signUp`.

После регистрации возможны два сценария:

- Supabase сразу возвращает `session`: пользователь вошёл, приложение может создать или обновить `profiles`.
- Supabase не возвращает `session`: пользователю нужно подтвердить email перед входом.

Повторная отправка письма подтверждения выполняется через `supabase.auth.resend` с `type: 'signup'`. Восстановление пароля выполняется через `supabase.auth.resetPasswordForEmail`.

## Profile creation

Если после email sign-up есть активная `session`, приложение создаёт или обновляет запись в `profiles` через существующий `upsertProfile()`.

Профиль нужен для пользовательских данных приложения, но сам по себе не даёт доступ к закрытым функциям общины.

## Invite required

Для закрытых функций по-прежнему требуется активный membership. Пользователь после регистрации должен ввести invite-код, который проходит через существующую модель `invites` / `community_memberships`.

Email sign-up не создаёт membership автоматически.

## Next PRs

Google и Apple sign-in будут добавлены отдельными PR. В этом PR они не реализуются и не меняют текущую модель доступа.

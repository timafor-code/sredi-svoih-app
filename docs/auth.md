# Auth model

## Current Auth Model

Supabase Auth отвечает за технический аккаунт, вход и сессию пользователя. Сейчас поддерживаются email/password, Google OAuth и Apple Sign-In.

`profiles` хранит пользовательский профиль приложения. `profiles.onboarding_completed` означает только завершение базового профиля.

`community_memberships` и `invites` отдельно управляют доступом к закрытым функциям общины.

Creating an account does not grant community access.

Community access requires active `community_membership` via invite.

Главное правило проекта: Auth != membership.

## Email/password flow

Регистрация выполняется через `supabase.auth.signUp` с anon/publishable client.

Если Supabase сразу возвращает `session`, приложение создаёт или загружает `profiles`, затем загружает текущий `community_memberships` state. Membership при этом не создаётся.

Если Supabase не возвращает `session`, пользователь должен подтвердить email. Повторная отправка письма выполняется через `supabase.auth.resend` с `type: 'signup'`.

Вход выполняется через `supabase.auth.signInWithPassword`. После успешного входа store приводит состояние к единой модели: `session`, `user`, `profile`, `membership`.

Восстановление пароля использует `supabase.auth.resetPasswordForEmail`. Production deep-link flow для смены пароля настраивается отдельно.

## Google OAuth flow

Google-вход использует Supabase OAuth provider `google`, Expo redirect URI и `expo-web-browser`.

После успешного callback/session exchange приложение получает Supabase Auth `session`, создаёт или загружает `profiles` и загружает `community_memberships`.

Google OAuth не создаёт membership, не принимает invite автоматически и не даёт доступ к закрытым функциям без активного membership.

Клиент не хранит Google provider tokens, не использует service-role ключи и не запрашивает дополнительные Google scopes.

## Apple Sign-In flow

Apple Sign-In использует native flow через `expo-apple-authentication`: проверяет доступность Apple-входа на iOS, генерирует nonce, запрашивает имя и email, затем передаёт Apple identity token в Supabase через `supabase.auth.signInWithIdToken`.

Apple может вернуть email и имя только при первом входе пользователя в приложение. Если данные доступны, приложение аккуратно сохраняет их в `profiles`, не перетирая уже заполненные пользователем поля.

Apple Sign-In создаёт или загружает Supabase Auth user/session и `profiles`, но не создаёт membership. Доступ к закрытым функциям по-прежнему требует invite / `community_memberships`.

Клиент не хранит Apple provider token, не использует service-role ключи и не обращается к Admin API.

## Profile completion

После входа или регистрации приложение проверяет `profiles.onboarding_completed`.

Если значение не равно `true`, экран профиля показывает CTA завершения профиля с переходом на `/profile/onboarding`.

Onboarding заполняет только поля профиля. Завершение профиля не создаёт `community_memberships`, не принимает invite-код автоматически и не даёт доступ к закрытым функциям.

## Invite/membership boundary

Пользователь без active membership видит invite-code block «Присоединиться к общине».

Единственная граница доступа к закрытым функциям общины — существующая модель `invites` / `community_memberships`.

Нельзя автоматически создавать membership из email sign-up, Google OAuth или Apple Sign-In.

`acceptInvite` остаётся отдельным действием пользователя и не должен смешиваться с auth provider flow.

## Security screen behavior

Экран «Аккаунт и безопасность» показывает:

- текущий способ входа: «Email и пароль», «Google», «Apple ID» или fallback «Неизвестный способ входа»;
- email аккаунта, если он доступен;
- состояние подтверждения email, когда его можно безопасно определить по Supabase user timestamps;
- provider-aware строку смены пароля.

Смена пароля активна только для email/password provider и отправляет письмо восстановления через существующий Supabase flow. Для Google и Apple строка объясняет, что пароль управляется через Google или Apple ID.

«Выйти со всех устройств» остаётся безопасным placeholder без Admin API.

«Удалить аккаунт» остаётся placeholder. Реальное удаление должно идти через безопасную серверную функцию, не из клиента.

Sign-out очищает `session`, `user`, `profile` и `membership`. Экран профиля также сбрасывает private events state через существующий reset и перезагружает events.

## Local development limitations

Google local Supabase callback на iPhone требует tunnel или production Supabase project: Google разрешает `127.0.0.1`, но не private LAN IP устройства/компьютера.

Apple successful flow требует Apple Developer capability, корректную Apple/Supabase provider configuration и проверку в development build или TestFlight.

Expo Go может помочь проверить часть UI и cancel flows, но production provider setup лучше проверять в development build/TestFlight.

Локальные provider secrets и `.env.local` не коммитятся.

## Production checklist before TestFlight/App Store

- Supabase production project создан и отделён от local/dev окружений.
- Production redirect URLs добавлены в Supabase Auth URL configuration.
- Google OAuth production client настроен для production callback.
- Apple Developer capability «Sign in with Apple» включена для iOS app id.
- Supabase Apple provider настроен, если это требуется для выбранного production flow.
- Privacy Policy доступна и привязана к App Store / приложению.
- Account deletion process спроектирован через безопасную серверную функцию.
- Email templates проверены для confirmation, resend и password recovery.
- Rate limits проверены для sign-up, sign-in, resend и password recovery.
- Deep links / universal links настроены, если нужны для production password recovery или callback flows.
- No secrets in client.
- No service-role key in mobile app or admin browser client.
- No Supabase Admin API calls from the mobile app.

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

## PR2: Email sign-up UI

Экран профиля для гостя показывает `AuthCard` с тремя состояниями:

- `Sign in`: вход по email/password через `useAuthStore.signIn`.
- `Sign up`: регистрация по email/password через `useAuthStore.signUpWithEmail`.
- `Forgot password`: отправка ссылки восстановления через `useAuthStore.resetPasswordForEmail`.

Если `signUpWithEmail` возвращает `needsEmailConfirmation`, UI показывает состояние «Проверьте почту» и даёт повторно отправить письмо через `resendConfirmationEmail`.

Если регистрация сразу возвращает `session`, foundation-слой создаёт или обновляет `profiles`, но membership не создаётся. Пользователь без активного `community_memberships` после входа видит существующий блок invite-кода «Присоединиться к общине».

Registration != membership: Supabase Auth создаёт технический аккаунт и сессию, а доступ к закрытым функциям общины по-прежнему открывается только через invite / `community_memberships`.

## PR3: Profile completion / onboarding

После регистрации или входа приложение проверяет `profiles.onboarding_completed`. Если значение не равно `true`, экран профиля показывает мягкую карточку «Завершите профиль» с переходом на `/profile/onboarding`.

Onboarding заполняет только базовые поля профиля: `display_name`, `first_name`, `last_name`, `city`, `nusach`, а после сохранения выставляет `onboarding_completed: true`. Эти данные относятся к пользовательскому профилю и не являются признаком членства в общине.

Завершённый профиль не создаёт `community_memberships`, не принимает invite-код автоматически и не даёт доступ к закрытым функциям без активного invite / membership. Пользователь без membership по-прежнему видит существующий блок invite-кода «Присоединиться к общине».

## PR4: Google OAuth foundation

Google-вход в мобильном приложении использует Supabase OAuth provider `google` через `supabase.auth.signInWithOAuth({ provider: 'google' })`, Expo redirect URI и `expo-web-browser`.

После успешного Google OAuth приложение получает Supabase Auth `session`, создаёт или загружает запись в `profiles` через существующий profile-flow и загружает `community_memberships` так же, как email sign-in. Google-вход не создаёт membership, не принимает invite автоматически и не даёт доступ к закрытым функциям без активного membership. Пользователь без membership по-прежнему видит invite-code блок «Присоединиться к общине».

В мобильном клиенте не сохраняются Google provider tokens, не используются service-role ключи и не запрашиваются дополнительные Google scopes.

### Local setup

1. В Google Cloud создайте OAuth client для Supabase Auth redirect flow.
2. В Supabase Google provider укажите callback URL локального Supabase:

```text
http://127.0.0.1:54321/auth/v1/callback
```

3. В локальном окружении Supabase задайте client secret через свою env-переменную без коммита значения:

```text
MY_LOCAL_GOOGLE_PROVIDER_SECRET=
```

4. В `supabase/config.toml` для локальной разработки добавьте provider block только в своём окружении, когда есть реальные локальные значения:

```toml
[auth.external.google]
enabled = true
client_id = "..."
secret = "env(MY_LOCAL_GOOGLE_PROVIDER_SECRET)"
```

Не коммитьте реальные Google client IDs/secrets. Google Client Secret нельзя добавлять в mobile client code, web-admin client code, `.env.example` или любые публичные `EXPO_PUBLIC_*` переменные.

Redirect URI приложения формируется через Expo AuthSession на основе схемы `sredi-svoih` из `app.json` и пути `auth/callback`. Для Expo Go redirect может быть временным `exp://.../--/auth/callback`; если Google/Supabase отклоняют callback в Expo Go, добавьте фактический Expo Go redirect из локального запуска в allowlist Supabase Auth URL configuration или проверьте flow в development build с custom scheme.

### Manual smoke checklist

- Запустить приложение через Expo Go или development build.
- На guest profile screen нажать «Продолжить с Google» в режиме «Войти».
- Отменить OAuth и убедиться, что приложение не падает и показывает «Вход через Google отменён.».
- Повторить Google-вход с настроенным локальным provider.
- После входа убедиться, что появился Supabase Auth user и `profiles` запись.
- Убедиться, что `community_memberships` не создаётся автоматически.
- Для пользователя без membership проверить, что виден invite-code блок «Присоединиться к общине».
- Повторить кнопку «Продолжить с Google» в режиме «Регистрация».

## PR5: Apple Sign-In foundation

После появления Google login в мобильном приложении нужен Apple Sign-In для соответствия App Store guideline по сторонним login services на iOS. Этот PR добавляет foundation-слой, а не production hardening.

Мобильный клиент использует native flow через `expo-apple-authentication`: проверяет `AppleAuthentication.isAvailableAsync()`, генерирует nonce через `expo-crypto`, запрашивает `FULL_NAME` и `EMAIL`, получает `identityToken` и передаёт его в Supabase через `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`. Web OAuth redirect flow для Apple не используется.

Nonce передаётся в Apple request и затем тем же raw value передаётся в Supabase. Клиент не хранит Apple provider token, не использует service-role ключи и не обращается к Admin API.

Apple `fullName` и `email` могут прийти только при первом входе пользователя в приложение. Если эти значения пришли, приложение сохраняет их в `profiles`, но не затирает уже заполненные пользователем `display_name`, `first_name`, `last_name` и `full_name`. Для `email` значение сохраняется только когда оно не конфликтует с `session.user.email`.

Apple Sign-In создаёт или загружает Supabase Auth user/session и `profiles` запись, но не создаёт membership. Доступ к закрытым функциям по-прежнему требует активный invite / `community_memberships`, а пользователь без membership видит invite-code блок «Присоединиться к общине». Onboarding CTA остаётся видимым, пока `profiles.onboarding_completed !== true`.

### Local limitations

- `app.json` включает `ios.usesAppleSignIn` и config plugin `expo-apple-authentication`; существующая scheme-конфигурация `sredi-svoih` остаётся для Google flow.
- Expo Go может позволить проверить Apple sheet на устройстве, но полноценная production-конфигурация требует Apple Developer account и Sign in with Apple capability.
- Для TestFlight/App Store нужно настроить Apple Developer capabilities и Supabase Apple provider, если окружение требует отдельной provider-конфигурации.
- Не коммитьте Apple provider secrets, локальные env-файлы или реальные значения provider-конфигурации.

### Manual smoke checklist

- Открыть Profile как guest.
- Убедиться, что «Продолжить с Apple» показывается на iOS.
- Нажать Apple sign-in.
- Отменить Apple sheet и убедиться, что показано «Вход через Apple отменён.».
- Повторить Apple sign-in и завершить flow, если локальная/device setup позволяет.
- Убедиться, что появился Supabase Auth user.
- Убедиться, что `profiles` запись создана или загружена.
- Убедиться, что первый Apple `fullName`/`email` сохранены только если доступны и не перетирают уже заполненные поля профиля.
- Убедиться, что `community_memberships` не создаётся автоматически.
- Для пользователя без membership проверить, что виден invite-code блок.
- Убедиться, что onboarding CTA всё ещё появляется, если `profile.onboarding_completed !== true`.

## Next PRs

Production OAuth domain setup, account deletion и auth hardening остаются вне PR5.

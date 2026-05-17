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

## Next PRs

Google и Apple sign-in будут добавлены отдельными PR. В этом PR они не реализуются и не меняют текущую модель доступа.

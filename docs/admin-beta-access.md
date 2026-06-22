# Admin beta access

Этот документ фиксирует ручную выдачу доступа для Phase 1 server/staging beta. PR документационный: код, `apps/admin`, mobile, DB schema, migrations, registrations/seating и импорт с кнопки не меняются.

## Phase 1 boundary

В Phase 1 beta-доступ выдаётся вручную владельцем проекта или админом через hosted Supabase Dashboard и существующие public rows.

Не входит в scope Phase 1:

- invite backend и invite UI;
- fake invite codes;
- email invitations;
- массовая выдача доступа;
- управление `auth.users` из app/admin code;
- Supabase Admin API, service-role key или server-only database connection strings в browser-admin.

`apps/admin` продолжает работать через обычный authenticated Supabase client, пользовательскую session, RLS и RPC. Админские действия должны оставаться на этой границе.

## Roles

- `admin`: полный beta-доступ к web-admin и admin-only navigation.
- `event_manager`: beta-доступ к разрешённым admin-разделам для событий и операционных workflows без admin-only shortcuts.
- `member`: обычное membership в community; не получает доступ в web-admin.

Для входа в web-admin в Phase 1 нужен active `community_memberships` row с ролью `admin` или `event_manager`.

## Grant Access

1. В hosted Supabase Dashboard открыть staging project.
2. В Auth Dashboard вручную создать пользователя или убедиться, что он уже существует.
3. Скопировать user UUID из Auth Dashboard. Не редактировать `auth.users` напрямую через SQL.
4. В public table `profiles` через Dashboard Table Editor создать или обновить row для этого user UUID.
5. В public table `community_memberships` создать или обновить row для beta community:
   - `user_id`: UUID пользователя из Auth Dashboard;
   - `community_id`: UUID beta community;
   - `status`: `active`;
   - `role`: `admin`, `event_manager` или `member`.
6. Проверить, что membership status равен `active`.
7. Проверить, что role соответствует ожидаемому доступу:
   - `admin` или `event_manager` для доступа в web-admin;
   - `member` для no-access проверки.

Допустимо обновлять только public rows, необходимые для профиля и membership. Не использовать browser-admin, app code, service-role key или Supabase Admin API для управления Auth users.

## Revoke Access

Чтобы отозвать beta-доступ, перевести `community_memberships.status` в `suspended` или `left` для нужного пользователя и beta community.

Не удалять пользователя из Supabase Auth без отдельного решения владельца проекта. Не писать напрямую в `auth.users` через SQL. Не использовать app/admin code, Supabase Admin API, service-role key или browser-admin для управления `auth.users`.

## Access Checklist

После выдачи beta-доступа вручную проверить:

- user существует в hosted Supabase Auth;
- `profiles` row существует для этого user UUID;
- `community_memberships` row существует для этого user UUID и beta community;
- `community_memberships.status` равен `active`;
- role равен `admin` или `event_manager` для доступа в web-admin;
- login проходит на staging web-admin;
- Overview показывает правильного user, role и community;
- role-limited navigation работает;
- Feedback button работает для `admin` и `event_manager`;
- `member` или пользователь без active membership не получает доступ в admin.

Manual smoke выполняет владелец проекта в браузере. Codex не запускает browser smoke и не открывает браузер для этой проверки.

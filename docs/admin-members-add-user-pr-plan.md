# Admin Members Add User PR Plan

We are working in the `sredi-svoih-app` project.

This document defines the PR sequence for adding an admin-driven member creation flow in `apps/admin`, and the mandatory working rules for Codex prompts in this series.

## 1. Product decision

The admin panel should allow an admin to add a participant from the `Участники` section, fill the same profile fields that a self-registered user has, and assign a community role.

The safe MVP model is:

```text
Admin creates or updates profile/member data
→ Admin assigns membership role/status
→ For a new person, admin creates an invite
→ User sets their own password during registration/sign-in
```

Admin must not set or know the user's password in this PR series.

Reason: the project separates Supabase Auth from community membership. `auth.users` identifies the signed-in user; `profiles` and `community_memberships` define profile and access. Web-admin must use the regular authenticated Supabase client, and admin actions must go through RPC/RLS.

## 2. Mandatory local setup commands before every Codex run

Every Codex prompt for this series must start from a clean synced `main` and a fresh feature branch.

Use PowerShell one-liners and always include the project root `cd`:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
```

Then create the feature branch:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/<focused-pr-branch-name>
```

If `git status --short` is not clean before creating the branch, Codex must stop and report the unexpected files. It must not stage unrelated files.

Known untracked files that must not be added unless explicitly included in expected scope:

```text
500
supabase/functions/
supabase/snippets/
```

## 3. Mandatory Codex prompt language

All Codex prompts for this series must be written in English.

The human-facing project discussion can remain Russian, but the actual Codex task prompt should be English and must include:

```text
We are working in the sredi-svoih-app project.
Current PR: feature/...
Previous PRs: #248, #247, #246, #245, or the latest merged PRs at the time of work.
Goal of this PR: ...
```

Every prompt must split the scope explicitly:

```text
Do:
- ...

Do not:
- ...
```

Every prompt must include the expected files and must forbid scope expansion.

## 4. Global technical rules for all PRs in this series

```text
Do not touch auth.users.
Do not use Supabase Admin API.
Do not use a service-role key.
Do not add DATABASE_URL to apps/admin.
Do not commit .env.local.
Do not run npx supabase db reset unless the project owner explicitly asks for it in a separate command.
Do not use global rg. Use git grep, PowerShell Get-ChildItem/Select-String, or targeted file reads.
Do not touch untracked supabase/functions/, supabase/snippets/, or 500 unless they are explicitly in the expected scope.
```

Admin access architecture:

```text
Web-admin works through the regular authenticated Supabase client.
Admin actions must go through RPC/RLS.
No service-role/Admin API in browser code.
```

Privacy boundary:

```text
Prayer tracker is private.
Do not read or show prayer_activity_logs.
In the Members admin section, it is allowed to show profile, membership, and event registrations/history for the selected community.
```

## 5. Smoke-test policy

Codex must not run smoke tests.

```text
Smoke tests must not be run by Codex.
Browser smoke and Expo/iPhone smoke are performed manually by the project owner.
Codex must only provide a manual smoke checklist.
Do not open a browser for manual verification.
Do not run Expo/iPhone smoke.
```

## 6. Commit and push rule

After implementation and checks, Codex must:

1. Run `git status --short`.
2. Stage only the expected files for the current PR.
3. Commit with a focused commit message.
4. Push the feature branch.
5. Provide a PR body using the required template below.

Codex must not stage unrelated files and must not stage known untracked files unless they are explicitly in expected scope.

Required commands:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git status --short
```

Stage expected files only, for example:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git add apps/admin/src/types/members.ts apps/admin/src/pages/MembersPage.tsx docs/admin-members.md
```

Commit:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git commit -m "Add admin members rabbi role support"
```

Push:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git push -u origin feature/<focused-pr-branch-name>
```

## 7. Required PR body template

```md
## Summary

## Scope

## Checks

## Manual smoke

Not run by Codex. Manual smoke is performed by the project owner.

## Next PR
```

## 8. Required checks

For admin-only PRs:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:build
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --check
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --name-only | ForEach-Object { Select-String -Path $_ -Pattern "service_role|sb_secret|SUPABASE_SERVICE|DATABASE_URL" -SimpleMatch:$false -ErrorAction SilentlyContinue }
```

For PRs with migrations/backend changes:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; supabase migration up
cd F:\2026\SS-App\code\sredi-svoih-app; npm run typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:build
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --check
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --name-only | ForEach-Object { Select-String -Path $_ -Pattern "service_role|sb_secret|SUPABASE_SERVICE|DATABASE_URL" -SimpleMatch:$false -ErrorAction SilentlyContinue }
```

Do not run `npx supabase db reset` unless the project owner explicitly asks for it in a separate command.

---

# 9. PR sequence

## PR 1 — `feature/admin-members-rabbi-role-alignment`

### Goal

Align the `rabbi` membership role across admin members UI, TypeScript types, service layer, RPC validation, and documentation.

The database already allows `rabbi` in `community_memberships.role`, but the admin UI/types/RPC still need alignment.

### Do

- Add `rabbi` to `ADMIN_MEMBER_MEMBERSHIP_ROLES`.
- Add the Russian label `Раввин`.
- Add badge tone support for `rabbi`.
- Add `rabbi` to the role filter in `MembersPage`.
- Extend `admin_list_users` role validation to allow `rabbi`.
- Extend `admin_set_user_membership` role validation to allow `rabbi`.
- Update `docs/admin-members.md`.

### Do not

- Do not create users.
- Do not add the Add Member modal.
- Do not edit profile fields.
- Do not change passwords/logins.
- Do not touch `auth.users`.
- Do not read or show `prayer_activity_logs`.

### Expected scope

```text
apps/admin/src/types/members.ts
apps/admin/src/pages/MembersPage.tsx
apps/admin/src/services/adminMembersService.ts
supabase/migrations/YYYYMMDDHHMMSS_admin_members_rabbi_role_alignment.sql
docs/admin-members.md
```

### Checks

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; supabase migration up
cd F:\2026\SS-App\code\sredi-svoih-app; npm run typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:build
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --check
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --name-only | ForEach-Object { Select-String -Path $_ -Pattern "service_role|sb_secret|SUPABASE_SERVICE|DATABASE_URL" -SimpleMatch:$false -ErrorAction SilentlyContinue }
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Open `Участники`.
- Confirm the role filter includes `Раввин`.
- Open an existing member card.
- Change role to `Раввин`.
- Save and reload.
- Confirm the role badge remains `Раввин`.
- Confirm event manager cannot access the Members admin surface.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-rabbi-role-alignment
Previous PRs: #248, #247, #246, #245
Goal of this PR: align the rabbi membership role across admin members UI, TypeScript types, service layer, backend RPC validation, and documentation.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-rabbi-role-alignment

Do:
- Add rabbi to ADMIN_MEMBER_MEMBERSHIP_ROLES.
- Add the Russian label “Раввин”.
- Add badge tone support for rabbi.
- Add rabbi to the role filter on the Members page.
- Add a migration that updates admin_list_users and admin_set_user_membership role validation to allow rabbi.
- Update docs/admin-members.md.

Do not:
- Do not create users.
- Do not add an Add Member modal.
- Do not edit profile fields.
- Do not change passwords/logins.
- Do not touch auth.users.
- Do not use Supabase Admin API.
- Do not use a service-role key.
- Do not add DATABASE_URL to apps/admin.
- Do not commit .env.local.
- Do not run npx supabase db reset.
- Do not use global rg. Use git grep, PowerShell Get-ChildItem/Select-String, or targeted file reads.
- Do not read or show prayer_activity_logs.
- Do not touch untracked supabase/functions/, supabase/snippets/, or 500.

Expected scope:
- apps/admin/src/types/members.ts
- apps/admin/src/pages/MembersPage.tsx
- apps/admin/src/services/adminMembersService.ts
- supabase/migrations/YYYYMMDDHHMMSS_admin_members_rabbi_role_alignment.sql
- docs/admin-members.md

Run checks:
cd F:\2026\SS-App\code\sredi-svoih-app; supabase migration up
cd F:\2026\SS-App\code\sredi-svoih-app; npm run typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:typecheck
cd F:\2026\SS-App\code\sredi-svoih-app; npm run admin:build
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --check
cd F:\2026\SS-App\code\sredi-svoih-app; git diff --name-only | ForEach-Object { Select-String -Path $_ -Pattern "service_role|sb_secret|SUPABASE_SERVICE|DATABASE_URL" -SimpleMatch:$false -ErrorAction SilentlyContinue }

Smoke tests must not be run by Codex. Browser smoke and Expo/iPhone smoke are performed manually by the project owner. Only provide a manual smoke checklist.

After implementation:
- Run git status --short.
- Stage only expected files.
- Commit the focused changes.
- Push the branch.
- Provide a PR body using Summary, Scope, Checks, Manual smoke, Next PR.
```

---

## PR 2 — `feature/admin-members-profile-edit-rpc`

### Goal

Add a safe admin RPC for editing profile fields of an existing app user/member.

### Do

- Add RPC `admin_update_user_profile(payload jsonb)`.
- Require authenticated user.
- Require active `admin` membership in the selected community.
- Allow only explicitly supported `profiles` fields.
- Update `public.profiles` only.
- Add typed service method `updateAdminUserProfile`.
- Add input/output types.
- Update docs.

### Do not

- Do not create Auth users.
- Do not change Auth email/password.
- Do not touch `auth.users`.
- Do not use Supabase Admin API.
- Do not use service-role key.
- Do not add UI.

### Expected scope

```text
supabase/migrations/YYYYMMDDHHMMSS_admin_update_user_profile.sql
apps/admin/src/types/members.ts
apps/admin/src/services/adminMembersService.ts
docs/admin-members.md
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Call RPC as admin and update a test profile.
- Confirm member/event_manager cannot call it.
- Confirm profile fields update without touching Auth login.
- Confirm no prayer tracker data is exposed.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-profile-edit-rpc
Previous PR: feature/admin-members-rabbi-role-alignment
Goal of this PR: add a safe admin RPC and service wrapper for editing profile fields of an existing app user/member.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-profile-edit-rpc

Do:
- Add admin_update_user_profile(payload jsonb).
- Require auth.uid().
- Require active admin membership in the selected community.
- Validate payload shape and target_user_id/community_id.
- Allow only supported public.profiles fields.
- Update only public.profiles.
- Add updateAdminUserProfile to adminMembersService.
- Add TypeScript input/output types.
- Update docs/admin-members.md.

Do not:
- Do not create Auth users.
- Do not change Auth email/password.
- Do not touch auth.users.
- Do not use Supabase Admin API.
- Do not use a service-role key.
- Do not add UI.
- Do not read or show prayer_activity_logs.
- Do not run browser/Expo smoke.

Expected scope:
- supabase/migrations/YYYYMMDDHHMMSS_admin_update_user_profile.sql
- apps/admin/src/types/members.ts
- apps/admin/src/services/adminMembersService.ts
- docs/admin-members.md

Run the required backend/admin checks from docs/admin-members-add-user-pr-plan.md.
Commit and push only expected files.
```

---

## PR 3 — `feature/admin-members-profile-edit-ui`

### Goal

Add edit mode to the existing member detail drawer.

### Do

- Add a reusable profile form component.
- Add `Edit` / `Cancel` / `Save` flow in the member drawer.
- Use `admin_update_user_profile` through `adminMembersService`.
- Refresh the drawer and list after save.
- Preserve current membership actions.

Editable profile fields:

```text
full_name
first_name
last_name
display_name
hebrew_name
email profile field
phone
city
birth_date
hebrew_birth_date
birth_time_context
nusach
tribe_status
marital_status
about
onboarding_completed
```

### Do not

- Do not add Add Member modal.
- Do not create users.
- Do not change Auth login/password.
- Do not change membership logic beyond existing actions.
- Do not touch mobile.

### Expected scope

```text
apps/admin/src/pages/MembersPage.tsx
apps/admin/src/components/members/AdminMemberProfileForm.tsx
apps/admin/src/styles/globals.css
docs/admin-members.md
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Open a member card.
- Enter edit mode.
- Change profile fields.
- Save.
- Reload Members page.
- Confirm values persisted.
- Confirm role/status actions still work.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-profile-edit-ui
Previous PR: feature/admin-members-profile-edit-rpc
Goal of this PR: add profile edit mode to the existing member detail drawer using the admin_update_user_profile service wrapper.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-profile-edit-ui

Do:
- Add a reusable AdminMemberProfileForm component.
- Add edit/cancel/save flow to the member detail drawer.
- Use updateAdminUserProfile from adminMembersService.
- Refresh the selected drawer and members list after save.
- Keep current membership role/status actions working.
- Update docs/admin-members.md.

Do not:
- Do not add an Add Member modal.
- Do not create users.
- Do not change Auth login/password.
- Do not touch auth.users.
- Do not use Supabase Admin API or service-role key.
- Do not read or show prayer_activity_logs.
- Do not touch mobile.

Expected scope:
- apps/admin/src/pages/MembersPage.tsx
- apps/admin/src/components/members/AdminMemberProfileForm.tsx
- apps/admin/src/styles/globals.css
- docs/admin-members.md

Run the required admin checks.
Do not run smoke tests. Commit and push only expected files.
```

---

## PR 4 — `feature/admin-members-add-existing-profile`

### Goal

Add the `Добавить участника` button and support adding an existing app profile to the current community.

### Do

- Add a top-right `Добавить участника` button on the Members page.
- Add dialog for searching existing app profiles.
- Use a safe RPC or existing admin list semantics to find profiles allowed in admin scope.
- If a profile has no membership in the current community, allow admin to:
  - edit profile fields;
  - assign role: `member`, `event_manager`, `admin`, `rabbi`;
  - assign status: `active` or `pending`.
- Save via `admin_update_user_profile` + `admin_set_user_membership`.
- Refresh members list after success.

### Do not

- Do not create Auth users.
- Do not set passwords.
- Do not send invites.
- Do not add bulk import.

### Expected scope

```text
apps/admin/src/pages/MembersPage.tsx
apps/admin/src/components/members/AddExistingMemberDialog.tsx
apps/admin/src/components/members/AdminMemberProfileForm.tsx
apps/admin/src/services/adminMembersService.ts
apps/admin/src/types/members.ts
apps/admin/src/styles/globals.css
docs/admin-members.md
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Click `Добавить участника`.
- Search for an existing app profile.
- Fill/edit profile fields.
- Assign role `Раввин`.
- Save.
- Confirm new membership appears in the list.
- Confirm no password was requested or stored.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-add-existing-profile
Previous PR: feature/admin-members-profile-edit-ui
Goal of this PR: add the Add Member button and support adding an existing app profile to the current community.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-add-existing-profile

Do:
- Add a top-right “Добавить участника” button to MembersPage.
- Add AddExistingMemberDialog.
- Search existing app profiles in the allowed admin scope.
- Allow editing profile fields using the existing AdminMemberProfileForm.
- Allow assigning role member/event_manager/admin/rabbi and status active/pending.
- Save through admin_update_user_profile and admin_set_user_membership.
- Refresh list after success.
- Update docs/admin-members.md.

Do not:
- Do not create Auth users.
- Do not set or change passwords.
- Do not send invites.
- Do not touch auth.users.
- Do not use Supabase Admin API or service-role key.
- Do not read or show prayer_activity_logs.
- Do not add bulk import.

Expected scope:
- apps/admin/src/pages/MembersPage.tsx
- apps/admin/src/components/members/AddExistingMemberDialog.tsx
- apps/admin/src/components/members/AdminMemberProfileForm.tsx
- apps/admin/src/services/adminMembersService.ts
- apps/admin/src/types/members.ts
- apps/admin/src/styles/globals.css
- docs/admin-members.md

Run the required admin checks.
Do not run smoke tests. Commit and push only expected files.
```

---

## PR 5 — `feature/admin-members-invite-create-foundation`

### Goal

Add backend/service foundation for creating invites from the Members admin flow.

### Do

- Add RPC `admin_create_invite(payload jsonb)`.
- Require active admin membership.
- Generate invite code and store only its hash.
- Return plaintext invite code once in RPC response.
- Allow role: `member`, `event_manager`, `admin`, `rabbi`.
- Support email, phone, max uses, expiration.
- Add typed admin invites service.
- Update docs.

### Do not

- Do not create Auth users.
- Do not set passwords.
- Do not send email automatically.
- Do not add UI.
- Do not touch `auth.users`.

### Expected scope

```text
supabase/migrations/YYYYMMDDHHMMSS_admin_create_invite_rpc.sql
apps/admin/src/types/invites.ts
apps/admin/src/services/adminInvitesService.ts
docs/admin-members.md
docs/admin-beta-access.md
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Create invite as admin through RPC/service test path.
- Confirm member/event_manager cannot create invite.
- Confirm role `rabbi` is accepted.
- Confirm plaintext code is not stored.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-invite-create-foundation
Previous PR: feature/admin-members-add-existing-profile
Goal of this PR: add backend and service foundation for creating member invites from web-admin.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-invite-create-foundation

Do:
- Add admin_create_invite(payload jsonb).
- Require active admin membership in the selected community.
- Generate an invite code and store only code_hash.
- Return the plaintext invite code once.
- Allow role member/event_manager/admin/rabbi.
- Support email, phone, maxUses, expiresAt.
- Add apps/admin/src/types/invites.ts.
- Add apps/admin/src/services/adminInvitesService.ts.
- Update docs/admin-members.md and docs/admin-beta-access.md.

Do not:
- Do not create Auth users.
- Do not set passwords.
- Do not send email automatically.
- Do not add UI.
- Do not touch auth.users.
- Do not use Supabase Admin API or service-role key.
- Do not read or show prayer_activity_logs.

Expected scope:
- supabase/migrations/YYYYMMDDHHMMSS_admin_create_invite_rpc.sql
- apps/admin/src/types/invites.ts
- apps/admin/src/services/adminInvitesService.ts
- docs/admin-members.md
- docs/admin-beta-access.md

Run the required backend/admin checks.
Do not run smoke tests. Commit and push only expected files.
```

---

## PR 6 — `feature/admin-members-add-invite-ui`

### Goal

Add the invite-based new member mode to the `Добавить участника` dialog.

### Do

- Update Add Member dialog to have two modes:
  - Existing app profile.
  - New participant by invite.
- Add invite form fields:
  - email;
  - phone;
  - optional name/profile draft fields if already supported;
  - role;
  - expiration;
  - max uses.
- Create invite through `adminInvitesService`.
- Show generated code/link once.
- Add copy button.
- Clearly state that the user sets their own password during registration.

### Do not

- Do not set password.
- Do not create Auth user.
- Do not send email automatically.
- Do not add invite inbox/list.
- Do not change mobile auth flow.

### Expected scope

```text
apps/admin/src/pages/MembersPage.tsx
apps/admin/src/components/members/AddMemberDialog.tsx
apps/admin/src/components/members/AddExistingMemberDialog.tsx
apps/admin/src/components/members/AdminMemberProfileForm.tsx
apps/admin/src/services/adminInvitesService.ts
apps/admin/src/types/invites.ts
apps/admin/src/styles/globals.css
docs/admin-members.md
```

### Manual smoke checklist

Not run by Codex. Manual smoke is performed by the project owner.

- Click `Добавить участника`.
- Switch to new participant invite mode.
- Fill email/role `Раввин`/expiration.
- Create invite.
- Copy code/link.
- Confirm no password field exists.
- Use invite manually in the app flow.

### Codex prompt

```text
We are working in the sredi-svoih-app project.
Current PR: feature/admin-members-add-invite-ui
Previous PR: feature/admin-members-invite-create-foundation
Goal of this PR: add invite-based new participant mode to the Add Member dialog.

Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-add-invite-ui

Do:
- Update the Add Member dialog to support two modes: existing app profile and new participant by invite.
- Add invite form fields for email, phone, role, expiration, and max uses.
- Use adminInvitesService to create the invite.
- Show the generated invite code/link once.
- Add a copy button.
- Clearly state that the user sets their own password during registration.
- Update docs/admin-members.md.

Do not:
- Do not set or change passwords.
- Do not create Auth users.
- Do not send email automatically.
- Do not add invite inbox/list.
- Do not touch auth.users.
- Do not use Supabase Admin API or service-role key.
- Do not read or show prayer_activity_logs.
- Do not change mobile auth flow.

Expected scope:
- apps/admin/src/pages/MembersPage.tsx
- apps/admin/src/components/members/AddMemberDialog.tsx
- apps/admin/src/components/members/AddExistingMemberDialog.tsx
- apps/admin/src/components/members/AdminMemberProfileForm.tsx
- apps/admin/src/services/adminInvitesService.ts
- apps/admin/src/types/invites.ts
- apps/admin/src/styles/globals.css
- docs/admin-members.md

Run the required admin checks.
Do not run smoke tests. Commit and push only expected files.
```

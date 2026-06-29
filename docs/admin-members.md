# Admin Members RPC Foundation

This document describes the backend foundation for the future web-admin
"Members" section. This PR adds Supabase RPCs only; it does not add UI, routes,
screens, or browser smoke coverage.

## Access Model

Supabase Auth and community membership are separate concepts:

- Supabase Auth identifies the signed-in app user.
- `community_memberships` decides whether that user has access to a community.
- Member administration is available only to an active `admin` membership in the
  selected community. `event_manager` can manage event workflows, but cannot
  manage participants or memberships.

The admin members RPCs use the regular authenticated Supabase session. They do
not read `auth.users` directly and do not require privileged browser secrets.

## Source Of Users

The source of users for this section is `public.profiles`.

The admin list combines:

- profiles with a `community_memberships` row in the selected community;
- app profiles that do not currently have an active membership.

That means a person can appear in web-admin even before they become a member of
the community. In the UI, a profile without a membership should be labeled as
"Пользователь приложения" rather than as a community member.

Membership data is left-joined to profiles, so membership fields can be `null`.
No membership action should delete a profile or delete an Auth user.

## Privacy Boundary

Prayer tracker data is private personal data and is intentionally outside the
admin members surface. These RPCs do not read `prayer_activity_logs`.

The member card may include profile fields, community membership, and event
registration aggregates or history for the selected community.

## RPCs

- `admin_list_users(payload jsonb default '{}'::jsonb)` returns profiles,
  membership fields, and event registration counters.
- `admin_get_user_profile(target_user_id uuid, community_id uuid)` returns one
  extended profile card with membership and registration aggregates.
- `admin_update_user_profile(payload jsonb)` updates explicitly allowed fields
  on an existing `public.profiles` row in the selected admin community scope.
- `admin_list_user_registrations(target_user_id uuid, community_id uuid)`
  returns the selected user's event registrations in the community, including
  occurrence timing and selected participation options when present.
- `admin_set_user_membership(payload jsonb)` creates or updates a membership for
  `communityId`, `userId`, `role`, and `status`.

`admin_list_users` supports these payload fields:

- `communityId`
- `search`
- `membershipStatus`: `all`, `active`, `pending`, `suspended`, `left`,
  `no_membership`
- `role`: `all`, `member`, `rabbi`, `event_manager`, `admin`
- `onboarding`: `all`, `completed`, `incomplete`
- `limit`
- `offset`

`admin_set_user_membership` does not remove users. Future "exclude from
community" actions should set `status` to `left` or `suspended`.

`admin_update_user_profile` uses a strict payload contract:

- `targetUserId` or `target_user_id`
- `communityId` or `community_id`
- `fields`, an object keyed by supported `public.profiles` column names

Supported editable profile fields are:

- `full_name`
- `first_name`
- `last_name`
- `display_name`
- `hebrew_name`
- `email`
- `phone`
- `city`
- `birth_date`
- `hebrew_birth_date`
- `birth_time_context`
- `nusach`
- `tribe_status`
- `marital_status`
- `about`
- `onboarding_completed`

Unsupported top-level payload keys and unsupported `fields` keys are rejected
with `22023`. The RPC derives the acting admin from `auth.uid()` only; it does
not accept a caller-supplied admin user id. It requires an active `admin`
membership in the selected community and applies the same profile scope as the
member detail RPC: the target profile must either have a membership row in the
selected community or have no active membership in any community.

The RPC writes only `public.profiles`. Updating `email` updates the profile
field only; it does not touch Supabase Auth login email, Auth password,
`auth.users`, `community_memberships`, event registrations, or prayer tracker
data.

## Admin Web Service Layer

The web-admin service layer for this backend foundation lives in:

- `apps/admin/src/types/members.ts`
- `apps/admin/src/services/adminMembersService.ts`

The service layer provides typed wrappers around the admin members RPCs:

- `listAdminUsers(filters)` calls `admin_list_users`.
- `getAdminUserProfile(userId, communityId)` calls `admin_get_user_profile`.
- `updateAdminUserProfile(input)` calls `admin_update_user_profile`.
- `listAdminUserRegistrations(userId, communityId)` calls
  `admin_list_user_registrations`.
- `setAdminUserMembership(input)` calls `admin_set_user_membership`.

RPC rows are normalized from `snake_case` to `camelCase` for React usage.
The service also converts missing-RPC and access-denied errors into friendly
messages for the future UI.

## Members List UI

The web-admin "Участники" page now uses `adminMembersService.listAdminUsers`
instead of mock data. The list is scoped to the current admin membership's
`community_id` and calls `admin_list_users` through the regular authenticated
Supabase session.

The first UI pass includes:

- summary counts calculated from the loaded rows;
- search by name, email, phone, or city;
- membership-status filters including `no_membership`;
- role filters for `member`, `rabbi`, `event_manager`, and `admin`;
- loading, error, retry, and empty states;
- a table with profile, membership, registration counters, and last
  registration timestamp.

Invite creation, messages, and participation insights remain separate PRs.

## Member Detail Drawer

The web-admin "Участники" list now opens a read/write side drawer when an admin
clicks a user row. The drawer calls `admin_get_user_profile` and
`admin_list_user_registrations` for the selected profile in the current
community.

The drawer shows:

- profile fields from the selected user's profile card;
- community membership fields when the user belongs to the community;
- registration counters and registration history for events in the community;
- Russian labels for profile, membership, and registration fields instead of
  technical camelCase names;
- Hebrew birth date as a human-readable Russian date, for example
  `10 Хешвана 5746`, instead of raw JSON;
- an empty state when the user has no event registrations.

Invite creation, messaging, exports, and participation insights remain separate
PRs.

## Profile Edit Mode

The member detail drawer now lets admins edit the selected user's existing
profile fields in place. The drawer keeps read-only profile rows by default and
switches only the profile section into an edit form after the admin clicks
`Редактировать`.

Profile saves use `adminMembersService.updateAdminUserProfile`, which calls
`admin_update_user_profile` through the regular authenticated Supabase client.
The UI sends only changed camelCase fields to the service wrapper; cleared
nullable fields are sent as `null`, and unchanged fields are omitted. After a
successful save, the drawer refreshes the selected profile and the members list
so the table row stays in sync.

This edit mode updates only `public.profiles`. It does not create Auth users,
create profiles for missing Auth users, change Auth email/password, touch
`auth.users`, use the Supabase Admin API, or use a service-role key in browser
code.

## Membership Actions

The member detail drawer now includes focused membership actions for the current
community. These actions use `adminMembersService.setAdminUserMembership`, which
calls the `admin_set_user_membership` RPC through the regular authenticated
Supabase client.

The web-admin can:

- make an app user a community member with `role: "member"` and
  `status: "active"`;
- update membership role to `member`, `rabbi`, `event_manager`, or `admin`;
- update membership status to `pending`, `active`, `suspended`, or `left`;
- quickly suspend, restore, or exclude a user from the community.

These actions never delete from `auth.users`, never delete `public.profiles`,
and do not use the Supabase Admin API or service-role credentials in the
browser. "Exclude from community" is represented as a membership status change
such as `left` or `suspended`; the person remains an app user.

Invite creation, message sending, notifications, exports, audit logs, and
member insights/statistics are intentionally left for separate PRs.

## Add Existing Profile

The members page now has a top-right `Добавить участника` button. It opens a
dialog for adding an existing app profile to the current community.

The dialog searches through `adminMembersService.listAdminUsers` with
`membershipStatus: "no_membership"`, so admins can select only profiles that are
inside the existing admin members scope and do not already have a membership in
the selected community. After selection, the dialog loads the extended profile
card through `admin_get_user_profile`, reuses the same profile edit form as the
member detail drawer, and lets the admin assign:

- role: `member`, `event_manager`, `admin`, or `rabbi`;
- status: `active` or `pending`.

Saving uses the existing RPC boundary:

- changed profile fields are saved through `admin_update_user_profile`;
- the community membership is created or updated through
  `admin_set_user_membership`;
- the members list refreshes after a successful save and the dialog closes.

This workflow adds only an existing `public.profiles` app user to the community.
It does not create Supabase Auth users, create profiles for missing Auth users,
set or request passwords, change Auth email/password, touch `auth.users`, use
the Supabase Admin API, use service-role credentials, send invites, or read
prayer tracker data.

## Invite Creation Foundation

The backend and admin service foundation for creating member invites now exists.
This was originally a backend/service-only step: it added an RPC and a typed
service wrapper. The invite UI that consumes it is described in
[Add Member Invite UI](#add-member-invite-ui).

`admin_create_invite(payload jsonb)` creates an invite for the selected
community. It:

- requires `auth.uid()` and an active `admin` membership in the community;
- derives the acting admin only from `auth.uid()`, never from the payload, so a
  spoofed admin identity is rejected;
- validates the community id, role, max uses, and optional expiration;
- generates a safe random invite code and stores only its sha256 hash, using the
  same hash formula as `public.accept_invite`, so created codes stay compatible
  with the existing invite acceptance flow;
- returns the plaintext invite code exactly once in the RPC response; the
  plaintext code is never stored.

The RPC accepts a strict payload contract and rejects unsupported top-level keys
with `22023`. Supported payload fields are:

- `communityId` or `community_id` (required)
- `role` (defaults to `member`): `member`, `event_manager`, `admin`, or `rabbi`
- `email`
- `phone`
- `maxUses` or `max_uses` (defaults to `1`, allowed range `1`–`1000`)
- `expiresAt` or `expires_at` (optional ISO timestamp, must be in the future)

The RPC writes only `public.invites`. It does not create Auth users, create
profiles for missing Auth users, set or request passwords, change Auth
email/password, touch `auth.users`, use the Supabase Admin API, use a
service-role key, or send email. It does not read prayer tracker data.

### Admin Invite Service Layer

The web-admin service layer for invite creation lives in:

- `apps/admin/src/types/invites.ts`
- `apps/admin/src/services/adminInvitesService.ts`

`createAdminInvite(input)` calls `admin_create_invite` through the regular
authenticated Supabase client and normalizes the `snake_case` RPC row to
`camelCase`. The returned `code` is the plaintext invite code, surfaced exactly
once; callers must capture it from the result because only its hash is stored.
The service converts missing-RPC and access-denied errors into friendly messages
for future UI.

An invite inbox/list and automatic email sending remain separate PRs.

## Add Member Invite UI

The `Добавить участника` dialog now has two modes, selected with a toggle in the
dialog header:

- **Профиль приложения** — the existing flow that adds an existing
  `public.profiles` app user to the community (unchanged from
  [Add Existing Profile](#add-existing-profile)).
- **Новый по приглашению** — a new mode that creates a community invite for a
  person who does not yet have an app account.

The invite mode collects:

- `email` (optional);
- `phone` (optional);
- `role`: `member` (Участник), `event_manager` (Организатор), `admin`
  (Администратор), or `rabbi` (Раввин);
- `Действует до` expiration (optional, sent as an ISO timestamp);
- `Макс. использований` max uses (defaults to `1`).

Creating the invite calls `adminInvitesService.createAdminInvite`, which wraps
`admin_create_invite` through the regular authenticated Supabase client. The
plaintext invite code returned by the RPC is shown once after a successful
creation, with a copy button. The dialog stays open afterward so the admin can
copy the code or create another invite. Loading and error states are shown
during creation.

The UI states clearly that the user sets their own password during registration
by activating the code. This flow creates an invite only:

- it does not create a Supabase Auth user;
- it does not create a profile before the invite is accepted;
- it does not set or request a password;
- it does not send email automatically;
- it does not change Auth email/password or touch `auth.users`;
- it does not use the Supabase Admin API or a service-role key;
- it does not read prayer tracker data.

The UI does not add an invite inbox/list or invite management table, and it does
not change the mobile auth flow or the invite acceptance flow.

## Future UI Actions

Future web-admin work can build on these RPCs for:

- invites;
- messages;
- registration and participation insights;
- member detail views.

Future PRs should continue to add one focused members workflow at a time on top
of the existing RPC and RLS boundary.

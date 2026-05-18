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
- `role`: `all`, `member`, `event_manager`, `admin`
- `onboarding`: `all`, `completed`, `incomplete`
- `limit`
- `offset`

`admin_set_user_membership` does not remove users. Future "exclude from
community" actions should set `status` to `left` or `suspended`.

## Admin Web Service Layer

The web-admin service layer for this backend foundation lives in:

- `apps/admin/src/types/members.ts`
- `apps/admin/src/services/adminMembersService.ts`

The service layer provides typed wrappers around the admin members RPCs:

- `listAdminUsers(filters)` calls `admin_list_users`.
- `getAdminUserProfile(userId, communityId)` calls `admin_get_user_profile`.
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
- role filters for `member`, `event_manager`, and `admin`;
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

## Membership Actions

The member detail drawer now includes focused membership actions for the current
community. These actions use `adminMembersService.setAdminUserMembership`, which
calls the `admin_set_user_membership` RPC through the regular authenticated
Supabase client.

The web-admin can:

- make an app user a community member with `role: "member"` and
  `status: "active"`;
- update membership role to `member`, `event_manager`, or `admin`;
- update membership status to `pending`, `active`, `suspended`, or `left`;
- quickly suspend, restore, or exclude a user from the community.

These actions never delete from `auth.users`, never delete `public.profiles`,
and do not use the Supabase Admin API or service-role credentials in the
browser. "Exclude from community" is represented as a membership status change
such as `left` or `suspended`; the person remains an app user.

Invite creation, message sending, notifications, exports, audit logs, and
member insights/statistics are intentionally left for separate PRs.

## Future UI Actions

Future web-admin work can build on these RPCs for:

- invites;
- messages;
- registration and participation insights;
- member detail views.

Future PRs should continue to add one focused members workflow at a time on top
of the existing RPC and RLS boundary.

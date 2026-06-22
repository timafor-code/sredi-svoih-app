# Admin Feedback

This document describes the backend foundation and Phase 1 submit UI for beta
feedback in web-admin. PR #218 added the database schema and one write RPC. The
current UI PR adds a submit-only button/dialog that calls that RPC. It does not
add routes, feedback inboxes, screenshots, uploads, or GitHub issue creation.

## Purpose

Beta feedback lets admins and event managers report notes, issues, blockers, or
ideas from the web-admin experience while the server derives the community and
user from the authenticated session. The browser uses the regular authenticated
Supabase client. No service-role key, Supabase Admin API, or direct
`auth.users` access is required.

## Table

`public.admin_feedback` stores one feedback item per row.

Key fields:

- `community_id`: the community that owns the feedback item.
- `user_id`: the authenticated profile that submitted the item.
- `section`: the admin area or workflow where feedback was created.
- `entity_type` and `entity_id`: optional context for a related event,
  registration, seating layout, or other future admin entity.
- `severity`: one of `note`, `issue`, `blocker`, or `idea`; defaults to `note`.
- `message`: the human feedback body.
- `status`: one of `open`, `reviewed`, `resolved`, or `closed`; defaults to
  `open`.
- `user_agent` and `url`: optional browser context.
- `resolved_at` and `resolved_by`: reserved for the future review workflow.

The table enforces non-empty `section` and `message` values, enum-like checks
for `severity` and `status`, and bounded text lengths. `updated_at` is maintained
with the existing project trigger helper `public.set_updated_at()`.

RLS is enabled on the table. This foundation does not grant direct browser
write access to the table; writes go through the RPC below.

## RPC

`public.admin_create_feedback(payload jsonb)` inserts one feedback item and
returns a minimal JSON result:

```json
{
  "id": "feedback-row-id",
  "status": "open",
  "created_at": "timestamp"
}
```

Accepted payload fields:

- `section` (required, trimmed, max 80 characters)
- `message` (required, trimmed, max 4000 characters)
- `severity` (optional: `note`, `issue`, `blocker`, `idea`; defaults to `note`)
- `entityType` or `entity_type` (optional, max 80 characters)
- `entityId` or `entity_id` (optional UUID)
- `userAgent` or `user_agent` (optional, max 500 characters)
- `url` (optional, max 1000 characters)

`communityId`, `community_id`, `userId`, and `user_id` are rejected. The RPC
derives `community_id` from the caller's active admin/event-manager membership
and derives `user_id` from `auth.uid()`.

## Access Model

Only authenticated users with an active `admin` or `event_manager` membership
can create feedback. The RPC looks up the caller in `community_memberships`,
requires exactly one active managed community for this beta v1 write path, and
never reads or writes `auth.users` directly.

In web-admin, the feedback button is available in the beta admin layout for
`admin` and `event_manager` users. The UI uses the regular authenticated
Supabase client and submits through `public.admin_create_feedback(payload jsonb)`.

## UI Flow

The admin layout renders an `Оставить замечание` button on every page that uses
`AdminLayout`. The button opens a modal dialog with:

- a severity selector with the backend-supported values `note`, `issue`,
  `blocker`, and `idea`;
- a message textarea capped to the backend message limit;
- cancel/close controls that are disabled during submit;
- success and error states after the RPC response.

On submit, the browser sends only the RPC payload. The UI includes:

- `section`: the current admin section from `AdminLayout`;
- `severity`: one of the four supported values;
- `message`: the trimmed textarea value;
- `url`: the current browser URL when available;
- `user_agent`: the browser user agent when available;
- optional `entity_type` and `entity_id` only when a caller can provide that
  context without expanding page scope.

The submit UI does not insert directly into `public.admin_feedback`, does not
list feedback, and does not use service-role credentials or the Supabase Admin
API.

## Manual Smoke

Manual browser smoke is expected to be run by the project owner against the
server/staging beta admin.

Suggested checklist:

- Sign in as a beta `admin` user and confirm the `Оставить замечание` button is
  visible across admin layout pages.
- Open the dialog from at least the overview page and one workflow page.
- Submit each severity value (`note`, `issue`, `blocker`, `idea`) with a short
  message and confirm the success state appears.
- Try an empty message and confirm submit is blocked.
- Temporarily force an RPC/auth failure if practical and confirm the error state
  is visible.
- Confirm the stored payload contains the expected `section`, `url`,
  `user_agent`, `severity`, and `message` values.
- Sign in as a beta `event_manager` and confirm the same submit flow is
  available.

## Out Of Scope

Feedback list/inbox views, screenshot or attachment uploads, file storage,
GitHub issue creation, and GitHub integration are intentionally not part of this
PR. This PR also does not add import buttons or change registrations, seating,
mobile, invite access, backend schema, migrations, or RPC definitions.

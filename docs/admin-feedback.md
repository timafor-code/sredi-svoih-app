# Admin Feedback

This document describes the backend foundation for beta feedback in web-admin.
This PR adds database schema and one write RPC only. It does not add UI, routes,
feedback inboxes, screenshots, uploads, or GitHub issue creation.

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

## Out Of Scope

The admin UI for submitting feedback will be added in a separate PR. Feedback
list/inbox views, screenshot or attachment uploads, and GitHub issue creation
are intentionally not part of this foundation PR.

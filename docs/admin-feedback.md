# Admin Feedback

This document describes beta feedback in web-admin: the existing submit UI and
the admin-only review list added for Phase 3 / PR 25.

## Purpose

Beta feedback lets admins and event managers report notes, issues, blockers, or
ideas from the web-admin experience. Admins can also review the feedback inbox,
filter items, and move items through a small status workflow.

The browser uses the regular authenticated Python API client. Admin actions
stay behind API authorization boundaries. No service-role key, Supabase Admin
API, direct `auth.users` reads, or browser-side table access is used.

Provider-switch statements later in this historical rollout record describe
pre-PR 38 behavior only; web-admin has no Supabase fallback.

## Table

`public.admin_feedback` stores one feedback item per row.

Key fields:

- `community_id`: the community that owns the feedback item.
- `user_id`: the authenticated profile that submitted the item.
- `section`: the admin area or workflow where feedback was created.
- `entity_type` and `entity_id`: optional context for a related event,
  registration, seating layout, or future admin entity.
- `severity`: one of `note`, `issue`, `blocker`, or `idea`; defaults to `note`.
- `message`: the human feedback body.
- `status`: one of `open`, `reviewed`, `resolved`, or `closed`; defaults to
  `open`.
- `user_agent` and `url`: optional browser context.
- `resolved_at` and `resolved_by`: set when an item is marked `resolved` or
  `closed`.

The table enforces non-empty `section` and `message` values, enum-like checks
for `severity` and `status`, and bounded text lengths. `updated_at` is maintained
by the project trigger helper and is also explicitly touched by the status RPC.

RLS is enabled on the table. Browser clients do not receive direct table grants;
all reads and writes go through RPCs.

## Submit RPC

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

## Review List RPC

`public.admin_list_feedback(payload jsonb default '{}'::jsonb)` returns feedback
rows for the caller's active admin community only. Each returned row includes
`total_count` for the full filtered result set.

Returned fields:

- `id`
- `community_id`
- `user_id`
- `section`
- `entity_type`
- `entity_id`
- `severity`
- `message`
- `status`
- `url`
- `user_agent`
- `created_at`
- `updated_at`
- `resolved_at`
- `resolved_by`
- `total_count`

Supported filters:

- `status`: `open`, `reviewed`, `resolved`, `closed`, `all`, or null.
- `severity`: `note`, `issue`, `blocker`, `idea`, `all`, or null.
- `section`: optional exact section string.
- `limit`: defaults to 50 and is capped at 100.
- `offset`: defaults to 0.

Rows are ordered by `created_at desc`. The RPC derives `community_id` only from
the caller's active `admin` membership and rejects client-supplied community or
user ids.

## Status Update RPC

`public.admin_update_feedback_status(payload jsonb)` updates one feedback item
in the caller's active admin community.

Accepted payload fields:

- `id` (required feedback UUID)
- `status` (required: `open`, `reviewed`, `resolved`, or `closed`)

When status is set to `resolved` or `closed`, the RPC sets `resolved_at = now()`
and `resolved_by = auth.uid()`. When status is set back to `open` or
`reviewed`, the RPC clears `resolved_at` and `resolved_by` so resolution metadata
always describes the current terminal state.

The RPC returns the updated row without `total_count`. If the feedback row does
not exist in the caller's admin community, the RPC raises an exception.

## Access Model

- Submit: authenticated users with an active `admin` or `event_manager`
  membership can submit feedback.
- Review list and status update: only authenticated users with an active
  `admin` membership can read or update feedback.
- `event_manager` cannot read the full feedback inbox and cannot update status.
- `member` and no-access users cannot submit review actions or open the review
  route.
- The RPCs do not read `auth.users`.
- Web-admin uses the regular authenticated Supabase client.
- Admin reads and writes stay behind RPC/RLS boundaries.

## UI Flow

The admin layout renders the existing `Оставить замечание` submit button for
admin and event-manager users.

The admin-only Feedback navigation item opens `Beta feedback / Обратная связь
beta`. The page includes:

- status, severity, and section filters;
- refresh, loading, error, and empty states;
- feedback cards with severity/status badges, section, message, timestamps, URL,
  user agent, entity context, and `user_id`;
- status actions: Mark reviewed, Mark resolved, Close, and Reopen.

The review page does not create GitHub issues, upload screenshots, send email,
or delete feedback.

## API Feedback Management Prerequisite For PR 37

`VITE_ADMIN_FEEDBACK_PROVIDER` defaults to `supabase`; an unset or unsupported
value is also Supabase. This preserves the existing submission, inbox, and
status RPC behavior. In `api` mode, the regular authenticated web-admin API
client now maps all existing Feedback-page operations to the Python API:

- `POST /admin/feedback` submits feedback for active `admin` and
  `event_manager` memberships.
- `GET /admin/feedback` returns the admin-only inbox with `status`, `severity`,
  exact trimmed `section`, `limit`, and `offset` filters. Its response contains
  `items`, `total_count`, `limit`, and `offset`; rows are ordered by
  `created_at DESC` with an ID tie-breaker.
- `PATCH /admin/feedback/{feedback_id}` updates the admin-only status workflow
  and returns the complete updated feedback item.

Inbox listing and status management require an active `admin` membership for
the feedback community. `event_manager` can still submit feedback but cannot
read the inbox or update its status. Out-of-scope and missing feedback IDs use
the same safe not-found response.

The API adapter never falls back to Supabase: an API request failure remains an
API failure and cannot create, read, or update a legacy Supabase row. Explicit
`supabase` provider mode continues to use the existing RPC path.

This is the cutover prerequisite for PR 37,
`feature/backend-provider-cutover`. Production provider defaults are not
changed here; the next PR is responsible for deciding and applying those
defaults.

## Statuses

- `open`: newly submitted or reopened feedback.
- `reviewed`: an admin has triaged the item but it is not resolved.
- `resolved`: the item has been handled.
- `closed`: the item is intentionally closed without further action.

## Out Of Scope

- GitHub issue creation.
- Screenshots, uploads, attachments, or file storage.
- Email notifications.
- Delete feedback.
- Service-role key or Supabase Admin API in the browser.
- Direct browser access to `public.admin_feedback`.
- Reading `auth.users`.

## Manual Smoke

Manual browser smoke is expected to be run by the project owner. Codex does not
run browser smoke for this PR.

Checklist:

- Open web-admin as admin.
- Confirm Feedback navigation item is visible for admin.
- Open Feedback page.
- Confirm list loads.
- Filter by status.
- Filter by severity.
- Filter by section.
- Mark an open feedback item as reviewed.
- Mark an item as resolved.
- Close an item.
- Reopen an item.
- Confirm updated status persists after refresh.
- Login as event_manager and confirm Feedback review page is not accessible.
- Confirm event_manager can still submit feedback from existing feedback dialog.
- Confirm member/no-access cannot access feedback review.
- Confirm no GitHub issue, screenshot upload, email notification, or delete
  action exists.
- Confirm no browser smoke was run by Codex.

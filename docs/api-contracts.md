# API Contracts

Source of truth: repository-root `plan.md`, version `2026-07-06 v2.7`.

This file defines the stable REST/JSON contract foundation for the backend
migration. It is documentation only: it does not create backend code, Python
files, schemas, migrations, runtime clients, or infrastructure.

The endpoint paths below are the future HTTPS JSON API surface for `apps/api`.
Mobile and web-admin must call the API through their app-specific wrappers.
They must not connect directly to PostgreSQL, use a backend database URL, or
perform authorization checks that belong on the API.

Supabase remains a legacy/dev reference while provider flags still point to
Supabase. The Python API owns authorization guards and transactional checks for
domains that have moved to the API.

## Contract Scope

The first stable endpoint groups are:

- `/auth/*`
- `/me/*`
- `/events/*`
- `/registrations/*`
- `/admin/*`
- `/privacy/*`

This document also records shared conventions for response envelopes, errors,
authorization, pagination, identifiers, date/time values, validation failures,
not-found responses, and conflict/idempotency cases.

## JSON Conventions

- Requests and responses use `application/json; charset=utf-8`.
- JSON field names use `snake_case`.
- Enum values use lowercase `snake_case`.
- Boolean values are JSON `true` and `false`.
- Empty optional fields are returned as `null` when the field is part of a
  stable shape. Fields the actor is not allowed to know must be omitted or
  returned as `null` according to the endpoint contract.
- Unknown request fields should be rejected with `validation_error` unless a
  later endpoint explicitly documents forward-compatible metadata.
- Clients should render localized UI from stable codes, not from server
  `message` strings.

## Identifiers And Date/Time

Identifiers are UUID strings in canonical text form:

```json
"event_id": "4c0f2e79-7e42-49e7-a8a3-72d83a8d02ac"
```

All date/time values use ISO 8601 with timezone:

```json
"starts_at": "2026-07-06T19:30:00+03:00"
"created_at": "2026-07-06T16:30:00Z"
```

Stored audit timestamps should be emitted in UTC with `Z` when possible. Event
and occurrence times that depend on the event location may include the local
timezone offset and should include a stable timezone field when recurrence or
calendar display depends on it.

## Response Envelope

Every JSON response uses the same top-level shape.

Success:

```json
{
  "data": {
    "id": "4c0f2e79-7e42-49e7-a8a3-72d83a8d02ac"
  },
  "error": null,
  "meta": {
    "request_id": "8e9c2a4d-5e30-47c9-b749-1f8da61b82f5"
  }
}
```

Error:

```json
{
  "data": null,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "starts_at",
        "code": "required",
        "message": "Field is required."
      }
    ]
  },
  "meta": {
    "request_id": "8e9c2a4d-5e30-47c9-b749-1f8da61b82f5"
  }
}
```

`data` contains the resource, collection, or action result. `error` is `null`
for success and populated for failures. `meta.request_id` is present on every
response so clients can report issues without exposing sensitive payloads.

## Pagination

List endpoints use cursor pagination unless an endpoint explicitly states that
the full list is bounded and unpaginated.

Request query:

```text
?limit=50&cursor=<opaque_cursor>
```

Response metadata:

```json
{
  "meta": {
    "request_id": "8e9c2a4d-5e30-47c9-b749-1f8da61b82f5",
    "pagination": {
      "limit": 50,
      "next_cursor": "opaque-cursor",
      "has_more": true
    }
  }
}
```

Default `limit` is 50. Maximum `limit` is 100 unless an admin export or
review endpoint documents a lower or higher bound. Cursors are opaque strings;
clients must not parse them. Stable ordering should include a deterministic
tie-breaker, usually `created_at` plus `id`.

## Authentication And Authorization

Authenticated requests send:

```http
Authorization: Bearer <access_token>
```

Access tokens are bearer credentials. The API and clients must not log raw
tokens, refresh tokens, password reset codes, invite codes, or comparable
secrets. Expired, missing, malformed, or revoked tokens return HTTP 401 with
`unauthenticated`.

Production API auth must not be enabled until OAuth-only users have an explicit
migration path. Apple Sign-In is not part of the first backend migration wave.

Public endpoints may be called without `Authorization`. They may return less
data to anonymous actors than to active members. Member-only, current-user, and
admin endpoints require an access token and API-side authorization guards.

Admin endpoints require an active community membership with the required role.
The API must scope admin reads and writes to the actor's community and perform
transactional checks for protected writes. Web-admin and mobile admin surfaces
must not rely on direct database access or client-side-only authorization.

## Idempotency And Conflicts

Mutating endpoints that can create duplicate user-visible effects on retry
should accept:

```http
Idempotency-Key: <client-generated-key>
```

The key is scoped to the actor, route, and request body. Replaying the same key
with the same body returns the original successful response where possible.
Replaying the same key with a different body returns HTTP 409 with
`idempotency_conflict`.

Capacity, uniqueness, and state-transition races return HTTP 409 with a stable
domain code such as `conflict`, `capacity_unavailable`, or
`state_conflict`. Registration capacity checks must be enforced by the API with
database transactions and locks where needed.

## Common Error Codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed JSON, unsupported query shape, or invalid request syntax. |
| 400 | `validation_error` | Request parsed, but fields failed validation. |
| 401 | `unauthenticated` | Missing, expired, invalid, or revoked access token. |
| 403 | `forbidden` | Actor is authenticated but not allowed to perform the action. |
| 404 | `not_found` | Resource does not exist or is not visible to the actor. |
| 409 | `conflict` | Request conflicts with current resource state. |
| 409 | `idempotency_conflict` | Idempotency key was reused with a different request body. |
| 409 | `capacity_unavailable` | Registration would exceed event, occurrence, or option capacity. |
| 409 | `state_conflict` | Requested transition is invalid for the current state. |
| 413 | `payload_too_large` | Request body exceeds the documented size limit. |
| 415 | `unsupported_media_type` | Request content type is not supported. |
| 422 | `validation_error` | Field-level validation failed after JSON parsing. |
| 429 | `rate_limited` | Caller exceeded a rate or abuse-prevention limit. |
| 500 | `internal_error` | Unexpected server error. |
| 503 | `service_unavailable` | Required dependency is temporarily unavailable. |

Validation details use stable field paths:

```json
{
  "field": "participation_options[0].capacity_units[0].quantity",
  "code": "min_value",
  "message": "Value must be at least 1."
}
```

Authorization failures must not reveal private resource existence. If the actor
cannot know that a resource exists, return `not_found` instead of `forbidden`.

## `/auth/*`

Auth endpoints define the contract for API-owned auth. They remain governed by
the staged migration rules in `plan.md`; documenting them here does not enable
production API auth.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/password/sign-in` | Public | Exchange email/password credentials for an access token and refresh session. |
| POST | `/auth/refresh` | Public/session | Rotate a refresh session and return a new access token. |
| POST | `/auth/logout` | Authenticated | Revoke the current refresh session or all sessions when requested. |
| POST | `/auth/password/reset/request` | Public | Request password reset delivery when a working delivery path exists. |
| POST | `/auth/password/reset/confirm` | Public | Confirm reset code and set a new password. |
| POST | `/auth/email/verify` | Public | Confirm email verification code when delivery exists. |
| POST | `/auth/invites/accept` | Public or authenticated | Accept an invite code and bind it to an API user. |

Auth response `data` may include:

```json
{
  "access_token": "jwt-access-token",
  "expires_at": "2026-07-06T17:00:00Z",
  "refresh_token": "refresh-token-returned-once",
  "user": {
    "id": "4c0f2e79-7e42-49e7-a8a3-72d83a8d02ac"
  }
}
```

Server storage must never store plaintext passwords or plaintext refresh
tokens. Invite codes are returned or accepted as plaintext only at the API
boundary required for the user flow; only safe derived values may be stored.

Expected auth errors include `validation_error`, `unauthenticated`,
`forbidden`, `rate_limited`, and `conflict`. Password reset and email
verification endpoints must not report completion until delivery is working.

## `/me/*`

Current-user endpoints require `Authorization: Bearer <access_token>` and are
scoped to the authenticated actor.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Return the current API user, profile summary, active memberships, and roles needed by clients. |
| PATCH | `/me/profile` | Update allowed profile fields for the current user. |
| GET | `/me/memberships` | List the actor's community memberships and role/status values. |
| GET | `/me/registrations` | List the actor's event registrations. |
| GET | `/me/prayer-logs` | List the actor's personal prayer tracker logs. |
| POST | `/me/prayer-logs` | Create a prayer tracker log for the actor. |
| DELETE | `/me/prayer-logs/{log_id}` | Delete one prayer tracker log owned by the actor. |
| GET | `/me/prayer-summary` | Return current-user prayer tracker summary data. |
| GET | `/me/contact-visibility` | Return the actor's contact visibility settings. |
| PUT | `/me/contact-visibility` | Replace the actor's contact visibility settings. |
| POST | `/me/device-tokens` | Register or update one device token for the actor. |
| DELETE | `/me/device-tokens/{token_id}` | Deactivate one device token owned by the actor. |
| POST | `/me/avatar/upload-url` | Request a short-lived avatar upload target. |
| POST | `/me/avatar/confirm` | Confirm an uploaded avatar object for the actor. |
| DELETE | `/me/avatar` | Remove the actor's avatar reference. |

Current-user endpoints must not expose another user's hidden profile fields,
device tokens, prayer logs, registration comments, or private contact data.
Prayer tracker data remains personal; admin endpoints must not read or show
`prayer_activity_logs`.

## `/events/*`

Event read endpoints may be public or member-aware. Anonymous callers see only
public published events. Active members may see member-only published events.
Draft, hidden, cancelled, and archived event states are visible only through
admin endpoints.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/events` | Public/member | List visible published events. |
| GET | `/events/{event_id}` | Public/member | Return one visible event. |
| GET | `/events/{event_id}/occurrences` | Public/member | List visible occurrences for one event. |
| GET | `/event-categories` | Public/member | List visible event categories. |
| GET | `/events/{event_id}/participation-options` | Public/member | List visible registration or donation options for one event. |
| GET | `/events/{event_id}/capacity-units` | Public/member | List visible capacity unit metadata needed for registration UI. |

Event list filters should use query parameters such as category, date range,
visibility, and pagination when implemented. Date filters use ISO 8601 with
timezone. Event ids, category ids, occurrence ids, option ids, and capacity unit
ids are UUID strings.

Event responses must not leak unpublished admin notes, hidden capacity internals
that are not needed by the client, or private registration data.

## `/registrations/*`

Registration endpoints require an authenticated user unless a later endpoint
explicitly documents a public pre-auth flow. Payment gateway integration is out
of scope during the backend migration.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/events/{event_id}/register` | Create or update the actor's registration for an event. |
| POST | `/registrations/{registration_id}/cancel` | Cancel a registration owned by the actor when cancellation is allowed. |
| GET | `/me/registrations` | List the actor's registrations; documented in `/me/*` because it is current-user scoped. |

Registration create and cancel requests should send `Idempotency-Key` so mobile
retries do not create duplicate registrations or duplicate state transitions.

The API must enforce capacity, occurrence capacity, option-to-capacity-unit
rules, and "donation options do not consume seats" server-side. Concurrent
requests that would exceed capacity return `capacity_unavailable`. Invalid
state transitions, such as cancelling an already rejected registration, return
`state_conflict` or a more specific documented code.

Registration responses may include current status, selected options,
occurrence, capacity result, and timestamps. They must not expose other users'
private registration data.

## `/admin/*`

Admin endpoints require `Authorization: Bearer <access_token>` and an active
role that allows the action. Unless an endpoint says otherwise, access is
limited to `admin` and `event_manager`, scoped to the actor's community.
Members without admin privileges receive `forbidden` or `not_found` according
to the resource visibility rule.

### Admin Events

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/events` | List events visible to the admin scope, including draft/hidden states. |
| POST | `/admin/events` | Create an event. |
| GET | `/admin/events/{event_id}` | Return one event in admin shape. |
| PATCH | `/admin/events/{event_id}` | Update editable event fields. |
| POST | `/admin/events/{event_id}/publish` | Publish an event. |
| POST | `/admin/events/{event_id}/archive` | Archive an event. |
| POST | `/admin/events/{event_id}/cancel` | Cancel an event. |
| GET | `/admin/event-categories` | List admin-manageable categories. |
| POST | `/admin/event-categories` | Create a category. |
| PATCH | `/admin/event-categories/{category_id}` | Update a category. |
| GET | `/admin/events/{event_id}/occurrences` | List event occurrences. |
| PUT | `/admin/events/{event_id}/occurrences` | Replace the occurrence set for an event. |
| GET | `/admin/events/{event_id}/participation-options` | List participation options. |
| PUT | `/admin/events/{event_id}/participation-options` | Replace participation options. |
| GET | `/admin/events/{event_id}/capacity-units` | List capacity units. |
| PUT | `/admin/events/{event_id}/capacity-units` | Replace capacity units. |

### Admin Registrations

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/events/{event_id}/registrations` | List registrations for an event in the actor's community. |
| GET | `/admin/events/{event_id}/registration-capacity` | Return capacity counts and availability for admin review. |
| POST | `/admin/registrations/{registration_id}/confirm` | Confirm a registration. |
| POST | `/admin/registrations/{registration_id}/reject` | Reject a registration. |
| POST | `/admin/registrations/{registration_id}/waitlist` | Move a registration to waitlist. |
| POST | `/admin/registrations/{registration_id}/attended` | Mark attended. |
| POST | `/admin/registrations/{registration_id}/no-show` | Mark no-show. |

Admin registration actions must be transactional and community-scoped. Excel
export remains a client/admin service concern until a later PR proves that a
separate export API is required.

### Admin Community, Members, And Invites

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| GET | `/admin/community` | admin/event_manager | Read current community settings needed by admin surfaces. |
| GET | `/admin/community-locations` | admin/event_manager | List community locations. |
| POST | `/admin/community-locations` | admin/event_manager | Create a community location. |
| PATCH | `/admin/community-locations/{location_id}` | admin/event_manager | Update a community location. |
| POST | `/admin/community-locations/{location_id}/archive` | admin/event_manager | Archive a community location. |
| GET | `/admin/members` | admin | List community members. |
| GET | `/admin/members/{user_id}` | admin | Read a member profile and membership shape. |
| GET | `/admin/members/{user_id}/registrations` | admin | Read the member's event registration history for the selected community. |
| PATCH | `/admin/members/{user_id}/profile` | admin | Update allowed profile fields. |
| PATCH | `/admin/members/{user_id}/membership` | admin | Update membership role/status fields. |
| POST | `/admin/invites` | admin | Create an invite and return the plaintext code once. |
| GET | `/admin/invites` | admin | List invite records without plaintext codes. |
| POST | `/admin/invites/{invite_id}/revoke` | admin | Revoke an invite. |

Admin member endpoints must not create auth users, set passwords, expose prayer
tracker data, or read `prayer_activity_logs`.

Invite endpoints may return a plaintext invite code once for display. The API
must store only a safe derived value and must not send invite emails unless a
later PR explicitly implements delivery.

### Admin Feedback, Privacy, And Push

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| POST | `/admin/feedback` | admin/event_manager | Submit admin beta feedback. |
| GET | `/admin/privacy/requests` | admin | List privacy requests for review. |
| PATCH | `/admin/privacy/requests/{request_id}` | admin | Update privacy request status or handling notes. |
| POST | `/admin/events/{event_id}/push-notifications` | admin/event_manager | Create an event push notification job when push is implemented. |
| GET | `/admin/push-jobs` | admin/event_manager | List push jobs scoped to the actor's community. |

Feedback and push endpoints must avoid raw sensitive values in logs. Push
delivery may involve Expo Push API as a delivery processor; production enablement
requires the privacy review described in the roadmap.

### Later Admin Groups

Seating, import review, and other admin surfaces will use the same envelope,
auth header, UUID, ISO date/time, pagination, validation, authorization, and
conflict conventions when their specific contracts are added.

## `/privacy/*`

Privacy endpoints are the user-facing contract for data-subject style requests.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/privacy/requests` | Public or authenticated | Create a privacy request. Authenticated callers are linked to the current user; public callers provide minimal contact context. |
| GET | `/privacy/requests` | Authenticated | List privacy requests owned by the current user. |

Privacy request creation should accept `Idempotency-Key` so retries do not
create duplicates. Public privacy requests must validate required contact
fields without logging raw personal data. Admin review uses
`/admin/privacy/requests`.

## Implementation Notes For Later PRs

- FastAPI route handlers should return the envelope consistently through shared
  response helpers when implementation starts.
- Pydantic schemas should encode the snake_case JSON contract directly or
  expose stable aliases.
- API client wrappers in mobile and web-admin should map these contracts to
  existing UI models and preserve Supabase fallback until the relevant provider
  flag is cut over.
- The API must remain the only layer with PostgreSQL credentials,
  authorization guards, and transactional write checks.
- Supabase migrations and RPC contracts remain historical/reference material
  until the removal/cutover PRs.

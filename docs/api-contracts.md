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

Temporary Level 3 migration testing may enable a backend-only Supabase JWT
bridge with `MIGRATION_ACCEPT_SUPABASE_JWT=true`. When enabled, protected API
dependencies first validate the normal API JWT. If that fails, the API may
validate a Supabase access JWT signature and expiry with backend-only
`SUPABASE_JWT_SECRET`, optionally enforcing configured issuer or audience, then
resolve `sub` to an existing `app_users.id` UUID in the API database. Unknown
or inactive users must receive a clean 401/403 response and must not be
auto-provisioned from JWT claims. The bridge is default-off, for local/staged
mixed-provider testing only, and must be disabled before final provider cutover
in PR 37.

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
| POST | `/auth/register` | Public | Create an API password user and profile. |
| POST | `/auth/login` | Public | Exchange email/password credentials for an access token and refresh session. |
| POST | `/auth/refresh` | Public/session | Rotate a refresh session and return a new access token. |
| POST | `/auth/logout` | Public/session | Revoke the submitted refresh session when present. |
| GET | `/auth/me` | Authenticated | Return the current API user, profile summary, and active memberships. |
| POST | `/auth/request-password-reset` | Public | Request password reset delivery. |
| POST | `/auth/confirm-password-reset` | Public | Confirm password reset code and set a new password. |
| POST | `/auth/request-email-verification` | Public | Request email verification delivery. |
| POST | `/auth/confirm-email-verification` | Public | Confirm email verification code. |
| POST | `/auth/request-set-password` | Public | Request set-password delivery for migrated OAuth-only users with no password hash. |
| POST | `/auth/confirm-set-password` | Public | Confirm set-password code and create the first password hash. |
| POST | `/auth/register-with-invite` | Public | Create an API password user from an invite and return auth tokens plus user/profile/membership summaries. |
| POST | `/auth/accept-invite` | Authenticated | Accept an invite for the current API user without creating a new user or rotating tokens. |

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

Register with invite request:

```json
{
  "invite_code": "<invite-code>",
  "email": "user@example.com",
  "password": "<new-password>",
  "profile": {
    "display_name": "Example User",
    "first_name": "Example",
    "last_name": "User",
    "full_name": "Example User",
    "city": "Moscow"
  }
}
```

Register with invite response:

```json
{
  "access_token": "jwt-access-token",
  "refresh_token": "refresh-token-returned-once",
  "token_type": "bearer",
  "expires_at": "2026-07-06T17:00:00Z",
  "user": {
    "id": "4c0f2e79-7e42-49e7-a8a3-72d83a8d02ac",
    "email": "user@example.com"
  },
  "profile": {
    "id": "8c4d1c91-9dc7-40fa-a2fd-678e72ddba99",
    "user_id": "4c0f2e79-7e42-49e7-a8a3-72d83a8d02ac",
    "community_id": "a8d77b34-f2a0-4cb8-8c7d-53b8f06a33aa"
  },
  "membership": {
    "id": "25a49640-9372-4567-89c2-2d7466ce681f",
    "community_id": "a8d77b34-f2a0-4cb8-8c7d-53b8f06a33aa",
    "role": "member",
    "status": "active"
  },
  "community": {
    "id": "a8d77b34-f2a0-4cb8-8c7d-53b8f06a33aa",
    "name": "Community name",
    "city": "Moscow",
    "slug": "community-slug"
  }
}
```

Accept invite request:

```json
{
  "invite_code": "<invite-code>"
}
```

Accept invite response:

```json
{
  "membership": {
    "id": "25a49640-9372-4567-89c2-2d7466ce681f",
    "community_id": "a8d77b34-f2a0-4cb8-8c7d-53b8f06a33aa",
    "role": "member",
    "status": "active"
  },
  "community": {
    "id": "a8d77b34-f2a0-4cb8-8c7d-53b8f06a33aa",
    "name": "Community name",
    "city": "Moscow",
    "slug": "community-slug"
  },
  "already_member": false
}
```

Invite acceptance validates that the invite status is `active`, the invite is
not expired, `used_count` is still below `max_uses`, the invite role is one of
the supported community membership roles, and the target community exists and
is active. The API hashes the plaintext invite code at the route boundary and
the service layer queries only `code_hash`. The invite row is locked before
validation and consumption so concurrent requests cannot overuse the same
invite. Successful consuming accepts increment `used_count`, set
`accepted_by`/`accepted_at` for the first successful consuming user when those
fields are empty, and mark the invite `used` when `used_count` reaches
`max_uses`.

Existing active membership acceptance is idempotent: the response returns the
current active membership with `already_member: true` and does not consume the
invite again. Existing pending membership is activated and consumes the invite.
Existing suspended or left membership is not reactivated in this MVP flow and
returns a conflict.

Stable invite flow errors:

| HTTP | Detail | Meaning |
| --- | --- | --- |
| 400 | `Invalid or expired invite code` | Invite code is unknown, expired, revoked, already used/exhausted, points to an inactive/missing community, or has an unsupported role. |
| 401 | `Authentication required` | `/auth/accept-invite` was called without a valid bearer access token. |
| 409 | `Email is already registered` | `/auth/register-with-invite` was called with an email already present in API auth. |
| 409 | `Membership cannot be accepted in its current state` | Existing membership is suspended, left, or otherwise not safely reactivatable by this MVP flow. |
| 409 | `Membership already exists` | A concurrent membership uniqueness race prevented creating the membership. |

Password reset, email verification, and set-password request bodies:

```json
{
  "email": "user@example.com"
}
```

Request responses are intentionally generic to avoid account enumeration:

```json
{
  "ok": true
}
```

The same success response is returned when the email is absent, inactive,
already verified, already password-capable, or otherwise unsuitable for the
requested flow. If a code is created, the API stores only `code_hash`, expiry,
and consumed metadata in the purpose-specific auth code table. The plaintext
code and generated link exist only while rendering the outbound auth email.
New requests invalidate older unconsumed codes for the same user and purpose.

Confirm password reset request:

```json
{
  "code": "one-time-reset-code",
  "new_password": "new-password"
}
```

Confirm email verification request:

```json
{
  "code": "one-time-verification-code"
}
```

Confirm set-password request:

```json
{
  "code": "one-time-set-password-code",
  "new_password": "new-password"
}
```

Confirm responses:

```json
{
  "ok": true
}
```

Confirmation validates the code hash, purpose, expiry, user status, and
one-time-use state. Code purpose is enforced by using separate storage tables
for password reset, email verification, and set-password codes. Successful
confirmation consumes all outstanding unconsumed codes for that user and
purpose.

Stable flow errors:

| HTTP | Detail | Meaning |
| --- | --- | --- |
| 400 | `Invalid or expired password reset code` | Reset code is missing, unknown, consumed, expired, wrong-purpose, or no longer usable. |
| 400 | `Invalid or expired email verification code` | Verification code is missing, unknown, consumed, expired, wrong-purpose, or no longer usable. |
| 400 | `Invalid or expired set-password code` | Set-password code is missing, unknown, consumed, expired, wrong-purpose, or no longer usable. |
| 409 | `Password is already set` | A valid set-password code was presented after the user already became password-capable. |
| 429 | `Too many auth email requests` | Request rate limit was exceeded for the auth email flow. |

Password reset requires an active user with an existing `password_hash`.
Set-password is only for active migrated OAuth-only users where
`password_hash` is `null`. Email verification sets `email_verified_at` when the
active user confirms a valid verification code. Raw emails, codes, tokens,
reset links, verification links, and set-password links must not be logged.

Expected auth errors include `validation_error`, `unauthenticated`,
`forbidden`, `rate_limited`, and `conflict`. Password reset, email
verification, and set-password are complete only after a valid confirmation;
request endpoints are generic acceptance responses and must not reveal whether
an email exists.

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

Implemented read behavior (PR 15): `GET /events` supports `limit`, `cursor`,
`category` (category slug), and `starts_after`/`starts_before` datetime filters
on `starts_at`. Both date filters are inclusive: `starts_after` matches
`starts_at >= starts_after` and `starts_before` matches
`starts_at <= starts_before`. Date filters without a timezone offset are
rejected with HTTP `422`; the error body currently uses the FastAPI default
`{"detail": ...}` shape, not yet the shared error envelope. Results are
ordered by `starts_at` plus `id`. Draft, hidden, cancelled, and archived
events return HTTP `404` through these endpoints, also currently with the
FastAPI default `{"detail": ...}` error body rather than the shared error
envelope. Sub-resource endpoints apply the parent event visibility gate first,
then return only `active` occurrences and `is_active = true` participation
options and capacity units. `GET /event-categories` returns `is_active = true`
categories ordered by `sort_order` and is bounded and unpaginated, as are the
per-event sub-resource lists. Migrating all API error responses onto the
shared error envelope with stable `code` values remains tracked as a later API
hardening item; the mobile API client also tolerates the current FastAPI
`detail` error shape during the mixed-provider event-read switch.

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

Implemented behavior (PR 17): these endpoints use `require_auth`, so normal
API JWTs and the temporary Supabase JWT bridge both resolve through the same
current-user dependency when the bridge is enabled. Success responses use the
shared envelope. Registration-specific service errors currently use FastAPI's
default error wrapper with a stable detail object:

```json
{
  "detail": {
    "code": "capacity_unavailable",
    "message": "No seats available for this event"
  }
}
```

`POST /events/{event_id}/register` accepts an optional JSON body:

```json
{
  "occurrence_id": "00000000-0000-0000-0000-000000000000",
  "seats_count": 1,
  "guest_names": [],
  "comment": "optional note",
  "option_selections": [
    {
      "option_id": "00000000-0000-0000-0000-000000000000",
      "quantity": 1
    }
  ]
}
```

For compatibility with the current mobile model, the request parser also
accepts camelCase aliases such as `occurrenceId`, `seatsCount`, `guestNames`,
`optionSelections`, and `optionId`. Responses remain snake_case.

The register endpoint only accepts visible `published` events: public events
or member-only events in a community where the actor has active membership.
Draft, hidden, cancelled, archived, missing, or unauthorized events return
`404 not_found` without revealing private event existence. `registration_mode`
must be `internal_free` or `internal_paid`; `none` and `external_link` return
`422 validation_error`.

Occurrence-aware events require `occurrence_id` for paid registrations,
option-based registrations, and recurring/non-single events. Legacy single
free event registration may omit `occurrence_id`; in that case capacity is
checked at the parent event level. Occurrences must belong to the event, have
`status = 'active'`, and be within their registration window when window
columns are set.

Duplicate active registrations are idempotent by user, event, and occurrence:
if the actor already has a `pending`, `confirmed`, or `waitlisted`
registration for the same target, the existing registration is returned.
Otherwise the API creates a new row in one transaction.

Capacity is enforced in the Python API transaction. The service locks the event
row, locks the selected occurrence row when present, locks selected
participation options, and locks mapped capacity-unit rows before checking and
creating reservations. Capacity-unit reservations use
`event_registration_capacity_reservations`; options without capacity-unit
mappings fall back to event/occurrence `seats_count` accounting. Donation
options and options with `counts_toward_capacity = false` do not add seats.
Capacity conflicts return `409 capacity_unavailable`.

For `internal_free`, confirmed registrations are created unless the effective
event/occurrence settings require approval, in which case status is `pending`.
For `internal_paid`, the API records selected option snapshots and returns a
`pending` registration with `payment_status = 'pending'`; no payment gateway or
production payment action is performed in PR 17.

`POST /registrations/{registration_id}/cancel` is scoped to the current user.
Missing registrations and registrations owned by another user return
`404 not_found`. `pending`, `confirmed`, and `waitlisted` registrations are
changed to `cancelled` transactionally; already-cancelled own registrations are
returned as-is. Rejected, attended, and no-show rows return
`409 state_conflict`. Capacity is released by excluding cancelled rows from
future capacity and reservation counts.

`GET /me/registrations` returns the actor's registrations for events visible
through the same public/member event visibility rule. The response is ordered
by `registered_at`, `created_at`, and `id` descending.

Registration response `data` includes:

- registration fields: `id`, `event_id`, `occurrence_id`, `user_id`, `status`,
  `seats_count`, `guest_names`, `comment`, registration/cancellation/payment
  timestamps and status fields;
- embedded `event` in the public `EventResponse` shape;
- embedded `occurrence` when present;
- `selected_options` snapshots with option title, type, quantity, price,
  currency, donation, and seat-count fields;
- `capacity_reservations` snapshots for mapped capacity units;
- `total_amount` and `total_currency` derived from selected options.

Registration endpoints must not expose another user's private registration
data and must not log raw JWTs, registration comments, guest names, names,
emails, or phone numbers. Idempotency-Key storage is still future work; PR 17
uses duplicate active registration detection instead of a persistent
idempotency table.

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

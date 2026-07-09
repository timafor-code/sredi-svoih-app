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

Duplicate-blocking registrations are idempotent by user, event, and occurrence:
if the actor already has a `pending`, `confirmed`, `waitlisted`, or `attended`
registration for the exact same target, the existing registration is returned.
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

Mobile API switch status (PR 18): when
`EXPO_PUBLIC_REGISTRATIONS_PROVIDER=api`, the mobile `registrationService`
calls these endpoints through the shared mobile `apiClient` and normalizes
snake_case API responses into the existing `EventRegistration` TypeScript
shape. Missing, invalid, or `supabase` provider values continue to use the
existing Supabase RPC/select path. Duplicate active registrations returned by
the API are normalized as successful responses rather than treated as client
errors.

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

Implemented behavior (PR 19): the Python API exposes the top-level admin event
endpoints listed above through `/admin/events`. They require authentication and
an active `admin` or `event_manager` membership. `GET /admin/events` returns
only events in communities the actor can manage and uses the same cursor
pagination envelope as public event lists (`limit`, `cursor`, `next_cursor`,
`has_more`). `GET /admin/events/{event_id}`, `PATCH`, and status actions scope
the lookup by manageable community and return `404 not_found` for missing or
cross-community events without revealing private existence.

`POST /admin/events` creates a manual event with `source_type = 'manual'`,
`manual_override = true`, and `created_by`/`updated_by` set to the actor. If the
actor manages exactly one community, `community_id` may be omitted and is
inferred; otherwise `community_id` is required and must be manageable by the
actor. `PATCH /admin/events/{event_id}` updates only event fields represented
by the event request schema and sets `updated_by`/`updated_at`. The publish,
archive, and cancel actions set `status` to `published`, `archived`, or
`cancelled`; publish also sets `published_at` when it was previously `null`.

Admin event request validation mirrors the current API schema constraints:
datetimes must be ISO 8601 values with timezone, `ends_at` must be `null` or
later than `starts_at`, enum values must match the event table checks,
`capacity` must be positive when present, and `price_amount` must be
non-negative. Event category slugs must already exist in the target community.
Admin event responses reuse public event fields and additionally include
`source_type`, `source_external_id`, `manual_override`, `created_by`, and
`updated_by`. Admin registration-management, seating, and import endpoints
remain future PR scope.

Implemented behavior (PR 20): the Python API exposes the admin category,
occurrence, participation-option, and capacity-unit endpoints listed above.
They require authentication and an active `admin` or `event_manager` membership,
reuse the PR 19 manageable-community scope, and verify event-scoped resources by
first looking up the parent event in one of the actor's manageable communities.
Missing or cross-community event resources return `404 not_found`; authenticated
actors with no manageable admin/event-manager role receive `403 forbidden`.

`GET /admin/event-categories` returns all categories in the actor's manageable
communities, including inactive categories, ordered by community, sort order,
creation time, and id. `POST /admin/event-categories` creates a category in a
manageable community; when the actor manages exactly one community,
`community_id` may be omitted and inferred. `PATCH /admin/event-categories/{category_id}`
updates category fields only when the category belongs to a manageable
community. Category slugs must match the database slug format and remain unique
per community.

Admin occurrence reads return all event occurrences, including inactive states,
with server-derived registration-window fields: `server_now`,
`is_registration_always_open`, `registration_state`, and
`registration_state_reason`. `PUT /admin/events/{event_id}/occurrences`
accepts:

```json
{
  "occurrences": [
    {
      "id": null,
      "title": "Session title",
      "starts_at": "2026-07-06T19:30:00+03:00",
      "ends_at": null,
      "timezone": "Europe/Moscow",
      "registration_opens_at": null,
      "registration_closes_at": null,
      "capacity": null,
      "waitlist_enabled": null,
      "requires_approval": null,
      "status": "active",
      "sort_order": 0
    }
  ]
}
```

The occurrence replace endpoint runs in one transaction. Existing occurrences
can be preserved by including their `id`; new rows use `id: null` or omit `id`;
omitted rows are deleted only when they have no registrations.

`GET /admin/events/{event_id}/participation-options` returns all event-level
participation options, including inactive options, with nested
`capacity_units` mappings. `PUT /admin/events/{event_id}/participation-options`
accepts:

```json
{
  "participation_options": [
    {
      "id": null,
      "title": "Adult",
      "description": null,
      "price_amount": 0,
      "price_currency": "RUB",
      "option_type": "participation",
      "seat_limit": null,
      "allow_quantity": false,
      "min_quantity": 1,
      "max_quantity": 1,
      "is_donation": false,
      "counts_toward_capacity": true,
      "group_key": null,
      "conflicts_with": [],
      "sort_order": 0,
      "is_active": true,
      "capacity_units": []
    }
  ]
}
```

The participation-option replace endpoint runs in one transaction and replaces
the full option set plus nested option-to-capacity-unit mappings. Existing
options can be preserved by including their `id`; omitted options are deleted.
Donation options and options with `counts_toward_capacity = false` cannot have
capacity-unit mappings.

`GET /admin/events/{event_id}/capacity-units` returns all event-level capacity
units, including inactive units. `PUT /admin/events/{event_id}/capacity-units`
accepts:

```json
{
  "capacity_units": [
    {
      "id": null,
      "key": "friday_dinner",
      "title": "Friday dinner",
      "description": null,
      "capacity": 80,
      "sort_order": 0,
      "is_active": true
    }
  ]
}
```

The capacity-unit replace endpoint runs in one transaction. Existing units can
be preserved by including their `id`; omitted units are deleted only when they
have no capacity reservations. Capacity units are event-level registration
capacity buckets. They are not seating assignments and must not be treated as
physical seats. The existing JSON field names `seat_limit` and
`seats_per_quantity` are legacy capacity counters used by the data model; they
do not introduce seating behavior.

Web-admin API switch status (PR 21): when
`VITE_ADMIN_EVENTS_PROVIDER=api`, the web-admin Events services call the Python
admin endpoints above through the shared admin API client and normalize
snake_case API responses into the existing camelCase admin domain types.
Missing, invalid, or `supabase` provider values continue to use the existing
Supabase services. `GET /admin/events` is followed through cursor pagination
until the current admin UI has the full event list it expects.

API mode preserves the existing Events UI function names for list/create/edit
flows, event categories, occurrences, participation options, and capacity
units. Existing status-action UI calls are routed to
`POST /admin/events/{event_id}/publish`, `/archive`, or `/cancel` when the
payload is a narrow status action; regular edits continue to use
`PATCH /admin/events/{event_id}`. The admin API does not currently expose event
hard-delete or category hard-delete endpoints, so the web-admin API provider
surfaces clear unavailable-operation errors instead of inventing client-only
delete semantics. The Supabase provider keeps the legacy delete RPC behavior.

Participation-option capacity mappings are bridged through the API's nested
`capacity_units` array on `PUT /admin/events/{event_id}/participation-options`
so the existing two-step admin UI behavior remains unchanged. Capacity units
remain registration capacity buckets, not seating.

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

Implemented behavior (PR 22): the Python API exposes the admin registration
endpoints listed above. All endpoints require authentication and an active
`admin` or `event_manager` membership in the event's community. Event and
registration lookups are scoped through the actor's manageable communities:
missing and cross-community ids return `404 not_found`, while authenticated
actors without any manageable admin/event-manager membership receive
`403 forbidden`.

`GET /admin/events/{event_id}/registrations` accepts `occurrence_id`,
`status`, `search`, `limit`, and `offset` query parameters. `status=all` or an
omitted status returns every status. The list response mirrors the current
web-admin registration row needs: registration ids, event and occurrence ids,
participant user id, display name, email, phone, status, seats, guest names,
comment, payment status/id, registration/confirmation/cancellation timestamps,
occurrence title/times, selected participation-option snapshots, total amount,
and created/updated timestamps. When `occurrence_id` is provided, the
occurrence must belong to the event and only that occurrence's registrations
are returned. When it is omitted, the endpoint returns event-scoped
registrations across the event.

`GET /admin/events/{event_id}/registration-capacity` accepts optional
`occurrence_id`. For capacity analytics, an omitted `occurrence_id` scopes to
parent-event registrations where `occurrence_id IS NULL`; an explicit
occurrence scopes to that occurrence only, so occurrence capacity remains
separate from parent event capacity. The response includes totals, status
counts, active people/seat counts, donation counts, per-capacity-unit buckets,
bucket aggregate metrics, option stats, and donation/non-capacity option stats.

Capacity buckets use `event_registration_capacity_reservations` as the primary
source of occupied seats. The API also applies the same read-only fallback as
the current Supabase admin analytics for legacy/test rows: active,
seat-taking option selections without matching reservation rows are expanded
through `event_participation_option_capacity_units`. Donation options and
options with `counts_toward_capacity = false` never create fallback seat
obligations. A single participation option may contribute seats to multiple
capacity units through its mappings. Capacity-unit-specific capacity overrides
the event/occurrence capacity; otherwise the bucket uses the scoped
event/occurrence capacity as an effective fallback.

The status action endpoints update one registration inside a transaction and
return the updated admin registration row. `confirm` sets status to
`confirmed` and sets `confirmed_at` if it was empty. `reject` sets status to
`rejected` and uses the existing `cancelled_at` timestamp column as the stored
rejection/cancellation timestamp. `waitlist` sets status to `waitlisted` and
clears cancellation timestamp state. `attended` and `no-show` set the
attendance status and clear `cancelled_at`. The existing model has no separate
attended/no-show timestamp columns.

PR 22 is backend-only. The web-admin Registrations page, Excel export,
seating, import, and frontend provider switch remain unchanged until later
PRs.

Web-admin API switch status (PR 23): when
`VITE_ADMIN_REGISTRATIONS_PROVIDER=api`, the web-admin Registrations page uses
the Python API endpoints above through the shared admin API client. Missing,
invalid, or `supabase` provider values keep the Supabase RPC provider as the
default/fallback. The page provider badge now reflects the active registrations
provider instead of a hardcoded Supabase RPC label.

The Registrations service facade keeps the existing UI-facing functions for
event summaries, paged registration rows, status actions, attendance actions,
capacity analytics, and Excel export. API responses are normalized from
snake_case into the existing camelCase admin registration and capacity domain
types, so `RegistrationsPage`, detail/table components, capacity buckets, and
Excel export keep their current data contracts. In API mode the visible action
set is limited to the endpoints implemented here: confirm, reject, waitlist,
attended, and no-show. Legacy pending/cancelled status actions remain available
only through the Supabase provider.

API-mode event cards are built from the existing admin event and registration
API data without a separate backend summary endpoint. Occurrence selection
continues to be required for events that have occurrences, and selected
`occurrence_id` values are forwarded to both registration listing and capacity
analytics calls. Excel export continues to use the same
`listEventRegistrations` path as the page instead of adding a dedicated export
endpoint.

### Admin Community, Members, And Invites

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| GET | `/admin/community` | admin/event_manager | Read current community settings needed by admin surfaces. |
| GET | `/admin/community-locations` | admin/event_manager | List community locations. |
| POST | `/admin/community-locations` | admin | Create a community location. |
| PATCH | `/admin/community-locations/{location_id}` | admin | Update a community location. |
| POST | `/admin/community-locations/{location_id}/archive` | admin | Archive a community location. |
| GET | `/admin/members` | admin | List community members. |
| GET | `/admin/members/{user_id}` | admin | Read a member profile and membership shape. |
| GET | `/admin/members/{user_id}/registrations` | admin | Read the member's event registration history for the selected community. |
| PATCH | `/admin/members/{user_id}/profile` | admin | Update allowed profile fields. |
| PATCH | `/admin/members/{user_id}/membership` | admin | Update membership role/status fields. |
| POST | `/admin/invites` | admin | Create an invite and return the plaintext code once. |
| GET | `/admin/invites` | admin | List invite records without plaintext codes. |
| POST | `/admin/invites/{invite_id}/revoke` | admin | Revoke an invite. |

Implemented behavior (PR 21B): `GET /admin/community` returns the existing
Settings read shape (`id`, `name`, `timezone`, `website_url`, `created_at`) for
the requested `community_id` after verifying an active `admin` or
`event_manager` membership. `GET /admin/community-locations` is filtered by the
required `community_id` query parameter. Admins see all locations; event
managers see only active locations.

Community location payloads use the real `community_event_locations` domain
shape: `id`, `community_id`, `title`, `address`, `is_default`, `is_active`,
`sort_order`, `created_at`, and `updated_at`. List ordering is `is_default`
descending, `sort_order` ascending, then `title` ascending. Location writes are
admin-only. When a create or update sets `is_default = true`, the API clears
`is_default` from other locations in the same community; archived locations are
set inactive and non-default. The API schema preserves the partial uniqueness
invariant for one default location per community.

Web-admin API switch status (PR 21B): when
`VITE_ADMIN_COMMUNITY_PROVIDER=api`, the existing community and
community-location services call the Python admin endpoints above through the
shared admin API client. Missing, invalid, or `supabase` provider values
continue to use the existing Supabase select/RPC implementation.

Implemented behavior (PR 24): the Python API exposes the admin members
endpoints listed above. This surface is backend-only until PR 25 switches the
web-admin Members page; no web-admin provider or UI changes ship with PR 24.

Web-admin API switch status (PR 25): when `VITE_ADMIN_MEMBERS_PROVIDER=api`,
the existing web-admin Members service facade (`listAdminUsers`,
`getAdminUserProfile`, `listAdminUserRegistrations`, `updateAdminUserProfile`,
`setAdminUserMembership`) calls the Python admin members endpoints above
through the shared admin API client and maps the snake_case responses to the
existing camelCase Members domain types. The profile update wrapper sends the
flat backend schema shape (`community_id` plus only the edited profile fields)
instead of the Supabase RPC nested `{ fields }` payload; unedited fields are
omitted so the backend partial-update semantics apply. Missing, invalid, or
`supabase` provider values keep the existing Supabase RPC implementation. Add
Member / invite creation is not switched in PR 25.

Admin members access is strictly admin-only:

- Every endpoint requires `Authorization: Bearer <token>` and an active
  `admin` membership in the community named by the required `community_id`
  query parameter (GET) or body field (PATCH).
- `event_manager` and `rabbi` receive `403 forbidden` for every admin members
  endpoint, including list/read/detail. `PROFILE_VIEWER_ROLES` and profile
  viewer permissions are not valid authorization for this surface and must not
  be reused here.
- Plain members and actors without an active membership in the selected
  community receive `403 forbidden`.
- Member reads and writes are scoped to the selected admin community. A target
  user is in scope when they have a membership row (any status) in that
  community, or when they have no active membership in any community
  (unaffiliated profiles, matching the existing Supabase admin members RPC
  scope). Users active only in other communities return `404 not_found`
  without leaking existence, so another-community admin cannot read or update
  them.

`GET /admin/members` accepts `community_id` (required), `search`, `role`
(`member`/`rabbi`/`event_manager`/`admin`/`all`), `membership_status`
(`pending`/`active`/`suspended`/`left`/`no_membership`/`all`), `limit`
(default 100, max 200), and `offset`. Rows mirror the current web-admin
Members list contract in snake_case: `user_id`, coalesced `display_name`,
name/contact/profile summary fields, `hebrew_birth_date`, `nusach`,
`onboarding_completed`, profile timestamps, membership fields
(`membership_id`, `community_id`, `membership_role`, `membership_status`,
`joined_at`, `invited_by`), and community-scoped registration counters
(`registrations_total`, `registrations_upcoming`, `registrations_past`,
`registrations_cancelled`, `last_registration_at`). Ordering matches the
existing RPC: active memberships first, then other membership rows, then
unaffiliated profiles, sorted by display name and profile creation time.

`GET /admin/members/{user_id}` returns the list row fields plus profile detail
(`profile_community_id`, `full_name`, `hebrew_name`, `birth_time_context`,
`tribe_status`, `marital_status`, `about`, visibility fields,
`notification_preferences`) and membership detail (`membership_community_id`,
`membership_created_at`).

`GET /admin/members/{user_id}/registrations` returns the member's registration
history scoped to events of the selected community only: event id/title,
occurrence id/title/times (falling back to event times when no occurrence),
registration status, seats, payment status, registration timestamps, and
selected participation-option snapshots. Registrations in other communities
are never returned.

`PATCH /admin/members/{user_id}/profile` updates only the safe profile fields
already used by the Members admin UI: `full_name`, `first_name`, `last_name`,
`display_name`, `hebrew_name`, `email`, `phone`, `city`, `birth_date`,
`hebrew_birth_date`, `birth_time_context`, `nusach`, `tribe_status`,
`marital_status`, `about`, and `onboarding_completed`. Unknown fields are
rejected, at least one profile field is required, and enum/length constraints
are validated strictly. The endpoint never touches `app_users` auth columns or
Supabase Auth.

`PATCH /admin/members/{user_id}/membership` takes `community_id`, `role`
(`member`/`rabbi`/`event_manager`/`admin`), and `status`
(`pending`/`active`/`suspended`/`left`), and upserts the membership row inside
the selected community in a transaction, mirroring the existing
`admin_set_user_membership` semantics: activation sets `joined_at` once and
re-activation keeps the original `joined_at`. Invalid role/status values are
rejected with `422 validation_error`. Unlike the Supabase RPC, the API also
applies the members scope rule to this write, so a user active only in another
community cannot be pulled in through this endpoint.

Privacy: admin members responses expose only app-user identity summary,
profile fields, membership fields for the selected community, and
community-scoped event registration history. The endpoints do not read or
expose `prayer_activity_logs` or any prayer tracker data.

Admin member endpoints must not create auth users, set passwords, expose prayer
tracker data, or read `prayer_activity_logs`.

Invite endpoints may return a plaintext invite code once for display. The API
must store only a safe derived value and must not send invite emails unless a
later PR explicitly implements delivery.

Implemented behavior (PR 26): the Python API exposes backend-only admin invite
management endpoints.

Web-admin API switch status (PR 27): when
`VITE_ADMIN_INVITES_PROVIDER=api`, the existing Add Member invite creation flow
calls `POST /admin/invites` through the shared admin API client, sends the
canonical snake_case request body (`community_id`, `role`, `email`, `phone`,
`max_uses`, `expires_at`), and maps the snake_case create response into the
existing camelCase `AdminCreatedInvite` UI type. The plaintext `code` is still
surfaced only through the existing one-time invite-code result UI and existing
copy-to-clipboard behavior. Missing, invalid, or `supabase` provider values
continue to use the existing Supabase `admin_create_invite` RPC fallback with
its unchanged payload behavior. PR 27 does not switch mobile invite acceptance
and does not add invite listing or revoke UI.

All admin invite endpoints require `Authorization: Bearer <token>` and an
active `admin` membership in the relevant community. `event_manager`, `rabbi`,
plain members, unauthenticated callers, and actors without an active admin
membership cannot create, list, or revoke invites.

Create invite request:

```json
{
  "community_id": "00000000-0000-0000-0000-000000000000",
  "role": "member",
  "email": "person@example.com",
  "phone": "+79990000000",
  "max_uses": 1,
  "expires_at": "2026-08-01T12:00:00Z"
}
```

`community_id` is required. `role` defaults to `member` and must be one of
`member`, `event_manager`, `admin`, or `rabbi`. `email`, `phone`, and
`expires_at` are optional; empty email/phone values are stored as `null`.
`max_uses` defaults to `1` and must be between `1` and `1000`.
`expires_at`, when provided, must be a future ISO 8601 timestamp with timezone.
CamelCase aliases (`communityId`, `maxUses`, `expiresAt`) are accepted for the
future admin UI switch, but the canonical API contract is snake_case.

Create invite response:

```json
{
  "data": {
    "invite_id": "00000000-0000-0000-0000-000000000000",
    "community_id": "00000000-0000-0000-0000-000000000000",
    "role": "member",
    "email": "person@example.com",
    "phone": "+79990000000",
    "max_uses": 1,
    "used_count": 0,
    "expires_at": "2026-08-01T12:00:00Z",
    "status": "active",
    "created_by": "00000000-0000-0000-0000-000000000000",
    "accepted_by": null,
    "accepted_at": null,
    "created_at": "2026-07-09T12:00:00Z",
    "code": "SS-ABCD-EFGH-JKLM"
  },
  "error": null,
  "meta": {
    "request_id": "00000000-0000-0000-0000-000000000000"
  }
}
```

The plaintext `code` is returned only in the create response. The API stores
only `code_hash`, generated with the same invite hashing helper used by
`/auth/register-with-invite` and `/auth/accept-invite`. The response never
includes `code_hash`.

`GET /admin/invites?community_id=...` lists invite records scoped to the
selected admin community, ordered newest first. It returns the same invite
metadata as create except it omits `code`. It does not implement pagination or
status filtering in PR 26.

`POST /admin/invites/{invite_id}/revoke` locks an invite scoped to one of the
actor's admin communities, sets `status` to `revoked`, and returns the invite
metadata without `code`. Because the existing invite auth flow accepts only
`active` invites, revoked invites cannot be used by
`/auth/register-with-invite` or `/auth/accept-invite`.

Admin invite creation writes only an invite row. It does not create users,
profiles, memberships, passwords, password reset codes, Supabase Auth users, or
email delivery jobs, and it does not send email automatically.

### Admin Seating

PR 28A creates the Python API-owned seating schema only. It does not add admin
seating endpoints, switch the web-admin seating provider, change mobile, change
registration capacity behavior, import Supabase data, or create seed seating
data.

The schema mirrors the existing seating domain contract while moving ownership
to the Python API database:

- `event_seating_layout_templates` stores reusable, community-scoped geometry
  templates. Template geometry is stored as the `snapshot` JSONB object used by
  the current seating contract, plus title/description and active/built-in
  metadata. Templates do not store guests, registration references, seats taken,
  or assignments.
- `event_seating_layouts` stores concrete layout instances scoped to
  `community_id`, `event_id`, optional `occurrence_id`, and `capacity_unit_id`.
  The schema enforces one layout per event/occurrence/capacity-unit slot,
  including the null-occurrence event slot. `capacity_limit_snapshot` is a
  display snapshot only and is not a source of truth for registration capacity.
- `event_seating_tables` and `event_seating_table_connections` store normalized
  layout geometry using stable `client_table_id` values compatible with the
  current seating canvas contract. Concrete layout geometry is kept in these
  rows rather than duplicated as a second layout-level JSONB blob.
- `event_seating_assignments` stores layout-specific guest/reserve placements.
  Assignments reference `event_registrations` and `app_users` only; they do not
  reference `auth.users` and are never copied from templates.

PR 28 adds backend-only admin seating endpoints. They require an authenticated
actor with `admin` or `event_manager` membership in the relevant community.
Actors without those roles receive `403`; event/layout/template/capacity
resources outside the actor's managed communities resolve as `404` without
leaking cross-community data.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/admin/seating/templates` | Lists active geometry-only templates in the actor's managed communities. |
| GET | `/admin/seating/templates/{template_id}` | Reads one active template scoped to the actor's community. |
| POST | `/admin/seating/templates/from-layout` | Creates a template from `layout_id` and `title`, copying only tables, connections, and canvas snapshot metadata. |
| DELETE | `/admin/seating/templates/{template_id}` | Soft-deletes a non-built-in template by setting `is_active=false`; layouts made from it are untouched. |
| GET | `/admin/seating/layout` | Reads one `event_id`/optional `occurrence_id`/`capacity_unit_id` layout envelope. Missing layouts return `{ layout: null, tables: [], connections: [], assignments: [] }`. |
| POST | `/admin/seating/layout/from-template` | Creates one concrete slot layout from a template, copying geometry only and no assignments. |
| PATCH | `/admin/seating/layout` | Upserts layout geometry for a slot and transactionally replaces tables/connections. Assignments are preserved. |
| PATCH | `/admin/seating/assignments` | Replaces only assignments for an existing scoped layout. |

Requests accept snake_case API names and the existing v15 seating payload names
where they overlap: `eventId`, `occurrenceId`, `capacityUnitId`, `customTables`,
`tableConnections`, `selectedTableId`, `seatingDone`, `activeTemplateId`,
`reserveIds`, `capacity`, `chairs`, and `pool`. The API response keeps
snake_case row fields so PR 29 can map them into the existing web-admin seating
types.

Template snapshots are geometry-only. Creating a template from a layout and
creating a layout from a template copy tables and table connections only; guests,
registrations, assignments, pools, reserves, and capacity limits are never
copied.

`PATCH /admin/seating/layout` validates stable non-empty table ids, positive
table width/height, supported table angles (`0`, `90`, `180`, `270`), supported
long-side seats (`2` or `3`), exactly one rabbi table, and connections that
reference tables in the same payload. It saves `template_id`, `seating_done`,
and a server-derived `capacity_limit_snapshot` display value, but never writes
back to `event_capacity_units.capacity`, `event_occurrences.capacity`,
`events.capacity`, registrations, or capacity reservations. Any `capacity`,
`chairs`, `pool`, or `reserveIds` fields in the layout payload are accepted for
v15 compatibility but are not capacity or assignment sources of truth.

`PATCH /admin/seating/assignments` validates reserve rows have no
`registration_id`, placed rows have unique `seat_key` values, present
`guest_index` values are non-negative and unique per registration in the
payload, and guest registrations belong to the same event/occurrence/capacity
unit through either a durable reservation row or an active option-to-capacity
mapping. It does not create registrations, change registration statuses, change
capacity reservations, change layout geometry, or copy assignments from
templates. `reserveIds` is accepted for v15 compatibility; reserves are saved
from `chairs[]`/`pool[]` entries with `type="reserve"`.

Web-admin API switch status (PR 29): when
`VITE_ADMIN_SEATING_PROVIDER=api`, the existing web-admin seating service
facade calls the Python admin seating endpoints above through the shared
browser-safe admin `apiClient`. Missing, invalid, or `supabase` provider values
continue to use the existing Supabase RPC fallback.

The API-mode wrapper maps snake_case template, layout, table, connection, and
assignment rows into the existing camelCase seating types used by the current
canvas and editor. Layout and assignment writes keep the existing v15 frontend
payload keys (`eventId`, `occurrenceId`, `capacityUnitId`, `layout`,
`customTables`, `tableConnections`, `selectedTableId`, `seatingDone`,
`activeTemplateId`, `reserveIds`, `capacity`, `chairs`, and `pool`) so the UI
contract does not change. The switch does not change seating geometry,
auto-seating, drag/drop, print behavior, registration capacity rules, or any
other admin provider. `capacity_limit_snapshot` remains display-only, layout
saves still do not mutate registration capacity, templates remain
geometry-only, and assignments are not copied from templates.

### Admin Import

PR 30A creates the Python API-owned website import schema only. It does not add
admin import endpoints, parser code, an import runner, web-admin provider
switching, mobile changes, Supabase Edge Function changes, Supabase RPC changes,
real import data, or seed import data.

The schema creates:

- `event_import_sources` for community-scoped website import source
  configuration. Sources reference `communities(id)` and optional audit users
  through `app_users(id)`, never `auth.users`. Source settings are stored as a
  JSONB object.
- `event_import_runs` for one import attempt against a source. Runs carry the
  denormalized `community_id` for fast scoping and enforce consistency with the
  source community. The default and only supported schema mode is
  `apply_review_only`; run status remains `started | success | failed`. Run
  summary, parser metadata, and debug metadata are JSONB objects.
- `event_import_items` for review-queue candidates written by a run. Items keep
  the parser/review payload in `raw_payload` JSONB. `importReview`,
  `importReview.dedupe`, and `importReview.imageMirror` remain inside
  `raw_payload`. Item status remains `new | linked | ignored | error`.

The schema keeps the existing import/review boundary from
`docs/admin-import-review.md`, `docs/website-events-importer.md`, and
`docs/admin-import-dedupe-contract.md`: dedupe state is JSON-only and is not
promoted into table status columns. There are no dedupe status columns, no
auto-publish fields, no publish-now mode, no scheduling/cron mode, and
`linked_event_id` is only a nullable reference to an existing event. The schema
does not create, update, publish, or auto-publish events.

Two partial unique indexes are intentionally narrow. One allows at most one
`started` run per source, matching the existing already-running guard. The
other allows one non-null `external_id` per run, preserving idempotent writes
inside a run without making `(source_id, external_id)` unique across runs.
Cross-run import review history remains allowed.

PR 30 implements backend-only Python API import endpoints on top of that schema:

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| POST | `/admin/import-runs` | admin/event_manager | Create one review-only website import run and write import items. |
| GET | `/admin/import-runs` | admin/event_manager | List recent import runs visible to the actor. |
| GET | `/admin/import-items` | admin/event_manager | List review queue items with `status`, `source_id`, `run_id`, `limit`, and `offset` filters. |
| GET | `/admin/import-items/{item_id}` | admin/event_manager | Read one import item with `raw_payload.importReview` preserved. |
| POST | `/admin/import-items/{item_id}/ignore` | admin/event_manager | Mark one scoped import item ignored and preserve review metadata. |
| POST | `/admin/import-items/{item_id}/publish` | admin/event_manager | Explicitly create or update one linked event from an import item. |

All admin import endpoints require `Authorization: Bearer <token>` and an active
`admin` or `event_manager` membership in the relevant community. Reads and
writes are scoped to the actor's manageable communities. Plain members,
unauthenticated callers, and actors from other communities cannot see or mutate
out-of-community import sources, runs, items, or linked events.

`POST /admin/import-runs` is synchronous in PR 30 and review-only. It creates a
`started` run, fetches the configured website source, writes
`event_import_items`, and then marks the run `success` or `failed`. It never
creates, updates, publishes, schedules, or auto-publishes events. If a source
already has a `started` run, the endpoint returns HTTP 409 `conflict`. The run
summary includes parser counts, item error counts, date-confidence counts, and
dedupe status counts. The schema `created_count` and `updated_count` remain
event-write counters and stay `0` during run creation.

Run creation accepts either an existing `source_id`, or a `community_id` with
optional source configuration (`source_url`, `source_key`, `source_title`).
When `source_id` is omitted, the API creates or updates the community-scoped
source row for the requested key before starting the run. Source settings store
parser metadata only; no frontend database URL, service-role key, Supabase
Admin API access, or Supabase Edge Function is used.

Import item responses return table status (`new | linked | ignored | error`)
and the stored `raw_payload` object. Dedupe remains JSON-only under
`raw_payload.importReview.dedupe`; dedupe states such as `duplicate`,
`possible_duplicate`, `linked_existing`, and `manual_override_skipped` are not
promoted to table status columns.

`POST /admin/import-items/{item_id}/ignore` sets `status = ignored`, preserves
`raw_payload.importReview`, and adds `raw_payload.adminReview` metadata with a
safe actor id, timestamp, and optional reason.

`POST /admin/import-items/{item_id}/publish` is the only PR 30 endpoint that
writes events. It is idempotent where practical: if the item is already linked,
the linked event is updated instead of creating a duplicate; otherwise the API
also checks for an existing `website_scrape` event with the same external id.
For new events, safe defaults are `status = draft`, `visibility = hidden`,
`source_type = website_scrape`, source URL/external id from the item when
available, and `manual_override = true`. A caller may explicitly request
`published`, `public`, or `members_only` values when normal event validation
allows them. Successful publish sets `event_import_items.linked_event_id` and
`status = linked`.

PR 30 does not switch the web-admin UI, add `adminImportApiService`, change
mobile, change Supabase migrations/RPC/RLS, use Supabase Edge Functions, add
scheduled imports, or mirror images. The next PR is
`feature/admin-import-api-switch`.

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

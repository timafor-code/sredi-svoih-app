# Backend Python Migration Roadmap

Source of truth: repository-root `plan.md`, version `2026-07-06 v2.7`.

This document is the canonical public roadmap for moving production runtime from
Supabase Cloud to a custom Python API and PostgreSQL backend. It is a roadmap
and guardrail document only. PR 1 does not change runtime code, schema, data, or
Supabase files.

## Core Decision

The backend migration stays in this repository. Do not create a separate
backend repository at the start of the migration.

Future backend location:

```text
apps/api
```

Reasons:

- The mobile app, web-admin, docs, and future backend are one product surface.
- Shared contracts and staged provider switches need one Git history.
- Small PRs can add the new backend next to the existing app without forcing a
  repository split.
- A separate backend repository can be considered later, after the API and
  release process stabilize.

## Replacement Map

| Current Supabase component | Target replacement |
| --- | --- |
| Supabase Auth | `app_users` and `auth_sessions` |
| Supabase RPC | FastAPI REST/JSON endpoints |
| RLS | Python authorization guards and transactional DB checks |
| Supabase migrations | Alembic |
| Supabase Storage | Russia-hosted object storage before cutover, unless explicitly excluded with owner sign-off |
| Supabase browser/mobile client usage | API client wrappers per app surface |

No production mobile or admin surface may connect directly to PostgreSQL.
`DATABASE_URL` is backend-only and must not be added to mobile, Expo env, Vite
env, `apps/admin`, or frontend code.

## Parallel Runtime Model

During migration, local Supabase remains active. The new Python API/PostgreSQL
contour will run next to it until each domain is switched and verified.

Old contour:

- Supabase local stack continues to serve current mobile and web-admin flows.
- Supabase Auth, RPC, RLS, local database, and reference migrations remain
  available while provider flags still point to Supabase.
- Supabase files and historical migrations are not deleted during the migration.

New contour:

- FastAPI backend under `apps/api`.
- Separate PostgreSQL database for the API.
- Alembic owns new API schema migrations.
- The API does not depend on Supabase Postgres internals.

Important boundary: do not reuse the Supabase Postgres container as the API
database, and do not stop/remove local Supabase until the relevant module has
been switched and verified.

### PR 3 local API contour

PR 3 creates only the local development contour for the future Python backend:

- `apps/api` contains the FastAPI scaffold.
- `infra/docker-compose.api.yml` runs `api_backend` and the separate
  `api_postgres` database.
- `GET /health` returns service status for local checks.
- `GET /version` returns local API version metadata.
- No mobile/admin service is switched from Supabase to the API.
- No Supabase migrations, RPC, RLS, or local Supabase runtime are changed.

Side-by-side local startup:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; supabase start
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml up -d
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
cd F:\2026\SS-App\code\sredi-svoih-app; curl http://127.0.0.1:8000/health
```

If the API container is not already running, Alembic can be run through a
temporary `api_backend` container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

Host Windows Python is not required for the PR 3 backend runtime. The API
target is Python 3.12+ inside the `api_backend` Docker container.

Local admin CORS note (PR 296 follow-up): the FastAPI app allows local browser
provider-switch smoke tests from the web-admin Vite dev server by default.
Allowed local origins are `http://localhost:5173`,
`http://127.0.0.1:5173`, `http://localhost:8081`, and
`http://127.0.0.1:8081`. Deployments can override the comma-separated backend
setting `API_CORS_ALLOWED_ORIGINS`; the local middleware allows
`Authorization` and `Content-Type` headers plus `GET`, `POST`, `PUT`, `PATCH`,
`DELETE`, and `OPTIONS`. This does not switch any frontend provider flags and
does not expose PostgreSQL directly to mobile or web-admin.

### PR 4 API core schema foundation

PR 4 adds the first Alembic-owned API schema and SQLAlchemy model foundation for
the product core tables:

- `app_users` is the technical login identity table for the new API database.
- `profiles` stores profile data and references `app_users(id)`.
- `community_memberships` stores community access and role state and references
  `app_users(id)`.
- Communities, invites, events, event occurrences, event categories,
  participation options, capacity units, registration rows, option snapshots,
  and capacity reservation rows are created in the separate API PostgreSQL
  database.

This PR does not migrate real data, add seed data, add API endpoints, switch
mobile/admin providers, create Supabase migrations, or add Supabase RLS/grants.
Invite codes remain hash-only in the schema, and `app_users.email` uses plain
text plus a partial unique index on `lower(email)` for non-null emails.

### PR 6 auth DB model

PR 6 adds database storage only for API auth sessions, email verification codes,
password reset codes, and set-password codes. Refresh tokens and all auth code
values are stored as hashes only. This PR does not add auth endpoints, email
delivery, invite registration, password hashing utilities, provider switches, or
real data imports.

### PR 7 auth security utilities

PR 7 adds backend-only password hashing, access-token, refresh-token, and
non-reversible token/code/IP/user-agent hashing helpers for the future Python
API. It does not enable API auth endpoints, login, registration, refresh,
logout, password reset, email verification, client switches, or production API
auth.

### PR 8 authorization guards

PR 8 adds Python authorization guard utilities for the future API endpoint
layer. The guards verify access tokens, load active `app_users`, check active
community memberships, and enforce community roles for admin, event-manager,
event, registration, and member-profile access decisions.

This PR does not expose auth, member, event, registration, admin, or other
business endpoints yet. It also does not add schema changes, provider switches,
real data imports, or access to private prayer-tracker tables.

### PR 9 password auth endpoints

PR 9 adds the first Python API password auth endpoints: registration, login,
refresh, logout, and current-user summary. Password login returns an access
token and opaque refresh token, refresh rotates the stored refresh-token hash,
logout revokes the submitted session when present, and `/auth/me` returns
`app_users`, profile, and active membership summaries without password,
refresh-token, token/code hash, registration comment, or prayer tracker data.

Admin and mobile production auth are not switched to the API in this PR. Invite
acceptance, OAuth, Apple Sign-In, SMS, email delivery, password reset,
set-password, and email verification flows remain out of scope for later PRs.

Local API ports:

```text
New Python API:       http://127.0.0.1:8000
New API Postgres:     localhost:55432
```

For Expo Go on an iPhone, use `http://<your-lan-ip>:8000` instead of
`http://127.0.0.1:8000`. FastAPI must listen on `0.0.0.0:8000` for LAN testing;
mobile/admin must still not connect directly to PostgreSQL.

## Data Residency

Production personal data must live in Russia-hosted PostgreSQL or
Russia-hosted object storage before production cutover. This includes app users,
profiles, memberships, registrations, invites, device tokens, prayer logs,
community contacts, contact visibility settings, avatars/photos, push jobs,
push deliveries, and seating assignments.

Western Supabase may remain only for synthetic dev, staging, or demo data.

Supabase Storage must be replaced by Russia-hosted object storage before
production cutover unless the owner explicitly signs off on an exclusion.

Expo Push caveat: device tokens may be stored in Russia, but if Expo Push API is
used for delivery, tokens and message payloads are transmitted to Expo as a
delivery processor. This must be reviewed before production push enablement.

## Auth And Cutover Boundaries

Supabase Auth is replaced by `app_users`, `auth_sessions`, JWT access tokens,
and refresh-token rotation. Production API auth must not be enabled until
OAuth-only users have an explicit migration path.

Email verification and password reset are not complete until there is a working
delivery path.

Plaintext passwords, plaintext refresh tokens, and plaintext invite codes must
never be stored.

Payment gateway implementation is out of scope during the backend migration.
Apple Sign-In is out of scope for the first backend migration wave.

### PR 9A auth migration inventory runbook

PR 9A is inventory and runbook only. It does not enable API auth, switch
`AUTH_PROVIDER`, implement set-password delivery, add OAuth/OIDC support, import
real data, add schema migrations, or change mobile/admin runtime code.

The local owner-run inventory script is:

```text
scripts/migration/auth_inventory.ps1
```

The script may read Supabase Auth metadata only under the repository
`scripts/migration/**` carve-out for controlled owner-run migration utilities.
It must report aggregate counts and mismatch summaries only. It must not print
raw Auth rows, OAuth provider payloads, plaintext tokens, password data,
plaintext invite codes, or raw credential material, and it must not write dumps
to disk.

Default use is local/dev only. Codex must not run this script, and nobody should
run it against production unless the project owner gives a separate explicit
command for that production run.

Required local environment variables:

```powershell
$env:AUTH_INVENTORY_DATABASE_URL = "<owner-local PostgreSQL connection URL>"
$env:AUTH_INVENTORY_RUN_ACK = "LOCAL_ONLY_COUNTS_ONLY"
```

Optional local environment variable:

```powershell
$env:AUTH_INVENTORY_PSQL_PATH = "<absolute path to psql.exe>"
```

Local/dev usage:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
.\scripts\migration\auth_inventory.ps1
```

If the owner gives a separate explicit command for a production inventory run,
the script still reads the connection string only from the owner's local shell
environment and requires the production override switch:

```powershell
.\scripts\migration\auth_inventory.ps1 -AllowProductionWithOwnerCommand
```

Expected output is a pipe-separated aggregate table:

```text
section | metric | value
--------|--------|------
auth_counts | total_supabase_auth_users | <count>
auth_counts | password_capable_users | <count>
auth_counts | encrypted_password_users | <count>
auth_counts | email_or_phone_identity_users | <count>
auth_counts | users_with_no_usable_email | <count>
oauth_counts | google_oauth_only_users | <count>
oauth_counts | apple_oauth_only_users | <count>
oauth_counts | mixed_password_and_oauth_users | <count>
mapping_signal | auth_users_missing_profile_uuid_match | <count>
profile_membership_mismatch | membership_rows_without_profile | <count>
limitations | future_api_app_users_not_checked | true
```

The exact metric list may include additional aggregate mismatch counters, but it
must remain counts/summaries only.

Safe first mapping signal:

- Current Supabase `public.profiles.id` and
  `public.community_memberships.user_id` are UUID links to Supabase Auth users.
- The future API schema uses `app_users.id`, `profiles.user_id`, and
  `community_memberships.user_id`.
- PR 9A inventory may therefore summarize whether existing Auth user UUIDs have
  matching profile and membership rows.
- The script cannot verify a future API `app_users` import because no real API
  import has run yet. It reports that limitation instead of guessing.
- The script does not infer usable email from OAuth provider payloads because
  those payloads must not be dumped or exposed in this runbook.

First-cutover policy:

- OAuth-only users receive a set-password migration path before production API
  auth cutover.
- While `AUTH_PROVIDER=api`, the Google sign-in button stays hidden or disabled
  until API-native Google OIDC is implemented.
- Apple Sign-In remains out of scope for the first backend migration wave.
- Production API auth remains blocked until OAuth-only users have a working,
  owner-approved migration path.

Owner sign-off checklist before API auth cutover:

- [ ] Owner reviewed the PR 9A runbook and inventory script.
- [ ] No real credentials, database URLs, service-role keys, auth dumps, OAuth
      provider payloads, plaintext tokens, or password data are committed.
- [ ] The script reads connection information only from owner-local environment
      variables.
- [ ] The script output is aggregate counts and mismatch summaries only.
- [ ] Any production inventory run was separately approved by the owner.
- [ ] OAuth-only user counts are reviewed and assigned to the set-password
      migration path.
- [ ] Users with no usable email have an owner-approved manual handling plan.
- [ ] Profile/membership mismatch counts are reviewed before import/cutover.
- [ ] API auth is still not enabled in admin or mobile.
- [ ] No schema or Alembic migration is added by PR 9A.

### PR 9B auth email delivery foundation

PR 9B adds only the backend email delivery foundation for future email
verification, password reset, and migrated OAuth-only set-password flows.

Backend-only settings live under `apps/api` and are read from environment
variables:

```text
API_EMAIL_ENABLED=false
API_EMAIL_FROM_ADDRESS=dev-null@example.invalid
API_EMAIL_FROM_NAME=Sredi Svoih
API_EMAIL_SMTP_HOST=
API_EMAIL_SMTP_PORT=587
API_EMAIL_SMTP_USERNAME=
API_EMAIL_SMTP_PASSWORD=
API_EMAIL_SMTP_STARTTLS=true
API_AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS=900
API_AUTH_EMAIL_RATE_LIMIT_MAX_ATTEMPTS=5
API_PUBLIC_APP_BASE_URL=http://localhost:8081
```

The default mode is disabled/local. When email sending is disabled, the backend
must not attempt an SMTP connection or require SMTP credentials. Real SMTP
credentials must stay in the owner's local or deployment environment only and
must not be committed.

PR 9B adds plain-text template renderers for:

- email verification;
- password reset;
- set-password for migrated OAuth-only users.

The renderers accept plaintext links or codes only as runtime inputs for
outbound email construction. Plaintext codes, tokens, reset links, verification
links, and set-password links must not be persisted, printed, or logged. Database
storage remains hash-only for auth codes.

Auth email rate limiting starts as an in-process API helper with configurable
window and attempt count. It is a local foundation for future endpoint use and
may be replaced by persistent or distributed rate limiting before production
scale requires it.

PR 9B does not add password reset, email verification, set-password, invite,
OAuth, Apple Sign-In, SMS, mobile, admin, schema, or Alembic changes. It does
not send real email during agent checks.

Manual owner fallback when SMTP is disabled:

1. Generate the plaintext code or token only inside the future auth flow that is
   about to send or display it to the owner.
2. Store only the hash in the API database.
3. Render the relevant email content with placeholders such as
   `<recipient-email>`, `<verification-link>`, `<verification-code>`,
   `<password-reset-link>`, `<password-reset-code>`,
   `<set-password-link>`, or `<set-password-code>`.
4. Send the message manually through an owner-controlled mailbox or support
   process.
5. Do not commit, paste into issue/PR text, log, screenshot, or otherwise retain
   the plaintext code, token, or link after the send step.

Fallback verification email body:

```text
Use the link or code below to verify your email address.

Verification link: <verification-link>
Verification code: <verification-code>

If you did not request this, you can ignore this email.
```

Fallback password reset email body:

```text
Use the link or code below to reset your password.

Password reset link: <password-reset-link>
Password reset code: <password-reset-code>

If you did not request this, you can ignore this email.
```

Fallback set-password email body:

```text
Use the link or code below to set a password for your migrated account.

Set-password link: <set-password-link>
Set-password code: <set-password-code>

If you did not request this, you can ignore this email.
```

### PR 9C password reset, email verification, and set-password flows

PR 9C implements the backend API flows for password reset, email verification,
and set-password for migrated OAuth-only users. It does not switch mobile or
web-admin auth defaults to the API and does not add Google OIDC, Apple Sign-In,
SMS, invite registration, or frontend UI changes.

Implemented endpoints:

```text
POST /auth/request-password-reset
POST /auth/confirm-password-reset
POST /auth/request-email-verification
POST /auth/confirm-email-verification
POST /auth/request-set-password
POST /auth/confirm-set-password
```

The request endpoints normalize email, apply the auth-email rate limiter, and
return the same `{ "ok": true }` response when an email is absent, inactive,
already verified, already password-capable, or otherwise not eligible for that
flow. This avoids account enumeration. If a user is eligible, the API generates
a high-entropy one-time code, stores only the HMAC code hash in the relevant
auth code table, invalidates older unconsumed codes for the same user and
purpose, and renders the plaintext code/link only for outbound email delivery.

The confirmation endpoints validate code hash, purpose, expiry, user status,
and one-time-use state. Password reset requires an active user that already has
a password hash. Set-password requires an active migrated OAuth-only user with
`password_hash = null`; confirmation is rejected if the user already has a
password. Email verification sets `email_verified_at` for the active user.
Successful confirmation consumes outstanding unconsumed codes for that user and
purpose.

Code expiry is controlled by backend-only `API_AUTH_CODE_TTL_MINUTES`, default
`30`. Email sending remains disabled by default through
`API_EMAIL_ENABLED=false`. The API still must not log raw emails, codes, tokens,
reset links, verification links, or set-password links.

Manual owner fallback when SMTP is disabled in PR 9C:

1. Prefer enabling a local owner-controlled SMTP or mail-catcher environment
   when testing end-to-end confirmation, because plaintext codes are not
   returned in API responses and are not stored in the database.
2. If a manual support send is required, handle the plaintext code/link only in
   the outbound email path, send it through an owner-controlled mailbox, and do
   not paste it into PRs, logs, screenshots, issue comments, or committed files.
3. After sending, discard the plaintext code/link. The database must contain
   only the hash and metadata needed to validate expiry and one-time use.

### PR 10 invite registration flow

PR 10 implements the backend API invite registration and acceptance flows:

```text
POST /auth/register-with-invite
POST /auth/accept-invite
```

`/auth/register-with-invite` is the public new-user path. It accepts a plaintext
invite code only at the API boundary, hashes it immediately, and the service
layer uses only `code_hash` for lookup. In one transaction it locks the invite,
validates status, expiry, remaining usage, supported membership role, and active
community, then creates the API `app_users` row, profile, active
`community_memberships` row, and refresh session. It increments `used_count`,
sets first-accept metadata when empty, marks the invite `used` when exhausted,
and returns access/refresh tokens with user, profile, membership, and community
summaries.

`/auth/accept-invite` is the authenticated existing-user path. It requires
`Authorization: Bearer <access_token>`, does not create a new `app_users` row,
and does not rotate tokens. It locks and validates the invite, creates an active
membership for the current user, or activates an existing pending membership.
An existing active membership is idempotent and does not consume the invite
again. Suspended or left memberships are intentionally not reactivated in this
MVP flow and return a conflict.

The invite flow does not create Supabase users, call Supabase Admin APIs, send
email or SMS, add admin invite creation UI, add mobile/web-admin UI, switch
mobile or admin auth defaults, or enable production API auth. Plaintext invite
codes, passwords, refresh tokens, and access tokens must not be stored or
logged.

### PR 14A temporary Supabase JWT bridge

PR 14A adds a temporary backend-only bridge for Level 3 mixed-provider testing.
It lets protected Python API dependencies accept a verified Supabase access JWT
only when `MIGRATION_ACCEPT_SUPABASE_JWT=true`; the default remains `false`.
Normal API JWT validation is still attempted first and remains unchanged when
the bridge is disabled.

Backend-only local settings:

```text
MIGRATION_ACCEPT_SUPABASE_JWT=false
SUPABASE_JWT_SECRET=
SUPABASE_JWT_ISSUER=
SUPABASE_JWT_AUDIENCE=
```

`SUPABASE_JWT_SECRET` is a placeholder only in committed examples and docs. The
real value must stay in the owner's local or deployment environment, never in
mobile, Expo public env, Vite env, `apps/admin`, committed env files, logs, or
PR text. Issuer and audience are optional checks: configure them only when the
local/staged Supabase token values are known and stable.

The bridge resolves the verified Supabase JWT `sub` as an API `app_users.id`
UUID. The API database must already contain UUID-aligned `app_users` rows, such
as the PR 5 dev-only seed mapping used for local protected smoke. Unknown
Supabase users are rejected with a clean 401/403 response and are never
auto-provisioned from claims.

Mobile and web-admin may keep auth provider set to Supabase while a selected
domain provider is set to API locally. In that mixed-provider mode, API client
wrappers send the current Supabase session access token as the bearer token for
API calls. When auth provider is API, wrappers continue to send API access
tokens from their API token stores.

The bridge must be removed or disabled before PR 37 final provider cutover.

### PR 15 event read endpoints

PR 15 implements the public/member event read endpoints in the Python API:

```text
GET /events
GET /events/{event_id}
GET /events/{event_id}/occurrences
GET /events/{event_id}/participation-options
GET /events/{event_id}/capacity-units
GET /event-categories
```

Success responses use the shared `{ "data": ..., "error": null, "meta": ... }`
response envelope from `docs/api-contracts.md`, with `meta.request_id` on every
success response and cursor pagination metadata on `GET /events`. Error
responses (`404`, `422`) currently return the FastAPI default
`{"detail": ...}` body, not the shared error envelope.

Authentication is optional. A new `get_optional_current_user` dependency in
`app/core/authorization.py` resolves the bearer token through the existing
`get_current_user` logic (API JWT first, then the PR 14A Supabase JWT bridge
when `MIGRATION_ACCEPT_SUPABASE_JWT=true`) and returns `null` instead of
raising when no or invalid credentials are provided.

Visibility rules:

- Anonymous callers see only events with `status = 'published'` and
  `visibility = 'public'`.
- Callers with an active community membership additionally see
  `status = 'published'` and `visibility = 'members_only'` events of their
  communities.
- Draft, hidden, cancelled, and archived events return `404` through these
  endpoints so their existence is not revealed.
- Occurrence, participation-option, and capacity-unit sub-resources apply the
  same visibility gate on the parent event first, then return only `active`
  occurrences and `is_active = true` options and capacity units.

`GET /events` orders by `starts_at` plus `id`, supports `limit` (default 50,
max 100), an opaque `cursor`, and optional `category`, `starts_after`, and
`starts_before` filters. Date filters must be ISO 8601 datetimes with timezone.
`GET /event-categories` returns `is_active = true` categories ordered by
`sort_order`.

Public payloads do not include admin-only internals such as
`created_by`/`updated_by`, `manual_override`, `source_type`, or
`source_external_id`. PR 15 adds no registration logic, no admin CRUD, no new
migrations, and no mobile or web-admin changes.

Known gaps / tech debt:

- Error responses are not yet wrapped in the shared error envelope; a global
  exception handler PR is still needed for API consistency.
- `meta.request_id` is generated per response in the Pydantic schema (`uuid4`
  default) and is not yet correlated with server logs or a request-scoped
  middleware id; correlation middleware is future work.

### PR 16 mobile events API switch

PR 16 connects mobile event reads to the Python API behind
`EXPO_PUBLIC_EVENTS_PROVIDER=api` while preserving Supabase as the default when
the flag is missing or set to `supabase`.

Implemented mobile read wrappers:

```text
GET /events
GET /events/{event_id}
GET /events/{event_id}/occurrences
GET /event-categories
```

The mobile facades keep the existing public function names:
`listPublishedEvents()`, `getEventById(id)`, `listEventOccurrences(eventId)`,
and `listEventCategories()`. API responses are mapped from the Python
snake_case payloads into the existing mobile `Event`, `EventOccurrence`, and
`EventCategory` shapes. Public payload fields that are absent because they are
admin-only are handled with safe client defaults.

API mode reuses the existing mobile `apiClient`. When mobile auth remains on
Supabase, the client sends the current Supabase access token as a bearer token
for member-aware event reads, relying on the temporary PR 14A Supabase JWT
bridge when it is enabled on the backend. If `EXPO_PUBLIC_EVENTS_PROVIDER=api`
is set without `EXPO_PUBLIC_API_URL`, the existing API client configuration
error is surfaced through the current mobile loading/error state.

This PR does not switch registration actions, does not add register/cancel API
calls, does not change `registrationService`, and does not change auth provider
defaults. Supabase remains the default/fallback event provider.

### PR 17 user registration API endpoints

PR 17 adds backend-only Python API registration endpoints:

```text
POST /events/{event_id}/register
POST /registrations/{registration_id}/cancel
GET /me/registrations
```

The endpoints require `Authorization: Bearer <token>` and use the existing
`require_auth` dependency, so normal API JWTs and the temporary PR 14A
Supabase JWT bridge both work for local mixed-provider smoke when the bridge
is explicitly enabled. All operations are scoped to the current authenticated
`app_users.id`.

Registration creation applies the same public/member event visibility rule as
the event read endpoints. Draft, hidden, cancelled, archived, missing, or
unauthorized events return `404` and are not exposed through registration
actions. Only `internal_free` and `internal_paid` events are accepted.

The service opens explicit transactions for mutating operations. It locks the
event row, selected occurrence row, selected participation options, and mapped
capacity-unit rows before checking duplicate-blocking registrations and
capacity. Capacity-unit reservations are written to
`event_registration_capacity_reservations`; unmapped options use legacy
event/occurrence seat accounting. Donation and non-capacity options do not add
capacity seats. Concurrent requests that would exceed capacity return
`capacity_unavailable`.

Registration responses keep snake_case API fields and include embedded event,
occurrence, selected option snapshots, capacity reservation snapshots, and
total amount/currency so the next mobile PR can map "my registrations" without
a separate per-registration lookup.

Cancellation is current-user scoped, only changes active
`pending`/`confirmed`/`waitlisted` rows to `cancelled`, and leaves
already-cancelled own rows idempotent. Capacity is released by excluding
cancelled rows from future seat and reservation counts.

PR 17 does not switch mobile `registrationService`, does not add
`registrationApiService`, does not change `EXPO_PUBLIC_REGISTRATIONS_PROVIDER`,
does not implement admin registration actions, seating, production payments,
or a payment gateway, and does not change mobile, web-admin, Supabase RPC, or
provider defaults. The next PR is
`feature/mobile-registration-api-switch`.

### PR 18 mobile registration API switch

PR 18 connects mobile event registration reads and writes to the Python API
behind `EXPO_PUBLIC_REGISTRATIONS_PROVIDER=api` while preserving Supabase as
the default when the flag is missing, invalid, or set to `supabase`.

Implemented mobile wrappers:

```text
POST /events/{event_id}/register
POST /registrations/{registration_id}/cancel
GET /me/registrations
```

The mobile facade keeps the existing exported registration functions:
`registerForEvent()`, `registerForPaidEventSimulated()`,
`registerForEventOccurrenceWithOptions()`, `loadMyRegistrations()`, and
`cancelRegistration()`. API responses are mapped from the Python snake_case
payloads into the existing mobile `EventRegistration` shape, including embedded
event and occurrence data, selected option snapshots, seat counts, guest names,
comments, total amount/currency, payment status, and cancellation timestamps.

API mode reuses the existing mobile `apiClient`. When mobile auth remains on
Supabase, the client sends the current Supabase access token as a bearer token
for registration calls, relying on the temporary PR 14A Supabase JWT bridge
when it is explicitly enabled on the backend. Duplicate active registrations
returned by the API are treated as successful idempotent responses.

This PR does not switch web-admin registration services, does not change admin
registration UI, does not implement seating or a payment gateway, does not
change Python endpoints, Supabase RPC/RLS/migrations, auth provider defaults,
or production provider defaults.

### PR 19 admin event CRUD endpoints

PR 19 starts Phase 4 by adding backend-only Python API endpoints for admin
event CRUD and status transitions:

```text
GET /admin/events
POST /admin/events
GET /admin/events/{event_id}
PATCH /admin/events/{event_id}
POST /admin/events/{event_id}/publish
POST /admin/events/{event_id}/archive
POST /admin/events/{event_id}/cancel
```

The endpoints require `Authorization: Bearer <token>` and an active
`admin` or `event_manager` community membership. Reads and mutations are scoped
to the actor's manageable communities. Cross-community event lookups return a
safe `404 not_found`, while authenticated users with no manageable community
role receive `403 forbidden`.

`POST /admin/events` creates a manual event in a manageable community. If the
actor manages exactly one community, the API may infer `community_id`; actors
with multiple manageable communities must provide one. The service validates
timezone-aware event datetimes, `ends_at > starts_at`, event enum fields,
capacity and price constraints, and category membership in the target
community. Created and updated events set audit fields from the actor, and
publish/archive/cancel update status fields transactionally.

This PR does not implement import, seating, admin registration management,
admin category/occurrence/participation-option/capacity-unit endpoints, mobile
screens, web-admin screens, provider switches, production data migration, or
payment gateway behavior. The web-admin continues to use the existing Supabase
fallback services until a later switch PR.

### PR 20 admin category, occurrence, option, and capacity endpoints

PR 20 adds the next backend-only Python API admin event-management endpoints:

```text
GET /admin/event-categories
POST /admin/event-categories
PATCH /admin/event-categories/{category_id}
GET /admin/events/{event_id}/occurrences
PUT /admin/events/{event_id}/occurrences
GET /admin/events/{event_id}/participation-options
PUT /admin/events/{event_id}/participation-options
GET /admin/events/{event_id}/capacity-units
PUT /admin/events/{event_id}/capacity-units
```

All endpoints require `Authorization: Bearer <token>` and an active `admin` or
`event_manager` community membership. Category operations are limited to the
actor's manageable communities. Event-scoped operations first verify that the
parent event belongs to one of those manageable communities, then read or write
only rows under that event.

The replace-style `PUT` endpoints run in API transactions. Occurrence replace
keeps rows whose `id` is included, inserts rows without an `id`, and blocks
deleting an occurrence that already has registrations. Participation-option
replace keeps rows whose `id` is included, inserts rows without an `id`, deletes
omitted options, and replaces nested option-to-capacity-unit mappings in the
same request. Capacity-unit replace keeps rows whose `id` is included, inserts
rows without an `id`, and blocks deleting a capacity unit that already has
capacity reservations.

Admin occurrence responses include server-derived registration-window fields
for the existing admin badges: `server_now`, `is_registration_always_open`,
`registration_state`, and `registration_state_reason`.

Capacity units remain event-level registration capacity buckets. They are not
seating assignments and do not implement physical seating. Existing field names
such as `seat_limit` and `seats_per_quantity` stay in the API shape because
they mirror the current data model, but this PR does not implement seating.

This PR does not switch the web-admin Events UI or mobile admin event surfaces
to the API, does not add admin registration-management endpoints, does not add
seating, import, payment gateway behavior, Supabase RPC/RLS/migration changes,
or frontend service changes. The next PR is
`feature/admin-events-api-switch`.

### PR 21 admin Events API switch

PR 21 connects the web-admin Events service layer to the Python API behind
`VITE_ADMIN_EVENTS_PROVIDER=api` while preserving Supabase as the default when
the flag is missing, invalid, or set to `supabase`.

Implemented web-admin wrappers:

```text
GET /admin/events
POST /admin/events
PATCH /admin/events/{event_id}
POST /admin/events/{event_id}/publish
POST /admin/events/{event_id}/archive
POST /admin/events/{event_id}/cancel
GET /admin/event-categories
POST /admin/event-categories
PATCH /admin/event-categories/{category_id}
GET /admin/events/{event_id}/occurrences
PUT /admin/events/{event_id}/occurrences
GET /admin/events/{event_id}/participation-options
PUT /admin/events/{event_id}/participation-options
GET /admin/events/{event_id}/capacity-units
PUT /admin/events/{event_id}/capacity-units
```

The existing admin facade function names remain in place, so Events list,
create/edit, category management, the occurrence constructor, participation
options, and capacity units keep the same UI behavior. API responses are
normalized from snake_case into the current camelCase TypeScript domain types,
and admin mutation inputs are sent to the API in snake_case. `GET /admin/events`
follows cursor pagination until the admin list has all pages.

API mode reuses the existing admin API client. When `VITE_AUTH_PROVIDER=api`,
requests use the stored API access token. When admin auth remains on Supabase
and `VITE_ADMIN_EVENTS_PROVIDER=api`, the client sends the current Supabase
access token for the temporary PR 14A Supabase JWT bridge.

The Python API does not expose event hard-delete or category hard-delete
endpoints in PR 21. In API provider mode those legacy delete actions surface a
clear unavailable-operation error instead of inventing a client-side delete.
Switching the provider back to Supabase keeps the existing Supabase RPC delete
behavior.

This PR does not switch Registrations, Members, Invites, Seating, Import,
Feedback, Community/settings, mobile admin event surfaces, Supabase RPC/RLS, or
Supabase migrations. Admin registration-management endpoints remain future PR
scope. The next PR is `feature/mobile-admin-events-api-switch`.

### PR 21B admin Community and locations API switch

PR 21B adds Python API coverage for the web-admin Settings community read
surface and the event-location dictionary:

```text
GET /admin/community?community_id=...
GET /admin/community-locations?community_id=...
POST /admin/community-locations
PATCH /admin/community-locations/{location_id}
POST /admin/community-locations/{location_id}/archive
```

The API schema includes the real `community_event_locations` table. Reads
require an active `admin` or `event_manager` membership; event managers receive
only active locations. Location create, update, and archive require an active
`admin` membership. The service preserves the existing invariant that at most
one location per community is default, and archiving sets both
`is_active = false` and `is_default = false`.

Web-admin community and community-location facades switch to these endpoints
only when `VITE_ADMIN_COMMUNITY_PROVIDER=api`. Missing, invalid, or `supabase`
provider values keep the existing Supabase select/RPC behavior. This PR does
not switch Registrations, Members, Invites, Seating, Import, Feedback, mobile
surfaces, Supabase RPC/RLS, or community editing beyond the existing Settings
read surface.

### PR 22 admin registration management endpoints

PR 22 adds backend-only Python API coverage for admin registration management:

```text
GET /admin/events/{event_id}/registrations
GET /admin/events/{event_id}/registration-capacity
POST /admin/registrations/{registration_id}/confirm
POST /admin/registrations/{registration_id}/reject
POST /admin/registrations/{registration_id}/waitlist
POST /admin/registrations/{registration_id}/attended
POST /admin/registrations/{registration_id}/no-show
```

The endpoints require `Authorization: Bearer <token>` and an active `admin` or
`event_manager` community membership. Event and registration reads/actions are
scoped to communities the actor can manage. Cross-community ids return safe
`404 not_found` responses, and actors without a manageable admin/event-manager
membership receive `403 forbidden`.

`GET /admin/events/{event_id}/registrations` supports the current web-admin
Registrations page data needs without switching the frontend provider:
event-scoped listing, optional `occurrence_id` filtering, status/search
filters, limit/offset paging, participant profile/contact summary fields,
guest names, comments, payment fields, selected participation-option snapshots,
occurrence labels/times, total amount, and the registration timestamp fields
present in the current model.

`GET /admin/events/{event_id}/registration-capacity` returns scoped capacity
analytics for parent event registrations or a selected occurrence. Capacity
units are registration capacity buckets, not seating. Occupied seats use
`event_registration_capacity_reservations` first, then a read-only fallback for
active seat-taking option selections that have capacity-unit mappings but no
reservation rows. Donation and non-capacity options do not consume seats, and a
single option may contribute to multiple capacity units through its mappings.
Occurrence capacity remains separate from parent event capacity.

Registration status and attendance actions run in API transactions and update
the existing status/timestamp columns. The model does not add separate
attended/no-show timestamps. PR 22 adds no database schema, does not touch
Supabase Auth, does not implement seating/import/payment gateway behavior, and
does not switch the web-admin Registrations page, Excel export, or any mobile
surface to the API.

### PR 23 admin Registrations API switch

PR 23 connects the existing web-admin Registrations page to the Python API
behind `VITE_ADMIN_REGISTRATIONS_PROVIDER=api` while preserving Supabase RPC as
the default when the flag is missing, invalid, or set to `supabase`.

Implemented web-admin wrappers:

```text
GET /admin/events/{event_id}/registrations
GET /admin/events/{event_id}/registration-capacity
POST /admin/registrations/{registration_id}/confirm
POST /admin/registrations/{registration_id}/reject
POST /admin/registrations/{registration_id}/waitlist
POST /admin/registrations/{registration_id}/attended
POST /admin/registrations/{registration_id}/no-show
```

The existing Registrations facade names remain in place:
`listRegistrationEvents`, `listEventRegistrations`,
`updateRegistrationStatus`, `markRegistrationAttendance`, and
`getAdminRegistrationCapacityAnalytics`. API responses are normalized from the
snake_case API contract into the existing camelCase admin registration and
capacity types used by the page, table, detail modal, capacity buckets, and
Excel export.

API mode builds registration event cards from existing admin event,
occurrence, and registration API data, so no new backend summary endpoint is
added in this PR. `occurrence_id` is forwarded to registration and capacity
requests when an occurrence is selected, and events with occurrences still
require an occurrence selection before showing registrations or capacity.
Excel export continues to use `listEventRegistrations` transitively instead of
a dedicated export endpoint.

The Registrations page occurrence dropdown uses the registration-provider-aware
facade `listRegistrationEventOccurrences`. When
`VITE_ADMIN_REGISTRATIONS_PROVIDER=api` it loads occurrences from
`GET /admin/events/{event_id}/occurrences` regardless of
`VITE_ADMIN_EVENTS_PROVIDER`, so the page never mixes API registration data
with Supabase occurrence IDs. When the registrations provider is missing or
`supabase`, it delegates to the existing events-provider occurrence service
unchanged. The Events page occurrence constructor stays controlled by
`VITE_ADMIN_EVENTS_PROVIDER` only.

The Registrations header badge now reflects the real active provider. API mode
shows only the actions supported by PR 22/PR 23 endpoints: confirm, reject,
waitlist, attended, and no-show. Supabase mode keeps the existing legacy action
set, including pending and cancelled. This PR does not switch Seating, Members,
Invites, Import, Feedback, mobile, Supabase Auth, or production provider
defaults. The next PR is `feature/api-admin-members-endpoints`.

### PR 24 admin members management endpoints

PR 24 adds backend-only Python API coverage for the web-admin Members surface:

```text
GET /admin/members
GET /admin/members/{user_id}
GET /admin/members/{user_id}/registrations
PATCH /admin/members/{user_id}/profile
PATCH /admin/members/{user_id}/membership
```

Access is strictly admin-only. Every endpoint requires
`Authorization: Bearer <token>` plus an active `admin` membership in the
community named by the required `community_id` query/body field.
`event_manager` and `rabbi` receive `403 forbidden` for every admin members
endpoint, including list/read/detail. `PROFILE_VIEWER_ROLES` and the profile
viewer permission model are intentionally not used for this surface. Member
reads and writes are scoped to the selected admin community: targets with a
membership row in that community (any status) or with no active membership
anywhere are in scope, while users active only in other communities return a
non-leaking `404 not_found`.

The list endpoint supports the current Members page filters (`search`, `role`,
`membership_status` including `no_membership`, limit/offset paging) and returns
the existing list-row contract in snake_case, including membership fields and
community-scoped registration counters. The detail endpoint adds profile and
membership detail; the registrations endpoint returns the member's
registration history for the selected community only, reusing the admin
registration selected-option snapshot shape.

Profile updates accept only the safe profile fields already edited by the
Members admin UI and validate them strictly. Membership updates upsert
role/status inside the selected community in a transaction with the existing
`joined_at` semantics. PR 24 does not create auth users, does not change
passwords, does not touch `auth.users` or the Supabase Admin API, does not
implement invite creation, and does not read or expose `prayer_activity_logs`
or any prayer tracker data. No database schema changes are added.

PR 24 is backend-only: the web-admin Members page, its Supabase RPC provider,
mobile, invites, seating, and import/feedback/prayer/contacts surfaces remain
unchanged. The next PR is `feature/admin-members-api-switch` (PR 25), which
will switch the web-admin Members page to these endpoints behind a provider
flag.

### PR 25 admin Members API switch

PR 25 connects the existing web-admin Members page to the Python API behind
`VITE_ADMIN_MEMBERS_PROVIDER=api` while preserving Supabase RPC as the default
when the flag is missing, invalid, or set to `supabase`.

Implemented web-admin wrappers:

```text
GET /admin/members
GET /admin/members/{user_id}
GET /admin/members/{user_id}/registrations
PATCH /admin/members/{user_id}/profile
PATCH /admin/members/{user_id}/membership
```

The existing Members facade names remain in place: `listAdminUsers`,
`getAdminUserProfile`, `listAdminUserRegistrations`, `updateAdminUserProfile`,
and `setAdminUserMembership`. API responses are normalized from the snake_case
API contract into the existing camelCase admin members types used by the page,
filters, drawer, profile edit flow, membership actions, and registration
history view. The list wrapper forwards `community_id`, `search`, `role`,
`membership_status` (including `no_membership`), `limit`, and `offset`; `all`
filter values are omitted from the query.

The profile update wrapper sends the backend schema shape — `community_id`
plus only the edited profile fields in snake_case — instead of the Supabase
RPC nested `{ fields }` payload. Fields that were not edited are omitted, so
the backend `exclude_unset` partial-update semantics apply. The membership
wrapper PATCHes `community_id`, `role`, and `status` and keeps the facade's
void return contract.

The Members page header shows the provider-aware badge following the existing
Events/Registrations pattern, and the header/toolbar/list-source copy reflects
the active provider. The Members page UI, filters, drawer, profile edit flow,
membership actions, and registration history view are otherwise unchanged.
Add Member / invite creation is not switched and continues to use the existing
Supabase invite service. PR 25 does not switch Registrations, Events, Seating,
Import, Feedback, Community, auth defaults, or mobile. The next PR is
`feature/api-admin-invites-endpoints` (PR 26).

### PR 26 admin invite management endpoints

PR 26 implements backend-only Python API invite management:

```text
POST /admin/invites
GET /admin/invites
POST /admin/invites/{invite_id}/revoke
```

All endpoints require `Authorization: Bearer <token>` and active `admin`
membership in the relevant community. Create and list use the required
`community_id` request field/query parameter; revoke scopes the path
`invite_id` to the actor's admin communities. `event_manager`, `rabbi`, plain
members, and actors outside the community cannot manage invites.

`POST /admin/invites` creates a row in the existing Python API `invites` table.
The request supports the same invite management fields needed by the current
Add Member invite flow: `community_id`, `role`
(`member`/`event_manager`/`admin`/`rabbi`), optional `email`, optional `phone`,
`max_uses` defaulting to `1`, and optional future `expires_at`. The API
generates an `SS-XXXX-XXXX-XXXX` invite code, hashes it with the existing
Python invite hashing helper used by `/auth/register-with-invite` and
`/auth/accept-invite`, stores only `code_hash`, and returns the plaintext
`code` exactly once in the create response.

`GET /admin/invites` lists invite metadata for the selected admin community
without plaintext invite codes and without exposing `code_hash`. PR 26 does not
add pagination, status filtering, or status repair. `POST
/admin/invites/{invite_id}/revoke` marks the scoped invite `revoked`; the
existing invite auth flow already rejects non-`active` invites, so revoked
invites cannot be accepted.

PR 26 does not create users, profiles, memberships, passwords, password reset
codes, Supabase Auth users, or email delivery jobs. It does not send email
automatically, does not switch the web-admin invite UI, does not change the Add
Member dialog, does not change mobile invite acceptance, does not remove
Supabase services, and does not add a migration because the existing Python API
schema already contains the `invites` model/table. The next PR is
`feature/admin-invites-api-switch` (PR 27).

### PR 27 web-admin invite creation API switch

PR 27 switches only the existing web-admin Add Member invite creation path
behind `VITE_ADMIN_INVITES_PROVIDER=api`. The Add Member dialog continues to
call the provider-aware `createAdminInvite` facade; in API mode the facade uses
the shared admin `apiClient` to call `POST /admin/invites`, sends the backend
snake_case payload (`community_id`, `role`, `email`, `phone`, `max_uses`,
`expires_at`), and maps the snake_case create response back to the existing
camelCase `AdminCreatedInvite` shape used by the UI.

The one-time plaintext invite code UI and copy-to-clipboard behavior are
unchanged. Missing, invalid, or `supabase` provider values keep the existing
Supabase `admin_create_invite` RPC fallback and its existing payload behavior.

PR 27 does not create users, set passwords, send email, change
`/auth/register-with-invite` or `/auth/accept-invite`, switch mobile invite
acceptance, add invite list or revoke UI, change backend invite endpoints, add
migrations, remove Supabase services, or switch Events, Registrations, Seating,
Import, Feedback, Community, or mobile surfaces. The next PR is
`feature/api-seating-schema-alembic`.

### PR 28A API seating schema

PR 28A adds the Python API Alembic/SQLAlchemy schema for seating before any
seating endpoints are implemented. It creates the API-owned
`event_seating_layout_templates`, `event_seating_layouts`,
`event_seating_tables`, `event_seating_table_connections`, and
`event_seating_assignments` tables.

The schema preserves the current seating domain boundaries: templates are
community-scoped geometry-only records, concrete layouts are scoped to an
event/optional occurrence/capacity unit slot, and assignments are stored only
on layout instances. Template geometry uses the existing `snapshot` JSONB
contract, while concrete layout geometry is normalized into table and
connection rows. Assignments are never copied from templates.

All user references point to `app_users(id)`, not `auth.users`, and the schema
does not introduce Supabase Admin API usage, service-role keys, direct
PostgreSQL access for mobile/admin, real seating seed data, or Supabase data
imports. `capacity_limit_snapshot` is stored only as a non-authoritative
display snapshot; registration capacity remains owned by the existing event,
occurrence, capacity-unit, registration, and capacity-reservation tables.

PR 28A does not implement seating endpoints, endpoint authorization, provider
switching, admin seating UI changes, mobile changes, registration service
changes, or capacity bucket behavior changes. The next PR is
`feature/api-seating-endpoints`.

### PR 28 API seating endpoints

PR 28 implements backend-only FastAPI admin seating endpoints on top of the
PR 28A schema:

- `GET /admin/seating/templates`
- `GET /admin/seating/templates/{template_id}`
- `POST /admin/seating/templates/from-layout`
- `DELETE /admin/seating/templates/{template_id}`
- `GET /admin/seating/layout`
- `POST /admin/seating/layout/from-template`
- `PATCH /admin/seating/layout`
- `PATCH /admin/seating/assignments`

All endpoints require the actor to be an `admin` or `event_manager` in the
relevant community. Requests are scoped to the actor's manageable communities;
actors without any admin/event-manager community receive `403`, while
out-of-community events, templates, layouts, occurrences, and capacity units are
reported as `404`.

Templates remain geometry-only. Saving a template from a layout copies tables,
table connections, and canvas snapshot metadata only. Creating a concrete
layout from a template copies the same geometry only and never copies
assignments, pools, reserves, registrations, guests, or registration capacity.

`PATCH /admin/seating/layout` is the geometry save path. It accepts the current
v15 seating payload keys and snake_case equivalents, validates table ids,
dimensions, angles, long-side seat counts, the single rabbi table invariant, and
connection references, then transactionally replaces only layout tables and
connections. Existing assignments are preserved. The endpoint snapshots a
server-derived `capacity_limit_snapshot` for display but does not mutate
`event_capacity_units.capacity`, `event_occurrences.capacity`, `events.capacity`,
registrations, or capacity reservation rows.

`PATCH /admin/seating/assignments` replaces assignments only for an existing
scoped layout. It validates reserve rows have no registration id, placed
seat keys are unique and point at current layout tables, guest indexes are
non-negative when present, and guest registrations belong to the same
event/occurrence/capacity-unit context. It does not create registrations, change
registration statuses, adjust capacity reservations, or alter layout geometry.

This PR does not switch the web-admin seating UI, add
`adminSeatingApiService`, add provider switching, change mobile, redesign
seating geometry, change registration capacity logic, import Supabase data,
seed seating data, or connect the Python API to Supabase. The next PR is
`feature/admin-seating-api-switch`.

### PR 29 web-admin seating API switch

PR 29 connects the existing web-admin seating service facade to the Python API
behind `VITE_ADMIN_SEATING_PROVIDER=api`, while preserving Supabase RPC as the
default when the flag is missing, invalid, or set to `supabase`.

Implemented web-admin wrappers:

```text
GET /admin/seating/templates
GET /admin/seating/templates/{template_id}
POST /admin/seating/templates/from-layout
DELETE /admin/seating/templates/{template_id}
GET /admin/seating/layout
POST /admin/seating/layout/from-template
PATCH /admin/seating/layout
PATCH /admin/seating/assignments
```

The existing seating facade names remain in place:
`listSeatingTemplates`, `getSeatingTemplate`, `getSeatingLayout`,
`createSeatingLayoutFromTemplate`, `saveSeatingLayout`,
`saveSeatingAssignments`, `createSeatingTemplateFromLayout`, and
`deleteSeatingTemplate`. API responses are normalized from the snake_case
Python contract into the existing camelCase seating types used by the editor,
canvas, template picker, save-as-template flow, assignments, and print model.

API mode sends the current v15 seating payload keys unchanged:
`eventId`, `occurrenceId`, `capacityUnitId`, `layout`, `customTables`,
`tableConnections`, `selectedTableId`, `seatingDone`, `activeTemplateId`,
`reserveIds`, `capacity`, `chairs`, and `pool`. The backend may preserve stale
assignment rows after geometry changes, and the web-admin wrapper maps returned
rows faithfully without adding a new reconciliation algorithm.

This PR does not change seating UI components, canvas geometry, seating
algorithms, auto seating, manual drag/drop, print behavior, registration
services, capacity bucket logic, mobile, backend endpoints, or Alembic
migrations. Physical seats and registration capacity remain separate:
`capacity_limit_snapshot` is display-only, `PATCH /admin/seating/layout` does
not mutate registration capacity, and templates copy geometry only without
assignments. The next PR is `feature/api-import-schema-alembic`.

### PR 30A API import schema

PR 30A adds the Python API Alembic/SQLAlchemy schema for website import before
any import endpoints are implemented. It creates the API-owned
`event_import_sources`, `event_import_runs`, and `event_import_items` tables.

The schema preserves the existing import/review contract documented in
`docs/admin-import-review.md`, `docs/website-events-importer.md`, and
`docs/admin-import-dedupe-contract.md`. Import items keep the raw parser and
review payload in `raw_payload` JSONB, including `importReview`,
`importReview.dedupe`, and `importReview.imageMirror`. Dedupe remains
JSON-based and is not promoted into `event_import_items.status` or
`event_import_runs.status`.

Import sources are scoped to API `communities(id)`, and user audit columns point
to `app_users(id)`, not `auth.users`. Runs carry a denormalized `community_id`
that is constrained to match the source community. The default and only schema
mode is `apply_review_only`; no auto-publish, publish-now, scheduling, cron, or
automation mode is added. Run status remains `started | success | failed`, and
item status remains `new | linked | ignored | error`.

JSONB storage is used for source settings, run summary, run parser/debug
metadata, and item raw payloads. `linked_event_id` is only a nullable reference
to an existing event and does not imply publishing. This PR does not create,
update, publish, or auto-publish events.

The schema includes narrow partial unique indexes for one active `started` run
per source and one non-null `external_id` per run. It intentionally does not
make `(source_id, external_id)` unique across runs, so legitimate cross-run
review history remains possible.

PR 30A does not implement parser code, import endpoints, an import runner,
dedupe logic, publish/ignore actions, admin import UI switching,
`adminImportApiService`, Supabase Edge Function changes, Supabase RPC changes,
mobile changes, real data import, seed import data, or any connection from the
Python API to Supabase. The next PR is
`feature/api-website-import-endpoints`.

### PR 30 API website import endpoints

PR 30 moves the website import runner into the Python API as backend-only
endpoints and importer modules:

```text
POST /admin/import-runs
GET /admin/import-runs
GET /admin/import-items
GET /admin/import-items/{item_id}
POST /admin/import-items/{item_id}/ignore
POST /admin/import-items/{item_id}/publish
```

All endpoints require an authenticated actor with an active `admin` or
`event_manager` membership in the relevant community and scope reads/writes to
that actor's manageable communities. `POST /admin/import-runs` starts a
review-only run for an existing source or for a community-scoped source created
from the request, writes import review items, finalizes JSON dedupe hints under
`raw_payload.importReview.dedupe`, and finishes the run with safe summary/error
metadata. The active-run partial unique index is enforced as a clean 409
conflict when a source already has a `started` run.

Run creation never creates, updates, publishes, schedules, or auto-publishes
events. `created_count` and `updated_count` stay event-write counters and remain
zero for review-only runs. Event creation/update happens only through explicit
`POST /admin/import-items/{item_id}/publish`, which links the import item to one
event, defaults new events to draft/hidden, uses `source_type =
website_scrape`, sets `manual_override = true`, and avoids duplicate events on
repeat publish when a linked event or matching source external id already
exists.

`POST /admin/import-items/{item_id}/ignore` marks the item ignored and preserves
the review JSON while adding admin-review metadata. Item list/detail endpoints
return `raw_payload.importReview` as stored so the review queue can continue to
read JSON-based date and dedupe state.

PR 30 does not switch the web-admin UI, add `adminImportApiService`, change
mobile, use Supabase Edge Functions, change Supabase migrations/RPC/RLS, connect
the Python API to Supabase, add scheduled/cron imports, or implement image
mirroring. The next PR is `feature/admin-import-api-switch`.

## API Contract Foundation

`docs/api-contracts.md` defines the stable REST/JSON contract foundation before
implementation. The first documented endpoint groups are `/auth/*`, `/me/*`,
`/events/*`, `/registrations/*`, `/admin/*`, and `/privacy/*`, with shared
response envelope, error, auth header, pagination, ISO date/time, and UUID
identifier conventions.

## Phased PR Roadmap

The roadmap below mirrors `plan.md` v2.7. Later prompts and PRs should use the
root plan as the final source of truth.

### Phase 0: Documentation and contracts

- PR 1: `feature/backend-python-migration-roadmap`
- PR 2: `feature/backend-api-contracts-foundation`

### Phase 1: Python backend foundation

- PR 3: `feature/api-local-dev-infra`
- PR 4: `feature/api-db-alembic-core-schema`
- PR 5: `feature/api-synthetic-seed-dev-only`
- PR 6: `feature/api-auth-db-model`
- PR 7: `feature/api-auth-security-utils`
- PR 8: `feature/api-authorization-guards`

### Phase 2: Auth and API client foundation

- PR 9: `feature/api-auth-endpoints`
- PR 9A: `feature/api-auth-migration-inventory`
- PR 9B: `feature/api-auth-email-delivery-minimal`
- PR 9C: `feature/api-auth-set-password-reset-verify`
- PR 10: `feature/api-invite-registration-flow`
- PR 11: `feature/mobile-api-client-foundation`
- PR 12: `feature/admin-api-client-foundation`
- PR 13: `feature/mobile-auth-api-service-foundation`
- PR 14: `feature/admin-auth-api-service-foundation`
- PR 14A: `feature/api-supabase-jwt-bridge`

### Phase 3: Public/mobile events and registrations

- PR 15: `feature/api-events-read-endpoints`
- PR 16: `feature/mobile-events-api-switch`
- PR 17: `feature/api-user-registration-endpoints`
- PR 18: `feature/mobile-registration-api-switch`

### Phase 4: Admin events and registrations

- PR 19: `feature/api-admin-events-crud`
- PR 20: `feature/api-admin-occurrences-options-capacity`
- PR 21: `feature/admin-events-api-switch`
- PR 21A: `feature/mobile-admin-events-api-switch`
- PR 21B: `feature/api-admin-community-locations-switch`
- PR 22: `feature/api-admin-registrations-endpoints`
- PR 23: `feature/admin-registrations-api-switch`

### Phase 5: Members and invites

- PR 24: `feature/api-admin-members-endpoints`
- PR 25: `feature/admin-members-api-switch`
- PR 26: `feature/api-admin-invites-endpoints`
- PR 27: `feature/admin-invites-api-switch`

### Phase 6: Seating, import, feedback, prayer, contacts, storage, push

- PR 28A: `feature/api-seating-schema-alembic`
- PR 28: `feature/api-seating-endpoints`
- PR 29: `feature/admin-seating-api-switch`
- PR 30A: `feature/api-import-schema-alembic`
- PR 30: `feature/api-website-import-endpoints`
- PR 31: `feature/admin-import-api-switch`
- PR 32A: `feature/api-personal-surfaces-schema-alembic`
- PR 32B: `feature/api-feedback-privacy-device-endpoints`
- PR 32C: `feature/api-prayer-tracker-endpoints`
- PR 32D: `feature/mobile-prayer-tracker-api-switch`
- PR 32E: `feature/api-community-contacts-endpoints`
- PR 32F: `feature/mobile-community-contacts-api-switch`
- PR 32G: `feature/api-avatar-storage-foundation`
- PR 32H: `feature/mobile-avatar-api-switch`
- PR 32I: `feature/api-push-pipeline`
- PR 33: `feature/mobile-admin-feedback-device-api-switch`

### Phase 7: Data migration and cutover

- PR 34: `feature/migration-supabase-export-scripts`
- PR 35: `feature/migration-api-import-scripts`
- PR 36: `feature/backend-shadow-read-compare`
- PR 37: `feature/backend-provider-cutover`
- PR 38: `feature/remove-supabase-production-runtime`
- PR 39: `feature/backend-production-deploy-runbook`

## Agent Execution Policy

Primary agent: Codex. Fallback agent: Claude Code. One canonical English prompt
is authored per PR, and the executing tool is called "the agent".

Prompt authors may be ChatGPT, Claude, or the project owner manually. Prompt
authors must use the repository-root `plan.md` version, check its version
header, and verify referenced paths, services, signatures, and files against the
actual repository before emitting a prompt.

Root agent files:

- `AGENTS.md` is the canonical standing-rules file for Codex-compatible agents.
- `CLAUDE.md` imports `@AGENTS.md` and adds only Claude Code-specific rules.
- `CLAUDE.md` must not duplicate the full standing rules.
- Codex sessions must be restarted after changing `AGENTS.md`.
- `AGENTS.override.md` is local/private and must never be committed.

## Agent Git Workflow

The agent creates the feature branch, implements the scoped change, runs the
required checks, commits, and pushes the branch.

Rules:

- Stage only expected-scope files by explicit path.
- Do not use `git add -A`.
- Do not use `git add .`.
- Never merge PRs.
- Never push to `main`.
- Never force-push.
- Never rebase a pushed branch without separate owner instruction.
- Manual browser smoke and Expo/iPhone smoke are owner-only on the pushed PR
  branch before merge.

Default PR handoff mode B is push-only. After push, the agent outputs the
complete PR body using the root `plan.md` section 9 template as one
ready-to-paste markdown block, then outputs the GitHub new-PR URL. Creating
the PR with `gh pr create` is optional only when `gh` is installed and
authenticated.

## Main Branch Protection Recommendation

The repository owner should configure `main` so it:

- requires a pull request before merging;
- blocks direct pushes to `main`;
- keeps merge owner-controlled after manual smoke.

## Local Plan File

The local migration plan must live at repository root as `plan.md` and must be
ignored by Git. Historical or alternate local plans such as `PLAN*.md` are also
local-only unless a future PR explicitly lists them in expected scope.

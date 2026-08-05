# Sredi Svoih API

Local Python/FastAPI backend contour for the staged Supabase-to-PostgreSQL
migration.

This service is intentionally isolated during the migration:

- it does not switch mobile or web-admin traffic by default;
- it does not connect to Supabase;
- it does not expose PostgreSQL directly to mobile or web-admin;
- it exposes backend-only API auth foundation endpoints, local `/health`,
  `/version`, and the generated FastAPI docs.

## Local startup

Run Supabase local as usual for the existing mobile/admin contour, then start
the new API contour:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; supabase start
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml up -d
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
cd F:\2026\SS-App\code\sredi-svoih-app; curl http://127.0.0.1:8000/health
```

If the API container is not already running, run Alembic through a temporary
`api_backend` container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

The API is available locally at `http://127.0.0.1:8000`. The API database is a
separate PostgreSQL service on `localhost:55432`, not the Supabase local
database.

Host Windows Python is not the required backend runtime for this PR. The API
target is Python 3.12+ inside the `api_backend` Docker container, and the
Docker container is the normal local runtime/check path.

For Expo Go on an iPhone, use `http://<your-lan-ip>:8000` instead of
`http://127.0.0.1:8000`. The container starts Uvicorn on `0.0.0.0:8000` so the
phone can reach the computer over the LAN.

## Owner-local Expo/iPhone avatar smoke

For an owner-local Expo Go or iPhone avatar smoke only, expose the local object
storage host and give the API a LAN-reachable public endpoint before starting
the Compose stack:

```powershell
$env:API_OBJECT_STORAGE_HOST_BIND="0.0.0.0"
$env:API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL="http://<computer-lan-ip>:59000"
```

This is local owner smoke configuration, not a production default. Production
object-storage endpoints must remain private and environment-specific. The API
container continues to use the internal Compose endpoint
`http://api-object-storage:9000`; only signed URLs returned to the phone use
the LAN-reachable public endpoint. Do not place storage credentials or other
secrets in mobile, Expo, Vite, `apps/admin`, or committed env files.

## Auth email flows

The API includes backend-only password reset, email verification, and
set-password endpoints under `/auth/*`. These endpoints store only hashed
one-time codes in the API database. Plaintext codes and links are used only
while rendering the outbound auth email.

Email sending is disabled by default:

```powershell
API_EMAIL_ENABLED=false
```

For local end-to-end testing, enable an owner-controlled SMTP or mail-catcher
environment through the existing `API_EMAIL_*` variables. Do not place SMTP
credentials in mobile, Expo, Vite, `apps/admin`, committed env files, or docs
with real values.

Auth one-time code expiry defaults to 30 minutes and can be adjusted only in
the backend API environment:

```powershell
API_AUTH_CODE_TTL_MINUTES=30
```

## Web event publication

`events.web_visibility` is a separate publication switch with database values
`disabled`, `unlisted`, and `listed`. Existing and new events default to
`disabled`. It does not replace event `status`, `visibility`, or
`registration_mode`, and the `events` table stores neither a public URL nor a
slug.

The backend-only `PUBLIC_WEB_BASE_URL` setting is the trusted origin for stable
UUID links. It rejects credentials, query strings, fragments, and non-loopback
plain HTTP; a trailing slash is removed. Do not derive canonical links from
request headers or put this setting in mobile, Expo, Vite, or `apps/admin`.

```powershell
PUBLIC_WEB_BASE_URL=http://localhost:5174
```

The one URL builder produces `{base}/events/{event_id}` and, for an occurrence,
`{base}/events/{event_id}?occurrence={occurrence_id}`. Links are computed and
read-only, so renaming an event does not change them.

Authenticated, community-scoped administrators use:

```text
GET   /admin/events/{event_id}/web-registration
PATCH /admin/events/{event_id}/web-registration
```

GET returns the link even while disabled and includes only active occurrence
links. PATCH accepts only `disabled` or `unlisted`; `listed` exists for the
future catalog but is intentionally rejected by the MVP write contract.
Enabling requires `registration_mode=internal_free`. A row lock, event update,
and PII-free `admin_event_audit_entries` insert share one caller-owned
transaction, so both commit or both roll back. Idempotent PATCH creates no
additional audit row.

The unauthenticated
`GET /events/{event_id}/registration-form?channel=web` endpoint is available
only when the event is published, public, `internal_free`, and `unlisted` or
`listed`. It returns a minimized event contract, active occurrences, active
free non-donation options, one current event-registration consent, an optional
current privacy policy, and canonical registration state. Closed, not-yet-open,
and full registrations keep the already-published page readable; the read does
not reserve capacity. There is no public UI or events catalog in this PR.

## Public web registration intents

The public flow implements create, resend, confirm, and credential-scoped status:

```text
POST /web/registration-intents
POST /web/registration-intents/{flow_id}/resend-code
POST /web/registration-intents/{flow_id}/confirm-email
GET  /web/registration-intents/{flow_id}/status
```

Inputs are normalized (case-insensitive email, Russian E.164 phone, and
trimmed/collapsed names). Opaque flow/idempotency values and six-digit email
codes are hash-only at rest. Code hashes include the registration intent ID,
are unique within that intent, and may safely represent the same six-digit code
in different intents. Generation checks the intent's complete code history and
retries a bounded number of times rather than reissuing a previous code. A
successful create means the verification email
was accepted by the existing SMTP delivery contour. If email is disabled or
delivery fails, create returns safe `503 email_delivery_unavailable`; the
intent remains available for an idempotent retry, but no code row is committed.
An active code makes an equivalent retry return the same flow without another
email. An equivalent retry after successful confirmation returns the same
`flow_id` with `next_step=completed` and creates no new email, code,
registration, legal acceptance, or plaintext credential.

This endpoint accepts only published/public `internal_free` events whose
`web_visibility` is `unlisted` or `listed`. The publication gate is checked
before submitted PII is persisted or email is sent. Paid and donation options
are rejected. Exactly one active `event_registration_consent`
with the matching content hash is mandatory (an active `privacy_policy` may be
included), and questionnaire `answers` must remain empty. Registration preflight
derives and validates `seats_count` through the canonical registration rules.

Verification codes are single-use and attempt-limited. Resend replaces the old
code only after the new email succeeds; a delivery failure leaves the old code
valid. Defaults are backend-only:

```powershell
API_WEB_REGISTRATION_INTENT_TTL_HOURS=24
API_WEB_REGISTRATION_CODE_TTL_MINUTES=15
API_WEB_REGISTRATION_CODE_MAX_ATTEMPTS=5
API_WEB_REGISTRATION_RESEND_COOLDOWN_SECONDS=60
```

Confirmation re-resolves current email/phone identity and deletion state,
revalidates legal documents, and calls the canonical registration service with
`source_channel=public_web`. Capacity, windows, occurrences, options, duplicate
registration, selections, and reservations are checked again under existing
locks. Current web publication is rechecked under an event row lock before any
identity mutation. Disabling an event therefore leaves an unfinished intent
and its valid code unconsumed; re-enabling allows a retry before normal expiry.
Already-confirmed registrations are never removed. No registration or capacity
reservation exists before a valid code. A
capacity failure rolls back identity/registration/legal changes and leaves the
code usable until its normal expiry/attempt limit.

New identities become `web_guest`/`unclaimed` with a minimal profile and no
membership. Claimed and legacy profiles are not overwritten. Phone-only,
differing-user, and deletion-blocked cases use neutral support/recovery
responses and never auto-merge users. Legal evidence uses
`checkbox_plus_email_verification`, `public_web`, and
`web-registration-email-code-v1`.

`without_password` returns no password credential. `create_account` for a
passwordless user returns a first-response-only hash-backed handoff accepted by
the existing `/auth/confirm-set-password`; replay returns
`request_set_password`, while an existing password returns `sign_in`.
Registration-result email is sent after commit, so secondary delivery failure
does not roll back the registration and is logged without raw PII or secrets.

The rate limiter is process-local and must be replaced by shared/distributed
storage before horizontally scaled production deployment. This PR adds no web
UI, SMS, marketing email, analytics, or capacity hold. The next PR is
`feature/public-web-event-registration-shell`.

## Admin event audit foundation

`admin_event_audit_entries` is the durable, PII-free audit table for technical
event publication state changes. It stores only the entry UUID, actor UUID,
event UUID, action, old/new state, and creation timestamp. The only supported
action is `event_web_visibility_changed`; state values are limited to
`disabled`, `unlisted`, and `listed`.

`record_event_web_visibility_change(...)` adds and flushes an entry in the
caller's `AsyncSession` without committing or rolling back. The dedicated
admin publication PATCH now calls it in the same transaction as the locked
event update. No request body, URL, email, phone, IP address, or user agent is
stored in the audit row.

## Temporary Supabase JWT bridge

For Level 3 mixed-provider testing only, the API can accept verified Supabase
access JWTs after normal API JWT validation fails:

```powershell
MIGRATION_ACCEPT_SUPABASE_JWT=false
SUPABASE_JWT_SECRET=
SUPABASE_JWT_ISSUER=
SUPABASE_JWT_AUDIENCE=
```

Keep the bridge disabled by default. `SUPABASE_JWT_SECRET` is a placeholder in
committed examples and docs only; the real secret stays in the owner's local or
deployment environment and must never be placed in mobile, Expo public env,
Vite env, `apps/admin`, committed env files, logs, or PR text.

When enabled, the token `sub` must already match an active `app_users.id` UUID
in the API database. The API does not create users from Supabase JWT claims.
Use the PR 5 dev-only UUID-aligned seed expectation for local protected smoke,
and verify that unmapped Supabase users receive a clean 401/403 response rather
than a server error. This bridge must be disabled before the final PR 37
provider cutover.

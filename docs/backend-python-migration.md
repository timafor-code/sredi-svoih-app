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

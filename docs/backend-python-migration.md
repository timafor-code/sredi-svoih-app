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
cd F:\2026\SS-App\code\sredi-svoih-app\apps\api; alembic upgrade head
cd F:\2026\SS-App\code\sredi-svoih-app; curl http://127.0.0.1:8000/health
```

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

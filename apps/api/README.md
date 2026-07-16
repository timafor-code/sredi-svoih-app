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

# API Local Development

This document describes the new local Python/FastAPI API contour added next to
the existing Supabase local contour. It is for local migration work only and
does not switch mobile or web-admin traffic away from Supabase.

## Parallel local contours

Old contour:

- Supabase local continues to serve current mobile and web-admin behavior.
- Supabase Auth, RPC, RLS, local database, and Studio stay available.
- Provider flags remain pointed at Supabase until a later PR explicitly changes
  a specific service.

New contour:

- FastAPI lives under `apps/api`.
- API PostgreSQL is the `api_postgres` Docker service.
- Alembic owns future API schema migrations.
- The API does not connect to Supabase and does not reuse Supabase Postgres.

Local ports:

```text
Supabase local API:      http://127.0.0.1:54321
Supabase local DB:       localhost:54322
Supabase Studio:         http://127.0.0.1:54323

New Python API:          http://127.0.0.1:8000
New Python Postgres:     localhost:55432
```

## Startup

Start Supabase first when you need the existing app/admin behavior:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; supabase start
```

Start the new API contour:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml up -d
```

Run Alembic against the separate API database from the running API container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

If the API container is not already running, run Alembic through a temporary
`api_backend` container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

Check the API:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; curl http://127.0.0.1:8000/health
cd F:\2026\SS-App\code\sredi-svoih-app; curl http://127.0.0.1:8000/version
```

FastAPI docs are available locally at:

```text
http://127.0.0.1:8000/docs
```

Host Windows Python is not the required backend runtime for this PR. The API
target is Python 3.12+ inside the `api_backend` Docker container, and the
Docker container is the normal local runtime/check path.

## iPhone and Expo Go

For Expo Go on an iPhone, do not use `127.0.0.1` or `localhost`; those point to
the phone itself. Use the computer LAN IP instead:

```text
http://<your-lan-ip>:8000
```

The API container starts Uvicorn on `0.0.0.0:8000` so the computer can accept
LAN traffic for iPhone testing. Keep PostgreSQL on `localhost:55432`; mobile
and admin must never connect directly to PostgreSQL.

## Boundaries

- Do not stop or remove Supabase local for this contour.
- Do not switch mobile or web-admin services to the API in this PR.
- Do not add API auth, events, registrations, or business DB models here.
- Keep `DATABASE_URL` backend-only in `apps/api/.env.example`,
  `infra/env/api.env.example`, or documentation. Do not add it to Expo, Vite,
  mobile, `src`, or `apps/admin` files.

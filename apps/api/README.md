# Sredi Svoih API

Local Python/FastAPI backend contour for the staged Supabase-to-PostgreSQL
migration.

This service is intentionally isolated in PR 3:

- it does not switch mobile or web-admin traffic;
- it does not connect to Supabase;
- it does not implement auth, events, registrations, or business tables;
- it only exposes local `/health`, `/version`, and the generated FastAPI docs.

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

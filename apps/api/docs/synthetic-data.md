# Synthetic API Seed Data

This document covers the dev-only synthetic seed script for the local Python API
database. The script exists to make local backend development easier before API
auth, event, and registration endpoints are implemented.

## Dev-only boundary

The seed script is not a production data tool. It refuses to run unless the API
settings look local/dev-like and the configured API database points at the known
local API database.

The script must only create synthetic data:

- no real names;
- no real phone numbers;
- no real email addresses;
- no Supabase import;
- no Supabase Auth query;
- no local mapping files committed to Git.

All seeded identities use obviously synthetic profile values and reserved
synthetic email domains. The script does not connect to Supabase.

## Seed contents

The script creates or reuses deterministic synthetic rows for:

- one community;
- one admin app user;
- one event manager app user;
- one member app user;
- profiles and community memberships for those users;
- one event category;
- two synthetic events;
- event occurrences, participation options, capacity units, and capacity links;
- synthetic member registrations with option selections and capacity
  reservations.

Repeated runs update the same synthetic rows instead of creating duplicate base
users, community, events, registrations, or registration details. The script does
not drop schema and does not perform destructive cleanup by default.

## Run after Alembic

Start the local API contour and apply migrations first:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml up -d --build
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

Then run the synthetic seed script inside the API backend container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend python scripts/seed_synthetic.py
```

If the API backend container is not already running, use a temporary container:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml run --rm api_backend python scripts/seed_synthetic.py
```

## Optional UUID alignment

Future Supabase JWT bridge smoke tests can pass local test user UUIDs by CLI
argument. This is optional and dev-only. It exists so a local JWT subject can
resolve to a matching `app_users.id` row during future protected endpoint smoke
testing.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; docker compose -f infra/docker-compose.api.yml exec api_backend python scripts/seed_synthetic.py --admin-user-id 00000000-0000-4000-8000-000000000101 --event-manager-user-id 00000000-0000-4000-8000-000000000102 --member-user-id 00000000-0000-4000-8000-000000000103
```

When UUIDs are provided, the script creates those exact `app_users.id` rows if
they do not already exist. If synthetic users already exist with different IDs,
the script refuses to rewrite them; use a fresh local API database for
UUID-aligned smoke data. Profile data remains synthetic in both modes.

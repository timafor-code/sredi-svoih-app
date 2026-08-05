# Public web local development

The public event-registration shell is a standalone Vite application in
`apps/web`. It reads the dedicated public Python API contract and does not use
the admin or mobile runtime.

## Install

```powershell
npm install --prefix apps/web
```

## Start the canonical API contour

```powershell
docker compose -f infra/docker-compose.api.yml up -d --build api_postgres api_object_storage api_object_storage_init api_backend
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

## Start public web

```powershell
npm run web:dev
```

Open a fixture event at:

```text
http://localhost:5174/events/<event-uuid>
```

An occurrence may be preselected without adding any participant data to the
URL:

```text
http://localhost:5174/events/<event-uuid>?occurrence=<occurrence-uuid>
```

The default `VITE_WEB_API_BASE_URL=/api` uses the local Vite proxy. The proxy
forwards to `http://127.0.0.1:8000` and removes the `/api` prefix. A developer
may override the local proxy destination through
`VITE_WEB_API_PROXY_TARGET`; neither value is a credential.

## Backend fixture requirements

The event fixture must have all of these values and related data:

- `status = published`;
- `visibility = public`;
- `registration_mode = internal_free`;
- `web_visibility = unlisted` or `listed`;
- one active `event_registration_consent` legal document.

This PR performs only
`GET /events/{event_id}/registration-form?channel=web` and local form
validation. Creating an intent, sending or confirming an email code, and the
account-claim flow are intentionally deferred to
`feature/public-web-registration-account-claim`.

Browser smoke is performed manually by the project owner on the pushed PR
branch before merge.

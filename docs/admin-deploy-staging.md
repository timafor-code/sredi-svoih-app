# Admin staging deploy

This document records the current web-admin staging boundary after PR 38.
Web-admin uses only the authenticated Python API. The production API/PostgreSQL
deployment runbook belongs to PR 39 and is deliberately not implemented here.

## Runtime configuration

The staging build needs only browser-safe API configuration:

```dotenv
VITE_API_URL=https://<api-host>
VITE_ADMIN_ENV_LABEL=staging
VITE_ADMIN_BASE_PATH=/admin-stage/
```

`VITE_ADMIN_ENV_LABEL` is an optional visual marker. `VITE_ADMIN_BASE_PATH` is
needed only when publishing the Vite build below a path such as
`/admin-stage/`. Keep `.env.local` and `.env.production.local` local; never
commit them.

Do not configure Supabase URL/key settings, provider flags, browser Auth, RPC,
RLS, or Storage for the web-admin. The browser receives no service-role
credentials, Supabase Admin API credentials, `DATABASE_URL`, direct PostgreSQL
access, raw JWT/session dumps, or any other server-only secret.

The production API must keep `MIGRATION_ACCEPT_SUPABASE_JWT=false`. This
backend-only setting is not an Expo, Vite, or `apps/admin` environment value.

## Build boundary

Build from the repository root:

```powershell
npm run admin:build
```

The output directory is `apps/admin/dist`. Path-based static hosting must serve
the build assets under the configured base path. This document does not add or
modify hosting, reverse-proxy, TLS, DNS, server, or deployment configuration.

## Authorization and privacy

All web-admin requests use the normal authenticated Python API client. API
authorization continues to enforce membership and role access. Prayer activity
is private: `prayer_activity_logs` must never be read or shown by admin.

## Historical archive

Historical Supabase migrations under `supabase/migrations/**` are retained as
the migration archive. Owner-run scripts under `scripts/migration/**` may have
documented migration-only access. Those materials are not a frontend runtime or
deployment option. Previous staging instructions that described provider
switching or Supabase browser configuration are historical and must not be used
for the API-only runtime.

## Manual smoke

Not run by Codex. The project owner verifies the pushed branch manually:

- Start web-admin with a reachable `VITE_API_URL` and the normal admin UI
  values above.
- Sign in through API email/password auth.
- Verify events, registrations, members, invites, seating, import, feedback,
  community, categories, and capacity views.
- Verify no Supabase URL, anon key, or provider flag is required.
- Verify browser network traffic contains no Supabase Auth, REST, RPC, or
  Storage request.
- Confirm production API configuration has `MIGRATION_ACCEPT_SUPABASE_JWT=false`.

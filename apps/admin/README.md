# Среди Своих Admin Center

`apps/admin` is the Vite, React, and TypeScript web-admin for «Среди Своих».
It uses only the authenticated Python API. Authorization remains enforced by the
API for `admin` and `event_manager` roles; browser-admin never uses direct
PostgreSQL access, server-only credentials, or elevated browser permissions.

## Production runtime

The web-admin requires only the API settings below. It does not use Supabase
URL/key settings, provider flags, browser Auth, RPC, RLS, or Storage.

```dotenv
VITE_API_URL=http://127.0.0.1:8000
VITE_ADMIN_ENV_LABEL=staging
VITE_ADMIN_BASE_PATH=/
```

For a path-based staging build, set `VITE_ADMIN_BASE_PATH=/admin-stage/` in the
host configuration or a local uncommitted production env file. Do not commit
`.env.local` or `.env.production.local`.

Production API configuration must keep `MIGRATION_ACCEPT_SUPABASE_JWT=false`.
That backend-only setting does not belong in Expo, Vite, or `apps/admin`
environment files.

Historical `supabase/migrations/**` remain a migration archive. Owner-run
`scripts/migration/**` may retain documented migration-only access; neither is
part of the web-admin production runtime. PR 39 owns the production
API/PostgreSQL deployment runbook.

## Local development

From the repository root:

```bash
npm run admin:dev
```

Required checks:

```bash
npm run admin:typecheck
npm run admin:build
```

The root mobile type check is available with:

```bash
npm run typecheck
```

## Security boundary

Do not add service-role keys, Supabase Admin API credentials, backend database
connection strings, or other server-only secrets to the web-admin. Prayer activity remains private
and is never read or displayed in admin.

## Staging and manual verification

See [Admin staging deploy](../../docs/admin-deploy-staging.md) for the current
API-only staging notes. Browser smoke is performed by the project owner.

# Admin beta v1 release checklist

This historical beta checklist is updated for the PR 38 API-only frontend
runtime. It is not the production API/PostgreSQL deployment runbook; that work
belongs to PR 39.

## Runtime configuration

- [ ] Staging API is reachable at `VITE_API_URL`.
- [ ] Admin build has `VITE_ADMIN_ENV_LABEL=staging` when a visible label is
  needed.
- [ ] `VITE_ADMIN_BASE_PATH` is set only when the static host publishes below a
  path.
- [ ] No Supabase URL/key, provider flag, browser Auth, RPC, RLS, or Storage
  setting is configured for web-admin.
- [ ] No `.env.local` or real secret value is committed.
- [ ] Production API configuration keeps `MIGRATION_ACCEPT_SUPABASE_JWT=false`.

## Authorization and privacy

- [ ] Active `admin` and `event_manager` accounts can sign in through API
  email/password authentication and have the expected API-managed membership.
- [ ] `NoAccess` does not appear for authorized roles.
- [ ] Prayer activity is neither read nor displayed in admin.
- [ ] Browser-admin contains no service-role key, Supabase Admin API
  credential, `DATABASE_URL`, or server-only secret.

## Admin UI readiness

- [ ] Events, registrations, members, invites, seating, import, feedback,
  community, categories, and capacity views use the authenticated Python API.
- [ ] No screen requires a Supabase URL, anon key, or provider flag.
- [ ] Browser network traffic contains no Supabase Auth, REST, RPC, or Storage
  request.

## Owner manual smoke

Browser smoke is performed by the project owner on the pushed branch. Codex
does not run it.

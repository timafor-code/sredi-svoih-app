# Admin beta v1 release checklist

Этот checklist является финальным gate для Phase 1 server beta v1 перед выдачей staging admin URL beta-админам. PR с этим документом не меняет UI, DB schema, backend/RPC, mobile, registrations/seating, feedback flow, settings, health-check или current-context logic.

Phase 1 не включает import button в web-admin. Импорт с сайта временно выполняет только владелец проекта через CLI/dev flow вне browser-admin.

## Infrastructure / Supabase

- [ ] Staging Supabase project created and selected as the beta v1 backend.
- [ ] Supabase migrations applied to the staging project.
- [ ] Static SPA host configured for `apps/admin/dist`.
- [ ] SPA fallback returns `index.html` for admin routes and auth callback paths.
- [ ] Admin staging env configured with only browser-safe vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and optional `VITE_ADMIN_ENV_LABEL=staging`.
- [ ] No `.env.local` or real secret values committed.

## Auth / access

- [ ] Hosted Supabase Auth `site_url` set to the canonical staging admin URL.
- [ ] Hosted Supabase Auth allowed/additional redirect URLs include the canonical staging admin URL.
- [ ] Dedicated callback URL is allowed if the staging flow uses one.
- [ ] Active `admin` account exists in hosted Auth, has a `profiles` row and active beta community membership.
- [ ] Active `event_manager` account exists in hosted Auth, has a `profiles` row and active beta community membership.
- [ ] `NoAccess` does not appear for active `admin` or active `event_manager` accounts.

## Admin UI beta readiness

- [ ] Overview does not show fake KPI, mock dashboards, fake charts or production analytics.
- [ ] Overview shows current user, role and active community from the authenticated session.
- [ ] Mock invites are hidden from beta-admin flows.
- [ ] Feedback button is visible and works for beta feedback capture.
- [ ] Settings shows real community data from Supabase, not mock community settings.
- [ ] Occurrence timing UI uses server state for scheduled occurrence timing.

## Events / registrations / seating

- [ ] Registrations are open for the beta event flow expected by staging.
- [ ] Seating save works for the staging event flow expected by beta.
- [ ] Seating reopen works after save.
- [ ] Excel export works for the expected staging registration/seating data.
- [ ] Existing registrations/seating behavior is unchanged by this docs-only PR.

## Import owner-only flow

- [ ] Manual owner-only CLI import flow is documented as the temporary Phase 1 import path.
- [ ] Browser-admin does not expose an import button in Phase 1.
- [ ] Import is run outside browser-admin by the project owner only.
- [ ] Beta admins are not instructed to run imports from the web-admin UI.

## Security / forbidden scan

- [ ] Browser-admin uses the ordinary authenticated Supabase client with anon/publishable key only.
- [ ] Admin actions stay behind RLS/RPC contracts.
- [ ] Docs do not instruct browser-admin to use service-role keys.
- [ ] Docs do not instruct browser-admin to use Supabase Admin API.
- [ ] Docs do not instruct `apps/admin` to use server-only database connection env vars.
- [ ] App code does not manage `auth.users` directly.
- [ ] Prayer tracker remains private; `prayer_activity_logs` are not read or shown.
- [ ] Forbidden scan is clean for changed files.

## Manual smoke

Browser smoke is performed manually by the project owner, not by Codex. Codex should not open a browser or run browser smoke for this PR.

- [ ] Project owner opens the staging admin URL in a browser.
- [ ] Project owner signs in as active `admin`.
- [ ] Project owner verifies Overview, Settings, feedback, events, registrations, seating and Excel export against the beta expectations above.
- [ ] Project owner signs out and signs in as active `event_manager`.
- [ ] Project owner verifies role-appropriate access and confirms admin-only areas remain protected.
- [ ] Project owner confirms the UI does not expose secret values, raw tokens, SQL/debug internals or private prayer tracker logs.
- [ ] Project owner confirms no import button is present in Phase 1.

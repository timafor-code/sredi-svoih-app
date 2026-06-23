# Admin beta v2 release checklist

## Purpose

This is the final manual release checklist for web-admin beta v2 on the staging/server beta environment.

Run this checklist after Phase 1 server beta baseline, Phase 2 import v2, and Phase 3 beta polish are merged and deployed. Codex does not run browser smoke for this release gate. Browser smoke is performed manually by the project owner.

## Pre-flight

- Confirm `main` contains PR #225 through PR #239.
- Confirm all required Supabase migrations are applied on staging.
- Confirm the admin SPA is deployed to the staging admin URL.
- Confirm Supabase Auth redirects are configured for the staging admin URL.
- Confirm the admin community exists.
- Confirm the admin user has an active `admin` membership.
- Confirm the event manager user has an active `event_manager` membership.
- Confirm a member/no-access user is available for negative checks.
- Confirm no service-role key is exposed in the browser.
- Confirm no `DATABASE_URL` is configured or documented as required in `apps/admin`.
- Confirm `.env.local` is not committed.

## Phase 1 server beta checks

- Admin SPA opens on the staging admin URL.
- Login redirect returns to the admin URL.
- Login does not enter a redirect loop.
- `NoAccess` works for a user without admin access.
- Overview does not show mock or fake invites.
- Settings shows real community data.
- Current user context, health, and staging panels work.
- Occurrence timing server-state is displayed correctly.
- Feedback submit UI is available where it should be available.

## Phase 2 import v2 checks

- Edge Function `admin-website-import` is deployed.
- `ADMIN_WEB_ORIGIN` matches the staging admin SPA origin.
- CORS is not wildcard for staging or production.
- Authorization uses the user session token.
- Import write RPC is applied.
- Import Review page opens.
- Import button is visible for an allowed admin role.
- Confirm dialog says there is no auto-publish.
- `dry-run` / `apply_review_only` path works according to the current UI.
- `apply_review_only` creates or updates review queue items only.
- Events are not auto-published.
- Duplicate immediate run is blocked.
- Run history shows `started`, `success`, and `failed` states when applicable.
- Review queue receives items.
- Dedupe badges are visible.
- Detail panel shows the dedupe/control section.
- `possible_duplicate` requires manual review.
- `duplicate` does not auto-create an event.
- `manual_override_skipped` is visible and explained.

## Phase 3 polish checks

- Settings page beta blocks are understandable.
- Dead event duplicate action is removed.
- Registrations page selected event/occurrence context is clear.
- Excel export scope is clear.
- Capacity limit vs physical seats hint is visible.
- Donation no-seat hint is visible.
- Seating empty guest pool warning is visible.
- Feedback review list is visible for `admin`.
- Feedback review list is not visible or accessible for `event_manager`.
- Feedback status can be marked reviewed, resolved, closed, and reopened by `admin`.

## Access matrix

| Role | Expected access |
| --- | --- |
| `admin` | Can open admin; can run import if allowed by RPC; can review feedback; can manage events and registrations according to existing permissions. |
| `event_manager` | Can access allowed admin sections; can submit feedback; cannot access the admin-only feedback review list; cannot access actions beyond existing permissions. |
| member/no-access | Cannot access web-admin protected areas. |

## Security gates

- No Supabase Admin API in the browser.
- No service-role key in the browser or `apps/admin` runtime.
- No `DATABASE_URL` in `apps/admin`.
- No `auth.users` reads.
- No `prayer_activity_logs` reads.
- Admin actions go through RPC/RLS.
- Edge Function CORS is scoped to the admin origin.
- Import does not auto-publish events.
- Browser does not write directly to import tables.

## Manual smoke checklist

- [ ] Login as admin.
- [ ] Open Overview.
- [ ] Open Settings.
- [ ] Open Events.
- [ ] Confirm duplicate action is absent.
- [ ] Open Registrations.
- [ ] Check event without occurrences.
- [ ] Check event with occurrences.
- [ ] Open seating editor.
- [ ] Open Import Review.
- [ ] Run import only if project owner intentionally wants to test it.
- [ ] Confirm run history updates.
- [ ] Confirm review queue and dedupe UI.
- [ ] Open Feedback.
- [ ] Update feedback status.
- [ ] Login as event_manager.
- [ ] Confirm feedback review list is not accessible.
- [ ] Login as member/no-access.
- [ ] Confirm admin access is denied.

## Release decision

Ready if all required checks pass.

Not ready if auth redirects fail, import auto-publishes, CORS is wildcard, service-role or `DATABASE_URL` appears in browser/app runtime, feedback review leaks to `event_manager` or member/no-access users, or registrations/seating context is misleading.

## Known out of scope

- No mobile/Expo smoke in this checklist.
- No production deploy.
- No billing.
- No logo upload.
- No notification settings.
- No automatic event publishing.
- No safe event duplication flow.
- No GitHub issue sync for feedback.
- No screenshots/uploads for feedback.

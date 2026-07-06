# API Contracts

Source of truth: repository-root `plan.md`, version `2026-07-06 v2.6`.

This file is the initial contract foundation for the backend migration. PR 1
does not define the full endpoint catalog; PR 2 extends this document with the
stable REST/JSON contract details.

## Scope For PR 1

This document records the contract boundaries that every later endpoint group
must follow:

- Mobile and web-admin talk to the Python API through app-specific API client
  wrappers.
- Mobile and web-admin must not connect directly to PostgreSQL.
- `DATABASE_URL` is backend-only and must not appear in mobile, Expo env, Vite
  env, `apps/admin`, or frontend code.
- Supabase local remains active during migration while the Python API/PostgreSQL
  contour runs next to it.
- Production API auth is not enabled until OAuth-only users have an explicit
  migration path.

## Target Shape

The target API is FastAPI REST/JSON under the future `apps/api` backend.
Endpoint groups are intentionally left as PR 2 work. The planned groups are:

- `/auth/*`
- `/me/*`
- `/events/*`
- `/registrations/*`
- `/admin/*`
- `/privacy/*`

PR 2 will define the common response envelope, common error codes, auth header
contract, pagination contract, date/time format, and id format.

## Contract Principles

All contract additions must be documented before implementation and should be
small enough to review alongside the matching service migration.

Responses should avoid leaking backend internals. Authorization failures,
validation failures, and missing resources should use documented error codes
instead of ad hoc strings.

API responses and logs must not expose raw email, phone, names, invite codes,
registration comments, JWTs, refresh tokens, password reset codes, or similar
secrets/sensitive values.

## Auth Boundary

The future API auth model is based on:

- `app_users` for technical identity;
- `auth_sessions` for refresh-token sessions;
- JWT access tokens;
- refresh-token rotation.

Auth endpoints and UI auth switching are later roadmap work. Until the cutover
criteria are satisfied, production auth remains governed by the staged migration
rules in the root plan.

## Data And Storage Boundary

The API owns authorization checks in Python and enforces transactional database
checks for protected writes. RLS is not the target authorization layer.

Alembic owns new API schema migrations. Supabase migrations remain historical
and reference material until cutover/removal PRs.

File/avatar storage must move to Russia-hosted object storage before production
cutover unless the owner explicitly signs off on an exclusion.

## Open Contract Work For PR 2

PR 2, `feature/backend-api-contracts-foundation`, should extend this skeleton
with:

- endpoint group details;
- response envelope;
- common error codes;
- `Authorization: Bearer <access_token>`;
- pagination;
- ISO 8601 date/time with timezone;
- UUID string identifiers.

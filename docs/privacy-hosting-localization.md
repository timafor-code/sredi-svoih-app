# Privacy, Hosting, And Localization

Source of truth: repository-root `plan.md`, version `2026-07-06 v2.7`.

This document records production data-residency and hosting constraints for the
backend migration. It supplements the existing privacy notes and does not change
runtime behavior in PR 1.

## Production Residency Decision

Production personal data of Russian citizens must not be stored in Western
Supabase after production cutover.

Before production cutover, these data classes must live in Russia-hosted
PostgreSQL or Russia-hosted object storage:

- app users;
- profiles;
- memberships;
- registrations;
- invites;
- device tokens;
- prayer logs;
- community contacts;
- contact visibility settings;
- avatars/photos;
- push jobs and deliveries;
- seating assignments.

Western Supabase may remain only for synthetic dev, staging, or demo data.

## Object Storage

Supabase Storage is replaced by Russia-hosted object storage before production
cutover unless the owner explicitly signs off on an exclusion.

Avatar/photo storage must not be treated as a separate privacy exception. If it
contains or can identify a person, it follows the same production residency
standard as profile and registration data.

Avatar objects and API-owned avatar metadata must be stored in Russia in
production. The PR 32G local MinIO service is for local smoke only and is not
the production storage provider. Production must use a Russia-hosted
S3-compatible endpoint and a private bucket.

Avatar upload/read URLs are short-lived bearer URLs. They contain authorization
query parameters and must not be logged, persisted, copied into support notes,
or stored in PostgreSQL. API responses expose durable `avatar_id` references;
they must not expose object keys, bucket names, ETags, storage credentials, or
internal storage endpoint configuration.

## Expo Push Caveat

Device tokens may be stored in Russia.

If Expo Push API is used for delivery, device tokens and message payloads are
transmitted to Expo as a delivery processor during sending. This is a
transit/processor decision, not merely a storage decision.

Production push enablement must review this caveat before rollout. A
Russia-hosted push alternative may be chosen later if required by the owner.

## Privacy Requests And Device Tokens (PR 32B)

The Python API records data-subject style privacy requests in the API-owned
`privacy_requests` table. `POST /privacy/requests` and `GET /privacy/requests`
are scoped to the authenticated user; admin review through
`/admin/privacy/requests` is admin-only and community-scoped. These endpoints
record and track requests only: no export, deletion, or correction is executed
by the API in this phase, and no emails are sent. Request `message` text is
treated as personal data and must not be logged raw.

Device tokens registered through `POST /me/device-tokens` are push-token PII
stored in the API-owned `device_tokens` table, upserted per
`(user_id, expo_push_token)`. API responses return token metadata only and
never echo the raw Expo push token. Deactivation is a soft `is_active = false`
update scoped to the owning user. No push sending exists yet; the Expo Push
caveat above applies when the push pipeline is implemented.

## Logging And Sensitive Values

Production logging must avoid raw personal and secret values, including:

- email;
- phone;
- names;
- invite codes;
- registration comments;
- device push tokens;
- privacy request messages;
- signed avatar URLs;
- object-storage credentials;
- raw avatar image bytes;
- JWTs;
- refresh tokens;
- password reset codes.

Logs should prefer counts, ids that are safe for the context, hashes where
appropriate, and validation summaries.

## Migration Script Carve-Out

Future owner-run scripts under `scripts/migration/**` may inspect Supabase Auth
metadata only when required for migration inventory/export and only under the
root-plan carve-out.

Those scripts may output counts, mappings, and validation reports only. No raw
auth dumps, plaintext tokens, OAuth provider payloads, or password data may be
committed.

Any service-role key needed by the owner for such scripts must stay in the
owner's local environment. It must never be committed or placed in mobile,
Expo env, Vite env, `apps/admin`, docs examples with real values, or frontend
code.
